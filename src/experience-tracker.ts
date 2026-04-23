import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import matter from 'gray-matter';
import { type Tokens, marked } from 'marked';
import type { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import type { WebPageState } from './state-manager.js';
import { createDebug, tag } from './utils/logger.js';
import { mdq } from './utils/markdown-query.js';
import { extractStatePath } from './utils/url-matcher.js';

const debugLog = createDebug('explorbot:experience');
const DEFAULT_MAX_EXPERIENCE_LINES = 100;

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

  constructor(options: { disabled?: boolean } = {}) {
    const configParser = ConfigParser.getInstance();
    const config = configParser.getConfig();
    const configPath = configParser.getConfigPath();
    this.disabled = options.disabled ?? false;
    this.knowledgeTracker = new KnowledgeTracker();

    // Resolve experience directory relative to the config file location (project root)
    if (configPath) {
      const projectRoot = dirname(configPath);
      this.experienceDir = join(projectRoot, config.dirs?.experience || 'experience');
    } else {
      this.experienceDir = config.dirs?.experience || 'experience';
    }

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
    const filePath = this.getExperienceFilePath(stateHash);
    const fileContent = readFileSync(filePath, 'utf8');
    const { content, data } = matter(fileContent);
    return { content, data };
  }

  writeExperienceFile(stateHash: string, content: string, frontmatter?: any): void {
    if (this.disabled) {
      return;
    }
    const filePath = this.getExperienceFilePath(stateHash);
    const fileContent = matter.stringify(content, frontmatter || {});
    writeFileSync(filePath, fileContent, 'utf8');
  }

  hasRecentExperience(stateHash: string, prefix = ''): boolean {
    if (this.disabled) {
      return false;
    }
    if (prefix) {
      stateHash = `${prefix}_${stateHash}`;
    }
    const filePath = this.getExperienceFilePath(stateHash);
    if (!existsSync(filePath)) {
      return false;
    }
    const stats = statSync(filePath);
    return stats.mtime.getTime() > Date.now() - 1000 * 60 * 60 * 24;
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
      const frontmatter = {
        url: state.url ? extractStatePath(state.url) : '',
        title: state.title,
      };
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

    this.ensureExperienceFile(state);
    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);
    if (content.includes(action.code)) {
      debugLog('Skipping duplicate action', action.code);
      return;
    }

    const title = normalizeTitle(action.title.split('\n')[0]);
    if (!title) return;

    const filteredCode = action.code.replace(/I\.amOnPage\s*\([^)]*\)/gs, '');
    const newEntry = generateActionContent(title, filteredCode, action.explanation);
    const updatedContent = `${newEntry}\n\n${content}`;
    this.writeExperienceFile(stateHash, updatedContent, data);

    tag('substep').log(` Added ACTION to: ${stateHash}.md`);
  }

  writeFlow(state: ActionResult, body: string, relatedUrls?: string[]): void {
    if (this.disabled || this.isWritingDisabled(state)) return;
    if (!body?.trim()) return;

    this.ensureExperienceFile(state);
    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);

    if (content.includes(body)) {
      debugLog('Skipping duplicate flow body');
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

    tag('substep').log(`Added FLOW to: ${stateHash}.md`);
  }

  getAllExperience(): ExperienceFile[] {
    const allFiles: ExperienceFile[] = [];

    for (const experienceDir of this.getExperienceDirectories()) {
      if (!existsSync(experienceDir)) {
        continue;
      }

      try {
        const files = readdirSync(experienceDir)
          .filter((file: string) => file.endsWith('.md'))
          .map((file: string) => join(experienceDir, file));

        for (const file of files) {
          try {
            const content = readFileSync(file, 'utf8');
            const parsed = matter(content);
            const mtime = statSync(file).mtime;
            allFiles.push({
              filePath: file,
              data: parsed.data,
              content: parsed.content,
              mtime,
            });
          } catch (error) {
            debugLog(`Failed to read experience file ${file}:`, error);
          }
        }
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
        const lines = experience.content.split('\n');
        if (lines.length <= maxLines) return experience;
        return { ...experience, content: lines.slice(0, maxLines).join('\n') };
      });
  }

  /**
   * Clean up experience tracker (for testing)
   */
  cleanup(): void {
    // Clear any in-memory state if needed
    // The actual files will be cleaned up by test cleanup
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

      combined = renderAsHowTo(combined);

      if (options?.stripCode) {
        combined = mdq(combined).query('code').replace('');
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

    const toc: ExperienceTocEntry[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i];
      const fileHash = basename(record.filePath, '.md');
      const url = (record.data as WebPageState)?.url || '';
      const sections = listTocHeadings(record.content);
      if (sections.length === 0) continue;
      toc.push({
        fileTag: indexToLetters(i),
        fileHash,
        url,
        sections,
      });
    }
    return toc;
  }

  getExperienceSection(fileTag: string, sectionIndex: number, state: ActionResult, options?: { includeDescendantExperience?: boolean }): { title: string; url: string; content: string } | null {
    const toc = this.getExperienceTableOfContents(state, options);
    const entry = toc.find((e) => e.fileTag === fileTag);
    if (!entry) return null;

    const filePath = this.findExperienceFileByHash(entry.fileHash);
    if (!filePath) return null;

    const { content } = this.readExperienceFile(entry.fileHash);
    const extracted = extractHeadingSection(content, sectionIndex);
    if (!extracted) return null;

    return { title: extracted.title, url: entry.url, content: extracted.body };
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
      const cutoff = Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
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

    const toc: ExperienceTocEntry[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i];
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

  getExperienceSectionByTag(fileTag: string, sectionIndex: number, filter?: string): { title: string; url: string; content: string; fileHash: string } | null {
    const toc = this.listAllExperienceToc(filter);
    const entry = toc.find((e) => e.fileTag === fileTag);
    if (!entry) return null;

    const filePath = this.findExperienceFileByHash(entry.fileHash);
    if (!filePath) return null;

    const { content } = this.readExperienceFile(entry.fileHash);
    const extracted = extractHeadingSection(content, sectionIndex);
    if (!extracted) return null;

    return { title: extracted.title, url: entry.url, content: extracted.body, fileHash: entry.fileHash };
  }
}

function listTocHeadings(content: string): { index: number; level: 2 | 3; title: string }[] {
  const tokens = marked.lexer(content);
  const result: { index: number; level: 2 | 3; title: string }[] = [];
  let index = 0;
  for (const token of tokens) {
    if (token.type !== 'heading') continue;
    const heading = token as Tokens.Heading;
    if (heading.depth !== 2 && heading.depth !== 3) continue;
    index++;
    result.push({ index, level: heading.depth as 2 | 3, title: heading.text });
  }
  return result;
}

function extractHeadingSection(content: string, sectionIndex: number): { title: string; body: string } | null {
  const tokens = marked.lexer(content);
  const matching: { tokenIdx: number; depth: number; text: string }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'heading') continue;
    const heading = token as Tokens.Heading;
    if (heading.depth !== 2 && heading.depth !== 3) continue;
    matching.push({ tokenIdx: i, depth: heading.depth, text: heading.text });
  }

  if (sectionIndex < 1 || sectionIndex > matching.length) return null;

  const target = matching[sectionIndex - 1];
  let endTokenIdx = tokens.length;
  for (let j = target.tokenIdx + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.type !== 'heading') continue;
    if ((token as Tokens.Heading).depth <= target.depth) {
      endTokenIdx = j;
      break;
    }
  }

  const body = tokens
    .slice(target.tokenIdx, endTokenIdx)
    .map((t) => (t as any).raw || '')
    .join('');
  return { title: target.text, body };
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

export function renderExperienceToc(toc: ExperienceTocEntry[]): string {
  if (toc.length === 0) return '';

  const lines: string[] = [];
  lines.push('<experience>');
  lines.push('Past experience for this page — reusable recipes recorded from prior successful runs.');
  lines.push('FLOW: = multi-step recipe (bullets + code + discovery). ACTION: = single-step snippet (one code block).');
  lines.push('Call learn_experience({ fileTag, sectionIndex }) to read a section when it looks relevant to the current step.');
  lines.push('');
  for (const entry of toc) {
    lines.push(`File ${entry.fileTag} ${entry.url}:`);
    for (const section of entry.sections) {
      const prefix = '#'.repeat(section.level);
      lines.push(`  ${entry.fileTag}.${section.index} ${prefix} ${section.title}`);
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

function renderAsHowTo(content: string): string {
  const tokens = marked.lexer(content);
  let result = '';
  for (const token of tokens) {
    if (token.type === 'heading' && (token as Tokens.Heading).depth === 2) {
      const text = (token as Tokens.Heading).text.trim();
      if (text.startsWith('FLOW:')) {
        result += `## HOW to ${text.slice(5).trim()} (multi-step)\n\n`;
        continue;
      }
      if (text.startsWith('ACTION:')) {
        result += `## HOW to ${text.slice(7).trim()} (single-step)\n\n`;
        continue;
      }
    }
    result += (token as any).raw || '';
  }
  return result;
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
  sections: { index: number; level: 2 | 3; title: string }[];
}
