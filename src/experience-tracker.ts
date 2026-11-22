import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import matter from 'gray-matter';
import type { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import type { WebPageState } from './state-manager.js';
import { createDebug, pluralize, tag } from './utils/logger.js';
import { loadMarkdownFiles } from './utils/markdown-files.js';
import { type MarkdownQuery, mdq } from './utils/markdown-query.js';
import { redactSecrets } from './utils/secrets.js';
import { isNonReusableCode } from './utils/step-analyzer.ts';
import { extractStatePath } from './utils/url-matcher.js';

const debugLog = createDebug('explorbot:experience');
const DEFAULT_MAX_EXPERIENCE_LINES = 100;

export const DAY_MS = 24 * 60 * 60 * 1000;
export const RECORD_SELECTOR = 'section2(~"FLOW:") || section2(~"ACTION:")';
const USAGE_COMMENT = /^(added|used):/;

export const RECENT_WINDOW_DAYS = 30;

/**
 * Stores and reads per-page experience files (`./experience/<stateHash>.md`).
 *
 * Two writers, two contracts:
 *
 *   writeFlow(state, body, relatedUrls?)  — caller hands in a fully-formatted
 *                                            `## FLOW: <imperative title>` block (multi-step,
 *                                            `*` bullets + optional ```js``` + `>` discovery,
 *                                            ends with `---`). Tracker dedups + prepends.
 *   writeAction(state, ActionInput)        — `## ACTION: <imperative title>`, single-step,
 *                                            optional `Solution:` line + one ```js``` code block.
 *                                            Title normalized via normalizeTitle().
 *
 * - Always h2. Never h3 for FLOW/ACTION.
 * - On read (getSuccessfulExperience), headings are rendered as
 *   `## HOW to <title> (multi-step|single-step)` so prompts get natural phrasing.
 */
export class ExperienceTracker {
  private experienceDir: string;
  private disabled: boolean;
  private knowledgeTracker: KnowledgeTracker;

  constructor(knowledgeTracker: KnowledgeTracker, options: { disabled?: boolean } = {}) {
    const configParser = ConfigParser.getInstance();
    const config = configParser.getConfig();
    this.disabled = options.disabled ?? config.experience?.disabled ?? false;
    this.knowledgeTracker = knowledgeTracker;

    // Resolve experience directory relative to the config file location (project root)
    this.experienceDir = configParser.resolveProjectDir(config.dirs?.experience || 'experience');

    if (!this.disabled) {
      this.ensureDirectory(this.experienceDir);
    }
  }

  private getExperienceDirectories(): string[] {
    const directories = [this.experienceDir];

    // Also check for experience directory in current working directory
    const cwdExperienceDir = join(process.cwd(), 'experience');
    debugLog('Checking for experience directory in CWD:', cwdExperienceDir);
    debugLog('CWD experience dir exists:', existsSync(cwdExperienceDir));
    debugLog('CWD experience dir different from main:', cwdExperienceDir !== this.experienceDir);

    if (existsSync(cwdExperienceDir) && cwdExperienceDir !== this.experienceDir) {
      directories.push(cwdExperienceDir);
      debugLog('Added CWD experience directory:', cwdExperienceDir);
    }

    // Also check for experience directory in the directory where the script was run from
    // This is useful when running from subdirectories like 'example'
    const scriptCwd = process.env.INITIAL_CWD || process.cwd();
    const scriptExperienceDir = join(scriptCwd, 'experience');
    debugLog('Checking for experience directory in script CWD:', scriptExperienceDir);
    debugLog('Script CWD experience dir exists:', existsSync(scriptExperienceDir));

    if (existsSync(scriptExperienceDir) && scriptExperienceDir !== this.experienceDir && !directories.includes(scriptExperienceDir)) {
      directories.push(scriptExperienceDir);
      debugLog('Added script CWD experience directory:', scriptExperienceDir);
    }

    debugLog('Final experience directories:', directories);
    return directories;
  }

  private ensureDirectory(dir: string): void {
    if (this.disabled) {
      return;
    }
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  readExperienceFile(stateHash: string): { content: string; data: any } {
    return this.readExperienceFileAt(this.getExperienceFilePath(stateHash));
  }

  private readExperienceFileAt(filePath: string): { content: string; data: any } {
    const fileContent = readFileSync(filePath, 'utf8');
    const { content, data } = matter(fileContent);
    return { content, data };
  }

  writeExperienceFile(stateHash: string, content: string, frontmatter?: any): void {
    this.writeExperienceFileAt(this.getExperienceFilePath(stateHash), content, frontmatter);
  }

  writeExperienceFileAt(filePath: string, content: string, frontmatter?: any): void {
    if (this.disabled) {
      return;
    }
    const fileContent = matter.stringify(stampAdded(redactSecrets(content)), frontmatter || {});
    writeFileSync(filePath, fileContent, 'utf8');
  }

  private getExperienceFilePath(stateHash: string): string {
    return join(this.experienceDir, `${stateHash}.md`);
  }

  private ensureExperienceFile(state: ActionResult): string {
    if (this.disabled) {
      return '';
    }
    const stateHash = state.getStateHash();
    const filePath = this.getExperienceFilePath(stateHash);

    if (!existsSync(filePath)) {
      const frontmatter: Record<string, unknown> = {
        url: state.url ? extractStatePath(state.url) : '',
        title: state.title,
      };
      if (state.overlay.isOpen && state.overlay.name) {
        frontmatter.region = state.overlay.name;
        if (state.overlay.root) frontmatter.root = state.overlay.root;
      }
      this.writeExperienceFile(stateHash, '', frontmatter);
    }

    return filePath;
  }

  updateSummary(state: ActionResult, summary: string): void {
    if (this.disabled) return;
    const stateHash = state.getStateHash();
    this.ensureExperienceFile(state);
    const { content, data } = this.readExperienceFile(stateHash);
    data.summary = summary;
    this.writeExperienceFile(stateHash, content, data);
    debugLog(`Updated summary for ${stateHash}`);
  }

  private isWritingDisabled(state: ActionResult): boolean {
    return this.knowledgeTracker.getRelevantKnowledge(state).some((k) => k.noExperienceWriting === true || k.noExperienceWriting === 'true');
  }

  writeAction(state: ActionResult, action: ActionInput): void {
    if (this.disabled || this.isWritingDisabled(state)) return;
    if (!action.code?.trim()) return;
    if (isNonReusableCode(action.code)) {
      debugLog('Skipping action with non-reusable code: %s', action.code);
      return;
    }

    this.ensureExperienceFile(state);
    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);
    const duplicate = mdq(content)
      .query('section2')
      .each()
      .find((section) =>
        section
          .query('code')
          .meta()
          .some((m) => m.text.trim() === action.code.trim())
      );
    if (duplicate) {
      debugLog('Skipping duplicate action', action.code);
      this.markUsed(this.getExperienceFilePath(stateHash), duplicate.meta()[0].text);
      return;
    }

    const title = normalizeTitle(action.title.split('\n')[0]);
    if (!title) return;

    const filteredCode = action.code.replace(/I\.amOnPage\s*\([^)]*\)/gs, '');
    const newEntry = generateActionContent(title, filteredCode, action.explanation);
    const updatedContent = `${newEntry}\n\n${content}`;
    this.writeExperienceFile(stateHash, updatedContent, data);

    tag('operation').log(`Added ACTION to: ${stateHash}.md`);
  }

  writeFlow(state: ActionResult, body: string, relatedUrls?: string[]): void {
    if (this.disabled || this.isWritingDisabled(state)) return;
    if (!body?.trim()) return;
    if (isNonReusableCode(body)) {
      debugLog('Skipping flow body with non-reusable code');
      return;
    }

    this.ensureExperienceFile(state);
    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);

    const normalizedBody = this.stripUsageComments(stampAdded(body)).trim();
    const duplicate = mdq(content)
      .query('section2')
      .each()
      .find((s) => this.stripUsageComments(s.text()).trim() === normalizedBody);
    if (duplicate) {
      debugLog('Skipping duplicate flow body');
      this.markUsed(this.getExperienceFilePath(stateHash), duplicate.meta()[0].text);
      return;
    }

    if (relatedUrls?.length) {
      const currentPath = extractStatePath(state.url || '');
      const existingRelated = Array.isArray(data.related) ? data.related : [];
      const allRelated = [...new Set([...existingRelated, ...relatedUrls])];
      data.related = allRelated.filter((url) => url !== currentPath);
    }

    const updatedContent = `${body}\n${content}`;
    this.writeExperienceFile(stateHash, updatedContent, data);

    tag('operation').log(`Added FLOW to: ${stateHash}.md`);
  }

  getAllExperience(): ExperienceFile[] {
    const allFiles: ExperienceFile[] = [];

    for (const experienceDir of this.getExperienceDirectories()) {
      if (!existsSync(experienceDir)) {
        continue;
      }

      try {
        allFiles.push(
          ...loadMarkdownFiles(experienceDir, {
            onError: (filePath, error) => debugLog(`Failed to read experience file ${filePath}:`, error),
          })
        );
      } catch (error) {
        debugLog(`Failed to read experience directory ${experienceDir}:`, error);
      }
    }

    return allFiles;
  }

  getRelevantExperience(state: ActionResult, options?: { includeDescendantExperience?: boolean }): ExperienceFile[] {
    const relevantKnowledge = this.knowledgeTracker.getRelevantKnowledge(state);
    const readingDisabled = relevantKnowledge.some((knowledge) => knowledge.noExperienceReading === true || knowledge.noExperienceReading === 'true');
    if (readingDisabled) {
      return [];
    }
    const config = ConfigParser.getInstance().getConfig();
    const maxLines = config.experience?.maxReadLines ?? DEFAULT_MAX_EXPERIENCE_LINES;

    return this.getAllExperience()
      .filter((experience) => {
        const experienceState = experience.data as WebPageState;
        return state.isRelevantExperienceRecord(experienceState, {
          includeDescendantExperience: options?.includeDescendantExperience,
        });
      })
      .map((experience) => {
        if (this.stripUsageComments(experience.content).split('\n').length <= maxLines) return experience;
        let content = experience.content;
        while (this.stripUsageComments(content).split('\n').length > maxLines) {
          const sections = mdq(content).query('section2').each();
          if (sections.length <= 1) break;
          content = sections[sections.length - 1].replace('').toString();
        }
        return { ...experience, content };
      });
  }

  getSuccessfulExperience(state: ActionResult, options?: { includeDescendants?: boolean; stripCode?: boolean }): string[] {
    const records = this.getRelevantExperience(state, {
      includeDescendantExperience: options?.includeDescendants,
    });

    const results: string[] = [];
    for (const record of records) {
      if (!record.content) continue;

      const flows = mdq(record.content).query('section(~"FLOW:")').text();
      const actions = mdq(record.content).query('section(~"ACTION:")').text();
      let combined = [flows, actions].filter(Boolean).join('\n\n');

      if (!combined.trim()) continue;

      combined = this.renderAsHowTo(combined);

      if (options?.stripCode) {
        combined = mdq(combined).query('code').replace('').toString();
      }

      if (combined.trim()) results.push(combined.trim());
    }

    return results;
  }

  getExperienceTableOfContents(state: ActionResult, options?: { includeDescendantExperience?: boolean }): ExperienceTocEntry[] {
    const records = this.getRelevantExperience(state, options);
    if (records.length === 0) return [];

    const sorted = [...records].sort((a, b) => {
      const aHash = basename(a.filePath, '.md');
      const bHash = basename(b.filePath, '.md');
      return aHash.localeCompare(bHash);
    });

    return this.buildToc(sorted);
  }

  renderExperienceFor(state: ActionResult): string {
    const successful = this.getSuccessfulExperience(state);
    if (!successful.length) return '';

    tag('operation').log(`Found ${successful.length} experience ${pluralize(successful.length, 'file')} for: ${state.url}`);
    return renderExperienceRecipes(successful);
  }

  renderExperienceTocFor(state: ActionResult): string {
    const toc = this.getExperienceTableOfContents(state);
    if (toc.length === 0) return '';

    const totalSections = toc.reduce((sum, entry) => sum + entry.sections.length, 0);
    debugLog(`injecting experience TOC (${toc.length} files, ${totalSections} sections)`);
    tag('operation').log(`Found ${toc.length} experience ${pluralize(toc.length, 'file')} (${totalSections} sections)`);
    return renderExperienceToc(toc);
  }

  getExperienceSection(fileTag: string, sectionIndex: number, state: ActionResult, options?: { includeDescendantExperience?: boolean }): { title: string; url: string; content: string } | null {
    const toc = this.getExperienceTableOfContents(state, options);
    const entry = toc.find((e) => e.fileTag === fileTag);
    if (!entry) return null;

    const filePath = this.findExperienceFileByHash(entry.fileHash);
    const extracted = this.readSectionByHash(entry.fileHash, sectionIndex);
    if (!filePath || !extracted) return null;

    if (!this.isWritingDisabled(state)) this.markUsed(filePath, extracted.title);
    return { title: extracted.title, url: entry.url, content: this.stripUsageComments(extracted.body) };
  }

  getRecordUsage(record: string): RecordUsage {
    const usage: RecordUsage = {};
    const added = commentDate(record, 'added');
    const used = commentDate(record, 'used');
    if (added) usage.added = added;
    if (used) usage.used = used;
    return usage;
  }

  stripUsageComments(content: string): string {
    return mdq(content).comment(USAGE_COMMENT).remove().toString();
  }

  restoreLastUsed(original: string, rewritten: string): string {
    const lastUsed = mdq(original)
      .query(RECORD_SELECTOR)
      .each()
      .map((record) => this.getRecordUsage(record.text()).used)
      .filter((date): date is Date => !!date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (!lastUsed) return rewritten;

    return mdq(rewritten)
      .query(RECORD_SELECTOR)
      .replaceEach((record) => {
        if (this.getRecordUsage(record.text()).used) return record.text();
        return stampUsed(mdq(stampAdded(record.text())), 0, lastUsed).toString();
      })
      .toString();
  }

  private buildToc(records: ExperienceFile[]): ExperienceTocEntry[] {
    const toc: ExperienceTocEntry[] = [];
    for (const record of records) {
      const sections = listTocHeadings(record.content);
      if (sections.length === 0) continue;
      toc.push({
        fileTag: indexToLetters(toc.length),
        fileHash: basename(record.filePath, '.md'),
        url: (record.data as WebPageState)?.url || '',
        sections,
      });
    }
    return toc;
  }

  private readSectionByHash(fileHash: string, sectionIndex: number): { title: string; body: string } | null {
    const filePath = this.findExperienceFileByHash(fileHash);
    if (!filePath) return null;
    const { content } = this.readExperienceFileAt(filePath);
    return extractHeadingSection(content, sectionIndex);
  }

  private findExperienceFileByHash(fileHash: string): string | null {
    for (const dir of this.getExperienceDirectories()) {
      const candidate = join(dir, `${fileHash}.md`);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  listAllExperienceToc(filter?: string, options?: { recency?: 'recent' | 'old' }): ExperienceTocEntry[] {
    const records = this.getAllExperience();
    if (records.length === 0) return [];

    const trimmed = filter?.trim();
    let matching = records;

    if (trimmed) {
      if (trimmed.endsWith('.md')) {
        const bare = trimmed.slice(0, -3);
        const byFilename = records.find((record) => basename(record.filePath, '.md') === bare);
        matching = byFilename ? [byFilename] : [];
      } else {
        const lower = trimmed.toLowerCase();
        matching = records.filter((record) => {
          const url = ((record.data as WebPageState)?.url || '').toLowerCase();
          if (!url) return false;
          return url.includes(lower);
        });
      }
    }

    if (options?.recency) {
      const cutoff = Date.now() - RECENT_WINDOW_DAYS * DAY_MS;
      matching = matching.filter((record) => {
        const isRecent = record.mtime.getTime() >= cutoff;
        return options.recency === 'recent' ? isRecent : !isRecent;
      });
    }

    const sorted = matching.sort((a, b) => {
      const aUrl = (a.data as WebPageState)?.url || '';
      const bUrl = (b.data as WebPageState)?.url || '';
      return aUrl.localeCompare(bUrl);
    });

    return this.buildToc(sorted);
  }

  getExperienceSectionByTag(fileTag: string, sectionIndex: number, filter?: string): { title: string; url: string; content: string; fileHash: string } | null {
    const toc = this.listAllExperienceToc(filter);
    const entry = toc.find((e) => e.fileTag === fileTag);
    if (!entry) return null;

    const extracted = this.readSectionByHash(entry.fileHash, sectionIndex);
    if (!extracted) return null;

    return { title: extracted.title, url: entry.url, content: extracted.body, fileHash: entry.fileHash };
  }

  private markUsed(filePath: string, title: string): void {
    if (this.disabled) return;
    const doc = mdq(readFileSync(filePath, 'utf8'));
    const index = doc
      .query('section2')
      .meta()
      .findIndex((m) => m.text === title);
    if (index < 0) return;

    const used = this.getRecordUsage(doc.query('section2').at(index).text()).used;
    if (used && dayOf(used) === dayOf(new Date())) return;

    writeFileSync(filePath, stampUsed(doc, index, new Date()).toString(), 'utf8');
    debugLog(`Marked experience record used in ${basename(filePath)}`);
  }

  private renderAsHowTo(content: string): string {
    return mdq(content)
      .query('section2')
      .replaceEach((section) => {
        const age = describeAge(section.text());
        const body = mdq(this.stripUsageComments(section.text()));
        const text = body.query('h2').meta()[0]?.text.trim() || '';
        let kind = '';
        let title = '';
        if (text.startsWith('FLOW:')) {
          kind = 'multi-step';
          title = text.slice(5).trim();
        }
        if (text.startsWith('ACTION:')) {
          kind = 'single-step';
          title = text.slice(7).trim();
        }
        if (!kind) return body.toString();
        if (age) kind += `, ${age}`;
        return body.query('h2').replace(`## HOW to ${title} (${kind})\n\n`).toString();
      })
      .toString();
  }
}

function listTocHeadings(content: string): { index: number; level: 2 | 3; title: string; age: string }[] {
  const sections = mdq(content).query('section').each();
  return mdq(content)
    .query('section')
    .meta()
    .map((meta, i) => ({ meta, section: sections[i] }))
    .filter((entry) => entry.meta.depth === 2 || entry.meta.depth === 3)
    .map((entry, i) => ({ index: i + 1, level: entry.meta.depth as 2 | 3, title: entry.meta.text, age: describeAge(entry.section.text()) }));
}

function extractHeadingSection(content: string, sectionIndex: number): { title: string; body: string } | null {
  const sections = mdq(content).query('section').each();
  const metas = mdq(content).query('section').meta();
  const matching = metas.map((meta, i) => ({ meta, section: sections[i] })).filter((entry) => entry.meta.depth === 2 || entry.meta.depth === 3);

  if (sectionIndex < 1 || sectionIndex > matching.length) return null;

  const target = matching[sectionIndex - 1];
  return { title: target.meta.text, body: target.section.text() };
}

function indexToLetters(index: number): string {
  let n = index;
  let result = '';
  while (true) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26);
    if (n === 0) break;
    n -= 1;
  }
  return result;
}

export function renderExperienceRecipes(recipes: string[]): string {
  if (recipes.length === 0) return '';
  return `<experience>\nPast successful recipes recorded from prior runs for this page. Prefer these solutions first if they match the goal.\n\n${recipes.join('\n\n')}\n</experience>`;
}

export function renderExperienceToc(toc: ExperienceTocEntry[]): string {
  if (toc.length === 0) return '';

  const lines: string[] = [];
  lines.push('<experience>');
  lines.push('Past experience for this page — recipes recorded from prior successful runs.');
  lines.push('Locators and step ordering worked then; the page may have changed since.');
  lines.push('Treat as a starting hypothesis, not ground truth. If a step fails, fall back to ARIA/UI-map.');
  lines.push('FLOW: = multi-step recipe (bullets + code + discovery). ACTION: = single-step snippet (one code block).');
  lines.push('Call learnExperience({ fileTag, sectionIndex }) to read a section when it looks relevant to the current step.');
  lines.push('');
  for (const entry of toc) {
    lines.push(`File ${entry.fileTag} ${entry.url}:`);
    for (const section of entry.sections) {
      const prefix = '#'.repeat(section.level);
      let line = `  ${entry.fileTag}.${section.index} ${prefix} ${section.title}`;
      if (section.age) line += ` (${section.age})`;
      lines.push(line);
    }
    lines.push('');
  }
  lines.push('</experience>');
  return lines.join('\n');
}

function normalizeTitle(raw: string): string {
  let t = (raw || '').trim();
  for (const p of ['FLOW:', 'ACTION:']) {
    if (t.toLowerCase().startsWith(p.toLowerCase())) {
      t = t.slice(p.length).trim();
      break;
    }
  }
  while (t.length > 0 && '.!?,;:'.includes(t[t.length - 1])) {
    t = t.slice(0, -1);
  }
  if (t.length > 0) t = t[0].toLowerCase() + t.slice(1);
  return t;
}

function generateActionContent(title: string, code: string, explanation?: string): string {
  const lines: string[] = [];
  lines.push(`## ACTION: ${title}`);
  lines.push('');
  if (explanation) {
    lines.push(`Solution: ${explanation}`);
    lines.push('');
  }
  lines.push('```javascript');
  lines.push(code);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

function stampAdded(content: string): string {
  if (!mdq(content).query(RECORD_SELECTOR).exists()) return content;
  const now = new Date().toISOString();
  return mdq(content)
    .query(RECORD_SELECTOR)
    .replaceEach((record) => {
      if (commentDate(record.text(), 'added')) return record.text();
      return mdq(record.text()).query('h2').first().insertAfter(`<!-- added: ${now} -->`).toString();
    })
    .toString();
}

function stampUsed(doc: MarkdownQuery, index: number, date: Date): MarkdownQuery {
  const record = doc
    .query('section2')
    .at(index)
    .comment(/^used:/)
    .remove()
    .query('section2')
    .at(index);
  let anchor = record.comment(/^added:/).first();
  if (!anchor.exists()) anchor = record.query('h2').first();
  return anchor.insertAfter(`<!-- used: ${date.toISOString()} -->`);
}

function commentDate(record: string, key: string): Date | undefined {
  const comment = mdq(record)
    .comment(new RegExp(`^${key}:`))
    .nodes()[0];
  if (!comment) return undefined;
  const date = new Date(comment.text.slice(key.length + 1).trim());
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
}

function describeAge(record: string): string {
  const used = commentDate(record, 'used');
  if (used) return `used ${daysAgo(used)}`;
  const added = commentDate(record, 'added');
  if (added) return `never used, added ${daysAgo(added)}`;
  return '';
}

function daysAgo(date: Date): string {
  const days = Math.round((Date.parse(dayOf(new Date())) - Date.parse(dayOf(date))) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface ExperienceFile {
  filePath: string;
  data: { url?: string; title?: string; [key: string]: any };
  content: string;
  mtime: Date;
}

export interface ActionInput {
  title: string;
  code: string;
  explanation?: string;
}

export interface SessionStep {
  message: string;
  status: 'passed' | 'failed' | 'neutral';
  tool?: string;
  code?: string;
  discovery?: string;
}

export interface ExperienceTocEntry {
  fileTag: string;
  fileHash: string;
  url: string;
  sections: { index: number; level: 2 | 3; title: string; age: string }[];
}

export interface RecordUsage {
  added?: Date;
  used?: Date;
}
