import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import dedent from 'dedent';
import matter from 'gray-matter';
import { outputPath } from '../config.ts';
import { tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import { sanitizeFilename } from '../utils/strings.ts';
import type { Agent } from './agent.ts';
import type { Provider } from './provider.ts';
import { type ScoutCorpus, createScoutTools, excludeCorpusUrls } from './scout/tools.ts';

const MAX_ITERATIONS = 3;
const MAX_TOOL_ROUNDTRIPS = 5;
const CACHE_LIMIT = 40;
const URL_LISTING_LIMIT = 40;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export class Scout implements Agent {
  emoji = '🔎';
  private cache = new Map<string, string>();

  constructor(
    private provider: Provider,
    private corpus: ScoutCorpus
  ) {}

  isAvailable(): boolean {
    return this.corpus.files.length > 0;
  }

  async collectDocs(query: ScoutQuery): Promise<string> {
    if (!this.isAvailable()) return '';

    const cacheKey = `${query.url || ''}|${query.feature || ''}|${(query.excludeUrls || []).join(',')}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const fileCached = this.loadCachedDigest(query);
    if (fileCached !== null) {
      if (this.cache.size > CACHE_LIMIT) this.cache.clear();
      this.cache.set(cacheKey, fileCached);
      return fileCached;
    }

    const corpus = excludeCorpusUrls(this.corpus, query.excludeUrls || []);
    if (corpus.files.length === 0) return '';

    const result = await this.runSession(corpus, query);
    if (result === null) return '';

    if (this.cache.size > CACHE_LIMIT) this.cache.clear();
    this.cache.set(cacheKey, result);
    return result;
  }

  private async runSession(corpus: ScoutCorpus, query: ScoutQuery): Promise<string | null> {
    const { tools, scanner, getResult, finishFromText } = await createScoutTools(corpus);
    const conversation = this.provider.startConversation(this.buildSystemPrompt(Object.keys(tools), corpus, query, scanner), 'scout', this.provider.getAgenticModel('scout'));
    conversation.addUserText(this.buildTaskPrompt(query));

    tag('info').log(`Scout: collecting documentation for ${query.feature || query.url || 'the current page'}`);

    let failed = false;
    await loop(
      async ({ stop, iteration }) => {
        const invokeResult = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS,
          agentName: 'scout',
        });

        const responseText = invokeResult?.response?.text;
        if (responseText?.trim()) {
          finishFromText(responseText);
          stop();
          return;
        }

        if (!invokeResult?.toolExecutions?.length) {
          stop();
          return;
        }

        if (iteration >= MAX_ITERATIONS - 1) {
          conversation.addUserText('Exploration time is over. Report your findings now as your final message.');
          const final = await this.provider.invokeConversation(conversation, undefined, { agentName: 'scout' });
          finishFromText(final?.response?.text);
          stop();
        }
      },
      {
        maxAttempts: MAX_ITERATIONS,
        observability: { name: `scout: ${query.feature || query.url || 'docs'}`, agent: 'scout' },
        catch: async ({ error, stop }) => {
          failed = true;
          tag('warning').log(`Scout error: ${(error as Error).message}`);
          stop();
        },
      }
    );

    if (failed) return null;

    const digest = getResult();
    if (digest) {
      const filePath = this.saveDigest(query, digest);
      const words = digest.split(/\s+/).filter(Boolean).length;
      tag('info').log(`Scout found relevant docs: ${words} words → ${filePath}`);
      const lines = digest.split('\n').slice(0, 5).join('\n');
      tag('substep').log(lines);
    } else {
      tag('info').log(`Scout found no relevant docs for ${query.feature || query.url || 'the current page'}`);
    }
    return digest;
  }

  private buildSystemPrompt(toolNames: string[], corpus: ScoutCorpus, query: ScoutQuery, scanner: 'rg' | 'grep'): string {
    const urls = corpus.files.map((file) => file.url).filter(Boolean) as string[];
    const urlless = corpus.files.filter((file) => !file.url);
    let pagesListing = '';
    if (urls.length > 0) {
      const listing = urls
        .slice(0, URL_LISTING_LIMIT)
        .map((url) => `- ${url}`)
        .join('\n');
      pagesListing = `Documented pages:\n${listing}`;
      const remaining = urls.length - URL_LISTING_LIMIT;
      if (remaining > 0) pagesListing += `\n…and ${remaining} more — find them with ${scanner}`;
    }
    if (urlless.length > 0) {
      const listing = urlless
        .slice(0, URL_LISTING_LIMIT)
        .map((file) => `- ${toPosix(file.path)}`)
        .join('\n');
      pagesListing += `\nFiles with no page URL (hand-written docs):\n${listing}`;
    }

    const prompt = dedent`
      You are Scout — a documentation retrieval agent. You find collected documentation relevant to a testing focus and report it for test planning.

      You never see the application itself. The documentation corpus is your only source of truth.

      CORPUS:
      ${corpus.files.length} markdown files under:
      - ${corpus.dirs.map(toPosix).join('\n- ')}
      ${pagesListing}

      These pages are already provided to the planner in full — do not re-report them:
      ${(query.excludeUrls || []).map((url) => `- ${url}`).join('\n') || '- none'}

      AVAILABLE TOOLS:
      ${toolNames.join(', ')}.
      Use tool names exactly as listed. Do not invent aliases or combined names.
      Match each tool input schema exactly. Do not invent parameter names or pass extra fields.

      SCANNER:
      ${scanner} is the search command. Scan the working directory through bash() — explore freely, pipelines, globs and repeated searches are fine. Read files with readFile().

      WORKFLOW:
      1. Scan with ${scanner} using plain prose words from the focus — feature names, page purposes, capabilities
      2. Read the files whose hits look most relevant
      3. Report the digest as your final message — no tool call is needed to finish

      <rules>
      - Report only what the documentation states. Never fill gaps with assumptions about the application
      - Keep verified capabilities and unverified possibilities distinguishable, the way the documentation marks them
      - Name the page URL each item belongs to, so scenarios anchor to real routes
      - A short accurate digest beats a long loose one; reporting that nothing relevant exists is a valid answer
      - For vague terms such as valid, supported, recent, all, or available, seek exact definitions and provide example of valid/invalid values.
      - Follow relevant references for missing rules, shared policies, exceptions, and conflicting claims.
      </rules>

      Look for facts we need to collect for testing the related feature:

      <facts>
      - **Actors/access:** Find exact roles, permissions, ownership, scope, and denial behavior. Distinguish hidden, disabled, forbidden, and redirected.
      - **Prerequisites:** Find required data, settings, integrations, plans, flags, and dependencies.
      - **Actions/navigation:** Find entry points, available operations, destinations, confirmations, and cancellation behavior.
      - **Inputs/validation:** Find accepted values, formats, defaults, required fields, exact limits/units, normalization, and error messages. Distinguish omitted, empty, whitespace, and unchanged.
      - **Duplicates:** Find identity rules, uniqueness scope, and whether matches are rejected, reused, merged, or updated.
      - **Conditions/states:** Find guards, exceptions, state transitions, prohibited actions, and intentional no-ops.
      - **Outcomes:** Find visible feedback, persistent changes, side effects, and subsequent places where results appear.
      - **Failures:** Find retained changes, rollback, partial success, recovery, and retry behavior. Never assume an error means nothing changed.
      - **Async/time:** Find start versus completion, progress indicators, refresh behavior, delays, expiry, schedules, and retry limits.
      - **Lists/bulk actions:** Find search/filter semantics, sorting, pagination, count definitions, selection scope, and skipped-item behavior.
      - **Relationships/deletion:** Find inheritance, cascades, copy versus reference, unlink versus delete, restoration, and irreversible effects.
      - **Files/integrations:** Find supported formats, mappings, processing limits, sync direction, overwrite precedence, and unavailable-service behavior.
      - **Variants:** Find differences by role, plan, configuration, deployment, browser, or channel. Keep browser and API behavior separate.
      </facts>
    `;

    const customPrompt = this.provider.getSystemPromptForAgent('scout');
    if (customPrompt) return `${prompt}\n\n${customPrompt}`;
    return prompt;
  }

  private buildTaskPrompt(query: ScoutQuery): string {
    return dedent`
      Page URL: ${query.url || 'Unknown'}
      Page title: ${query.title || 'Unknown'}
      Focus: ${query.feature || 'the page as a whole'}

      Report the documented capabilities, states and transitions a test planner could turn into scenarios.
    `;
  }

  private saveDigest(query: ScoutQuery, digest: string): string {
    const filePath = this.digestPath(query);
    const dir = outputPath('scout');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const frontmatter: Record<string, any> = {};
    if (query.url) frontmatter.url = query.url;
    if (query.feature) frontmatter.feature = query.feature;
    if (query.excludeUrls?.length) frontmatter.excludeUrls = query.excludeUrls;
    frontmatter.cachedAt = new Date().toISOString();
    const content = matter.stringify(digest, frontmatter);
    writeFileSync(filePath, content, 'utf8');
    tag('data').log('scout', { path: filePath, content: digest });
    return filePath;
  }

  private digestPath(query: ScoutQuery): string {
    const cacheKey = `${query.url || ''}|${query.feature || ''}|${(query.excludeUrls || []).join(',')}`;
    const hash = createHash('sha1').update(cacheKey).digest('hex').slice(0, 8);
    const raw = query.feature || query.url || 'general';
    const name = sanitizeFilename(raw) || 'general';
    return join(outputPath('scout'), `digest-${name}-${hash}.md`);
  }

  private loadCachedDigest(query: ScoutQuery): string | null {
    const filePath = this.digestPath(query);
    if (!existsSync(filePath)) return null;
    if (Date.now() - statSync(filePath).mtimeMs > CACHE_TTL_MS) return null;
    const content = matter(readFileSync(filePath, 'utf8')).content;
    const words = content.split(/\s+/).filter(Boolean).length;
    tag('info').log(`Scout found previous spec digest in ${relative(process.cwd(), filePath)}`);
    tag('multiline').log(content);
    return content;
  }
}

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

export class ScoutQuery {
  url?: string;
  title?: string;
  feature?: string;
  excludeUrls?: string[];

  constructor(init?: Partial<ScoutQuery>) {
    if (init) Object.assign(this, init);
  }

  static fromState(state: { url?: string; title?: string }): ScoutQuery {
    return new ScoutQuery({ url: state.url, title: state.title });
  }

  get exclude(): string[] | undefined {
    return this.excludeUrls;
  }

  set exclude(value: string[] | undefined) {
    this.excludeUrls = value;
  }
}
