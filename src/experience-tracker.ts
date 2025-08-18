import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import debug from 'debug';
import matter from 'gray-matter';
import type { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';
import { log } from './utils/logger.js';

const debugLog = debug('explorbot:experience');

interface ExperienceEntry {
  timestamp: string;
  status: 'failed' | 'success';
  code: string;
  attempt?: number;
  error?: string | null;
  originalMessage: string;
}

export class ExperienceTracker {
  private experienceDir: string;

  constructor() {
    const configParser = ConfigParser.getInstance();
    const config = configParser.getConfig();
    this.experienceDir = config.dirs?.experience || 'experience';
    this.ensureDirectory(this.experienceDir);
  }

  private ensureDirectory(dir: string): void {
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

  writeExperienceFile(
    stateHash: string,
    content: string,
    frontmatter?: any
  ): void {
    const filePath = this.getExperienceFilePath(stateHash);
    const fileContent = matter.stringify(content, frontmatter || {});
    writeFileSync(filePath, fileContent, 'utf8');
  }

  private getExperienceFilePath(stateHash: string): string {
    return join(this.experienceDir, `${stateHash}.md`);
  }

  private compactError(error: string | null): string | null {
    if (!error) return null;

    // Extract first line of error, remove stack traces and extra details
    const firstLine = error.split('\n')[0];
    return firstLine.length > 100
      ? `${firstLine.substring(0, 100)}...`
      : firstLine;
  }

  private ensureExperienceFile(state: ActionResult): string {
    const stateHash = state.getStateHash();
    const filePath = this.getExperienceFilePath(stateHash);

    if (!existsSync(filePath)) {
      const frontmatter = {
        url: state.url,
        title: state.title,
      };
      this.writeExperienceFile(stateHash, '', frontmatter);
    }

    return filePath;
  }

  private appendToExperienceFile(
    state: ActionResult,
    entry: ExperienceEntry
  ): void {
    const filePath = this.ensureExperienceFile(state);

    const newEntryContent = this.generateEntryContent(entry);
    writeFileSync(filePath, newEntryContent, { flag: 'a', encoding: 'utf8' });
  }

  private generateEntryContent(entry: ExperienceEntry): string {
    const content = `### ${entry.error ? 'Failed Attempt' : 'Successful Attempt'}

${entry.originalMessage ? `Purpose: ${entry.originalMessage}` : ''}
${entry.error ? `Error: ${entry.error} from:` : ''}

\`\`\`javascript
${entry.code}
\`\`\`
`;

    return content;
  }

  async saveFailedAttempt(
    state: ActionResult,
    originalMessage: string,
    code: string,
    executionError: string | null,
    attempt: number
  ): Promise<void> {
    const newEntry: ExperienceEntry = {
      timestamp: new Date().toISOString(),
      attempt,
      status: 'failed',
      code,
      error: this.compactError(executionError),
      originalMessage: originalMessage.split('\n')[0],
    };

    log('code failed', code, newEntry.error);
    this.appendToExperienceFile(state, newEntry);
    log(`📝 Added failed attempt ${attempt} to: ${state.getStateHash()}.md`);
  }

  async saveSuccessfulResolution(
    state: ActionResult,
    originalMessage: string,
    code: string
  ): Promise<void> {
    const newEntry: ExperienceEntry = {
      timestamp: new Date().toISOString(),
      status: 'success',
      code,
      error: null,
      originalMessage: originalMessage.split('\n')[0],
    };

    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);
    const newEntryContent = this.generateEntryContent(newEntry);
    const updatedContent = newEntryContent + '\n\n' + content;
    this.writeExperienceFile(stateHash, updatedContent, data);

    log(`✅ Added successful resolution to: ${stateHash}.md`);
  }
}
