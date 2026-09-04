import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import dedent from 'dedent';
import { tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Provider } from './provider.ts';
import { type ScoutCorpus, createScoutTools, excludeCorpusUrls } from './scout/tools.ts';

const MAX_ITERATIONS = 3;
const MAX_TOOL_ROUNDTRIPS = 5;
const CACHE_LIMIT = 40;
const URL_LISTING_LIMIT = 40;
const NOTES_INJECT_LIMIT = 5;
const NOTES_INJECT_CHARS = 2000;

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

    const cacheKey = `${query.url || ''}|${query.feature || ''}|${query.excludeUrls.join(',')}`;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const corpus = excludeCorpusUrls(this.corpus, query.excludeUrls);
    if (corpus.files.length === 0) return '';

    const result = await this.runSession(corpus, query);
    if (result === null) return '';

    if (this.cache.size > CACHE_LIMIT) this.cache.clear();
    this.cache.set(cacheKey, result);
    return result;
  }

  private async runSession(corpus: ScoutCorpus, query: ScoutQuery): Promise<string | null> {
    const { tools, getResult, isFinished, finishFromText } = createScoutTools(corpus);
    const conversation = this.provider.startConversation(this.buildSystemPrompt(Object.keys(tools), corpus), 'scout', this.provider.getAgenticModel('scout'));
    conversation.addUserText(this.buildTaskPrompt(query));

    tag('info').log(`Scout: collecting documentation for ${query.feature || query.url || 'the current page'}`);

    let failed = false;
    await loop(
      async ({ stop, iteration }) => {
        const invokeResult = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS,
          agentName: 'scout',
        });

        if (isFinished()) {
          stop();
          return;
        }

        if (!invokeResult?.toolExecutions?.length) {
          finishFromText(invokeResult?.response?.text);
          stop();
          return;
        }

        if (iteration >= MAX_ITERATIONS) stop();
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
      const preview = digest.slice(0, 600);
      const ellipsis = digest.length > 600 ? '…' : '';
      tag('info').log(`Scout digest:\n${preview}${ellipsis}`);
    }
    return digest;
  }

  private buildSystemPrompt(toolNames: string[], corpus: ScoutCorpus): string {
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
      if (remaining > 0) pagesListing += `\n…and ${remaining} more — find them with searchDocs`;
    }
    let notesBlock = '';
    if (urlless.length > 0) {
      const listing = urlless
        .slice(0, URL_LISTING_LIMIT)
        .map((file) => `- ${relative(process.cwd(), file.path)}`)
        .join('\n');
      pagesListing += `\nFiles with no page URL (hand-written docs):\n${listing}`;

      const notes = urlless
        .slice(0, NOTES_INJECT_LIMIT)
        .map((file) => `--- ${relative(process.cwd(), file.path)}\n${readFileSync(file.path, 'utf8').slice(0, NOTES_INJECT_CHARS)}`)
        .join('\n\n');
      notesBlock = `HAND-WRITTEN NOTES (placed in the corpus deliberately):\n${notes}`;
    }

    const prompt = dedent`
      You are Scout — a documentation retrieval agent. You find collected documentation relevant to a testing focus and report it for test planning.

      You never see the application itself. The documentation corpus is your only source of truth.

      CORPUS:
      ${corpus.files.length} markdown files under:
      - ${corpus.dirs.join('\n- ')}
      ${pagesListing}

      ${notesBlock}

      AVAILABLE TOOLS:
      ${toolNames.join(', ')}.
      Use tool names exactly as listed. Do not invent aliases or combined names.
      Match each tool input schema exactly. Do not invent parameter names or pass extra fields.

      WORKFLOW:
      1. Search several times with different words from the focus — feature names, page purposes, capabilities. Documents are written in prose, so plain words match where a URL does not
      2. Read the files whose hits look most relevant
      3. Call report with a digest of what the documentation says

      RULES:
      - Report only what the documentation states. Never fill gaps with assumptions about the application
      - Keep verified capabilities and unverified possibilities distinguishable, the way the documentation marks them
      - Name the page URL each item belongs to, so scenarios anchor to real routes
      - Files with no page URL were placed in the corpus on purpose — read the ones relevant to the focus before reporting
      - A short accurate digest beats a long loose one; reporting that nothing relevant exists is a valid answer
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
}

export interface ScoutQuery {
  url?: string;
  title?: string;
  feature?: string;
  excludeUrls: string[];
}
