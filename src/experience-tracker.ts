import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import type { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import type { WebPageState } from './state-manager.js';
import { createDebug, log, tag } from './utils/logger.js';

const debugLog = createDebug('explorbot:experience');

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

  private compactError(error: string | null): string | null {
    if (!error) return null;

    // Extract first line of error, remove stack traces and extra details
    const firstLine = error.split('\n')[0];
    return firstLine.length > 100 ? `${firstLine.substring(0, 100)}...` : firstLine;
  }

  private ensureExperienceFile(state: ActionResult): string {
    if (this.disabled) {
      return '';
    }
    const stateHash = state.getStateHash();
    const filePath = this.getExperienceFilePath(stateHash);

    if (!existsSync(filePath)) {
      const frontmatter = {
        url: state.url ? this.extractStatePath(state.url) : '',
        title: state.title,
      };
      this.writeExperienceFile(stateHash, '', frontmatter);
    }

    return filePath;
  }

  private appendToExperienceFile(state: ActionResult, entry: ExperienceEntry): void {
    if (this.disabled) {
      return;
    }
    const filePath = this.ensureExperienceFile(state);

    const newEntryContent = this.generateEntryContent(entry);
    writeFileSync(filePath, newEntryContent, { flag: 'a', encoding: 'utf8' });
  }

  private generateEntryContent(entry: ExperienceEntry): string {
    const content = `### ${entry.error ? 'Failed Attempt' : 'Successful Attempt'}

${entry.originalMessage ? `Purpose: ${entry.originalMessage}` : ''}
${entry.error ? `${entry.error} from:` : ''}

\`\`\`javascript
${entry.code}
\`\`\`
`;

    return content;
  }

  async saveFailedAttempt(state: ActionResult, originalMessage: string, code: string, executionError: string | null): Promise<void> {
    if (this.disabled) {
      return;
    }
    const relevantKnowledge = this.knowledgeTracker.getRelevantKnowledge(state);
    const writingDisabled = relevantKnowledge.some((knowledge) => knowledge.noExperienceWriting === true || knowledge.noExperienceWriting === 'true');
    if (writingDisabled) {
      return;
    }
    const newEntry: ExperienceEntry = {
      timestamp: new Date().toISOString(),
      attempt: 1,
      status: 'failed',
      code,
      error: this.compactError(executionError),
      originalMessage: originalMessage.split('\n')[0],
    };

    this.appendToExperienceFile(state, newEntry);
    tag('substep').log(`Added failed attempt to: ${state.getStateHash()}.md`);
  }

  async saveSuccessfulResolution(state: ActionResult, originalMessage: string, code: string): Promise<void> {
    if (this.disabled) {
      return;
    }
    const relevantKnowledge = this.knowledgeTracker.getRelevantKnowledge(state);
    const writingDisabled = relevantKnowledge.some((knowledge) => knowledge.noExperienceWriting === true || knowledge.noExperienceWriting === 'true');
    if (writingDisabled) {
      return;
    }
    const newEntry: ExperienceEntry = {
      timestamp: new Date().toISOString(),
      status: 'success',
      code,
      error: null,
      originalMessage: originalMessage.split('\n')[0],
    };

    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);
    if (content.includes(code)) {
      debugLog('Skipping duplicate successful resolution', code);
      return;
    }

    const newEntryContent = this.generateEntryContent(newEntry);
    const updatedContent = `${newEntryContent}\n\n${content}`;
    this.writeExperienceFile(stateHash, updatedContent, data);

    tag('substep').log(` Added successful resolution to: ${stateHash}.md`);
  }

  getAllExperience(): { filePath: string; data: any; content: string }[] {
    const allFiles: { filePath: string; data: any; content: string }[] = [];

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
            allFiles.push({
              filePath: file,
              data: parsed.data,
              content: parsed.content,
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

  getRelevantExperience(state: ActionResult): { filePath: string; data: any; content: string }[] {
    const relevantKnowledge = this.knowledgeTracker.getRelevantKnowledge(state);
    const readingDisabled = relevantKnowledge.some((knowledge) => knowledge.noExperienceReading === true || knowledge.noExperienceReading === 'true');
    if (readingDisabled) {
      return [];
    }
    return this.getAllExperience().filter((experience) => {
      const experienceState = experience.data as WebPageState;
      return state.url === experienceState.url || (experienceState.url && state.url && (state.url.includes(experienceState.url) || experienceState.url.includes(state.url)));
    });
  }

  private extractStatePath(url: string): string {
    if (url.startsWith('/')) {
      return url;
    }
    try {
      const urlObj = new URL(url);
      return urlObj.pathname + urlObj.hash;
    } catch {
      return url;
    }
  }

  /**
   * Clean up experience tracker (for testing)
   */
  cleanup(): void {
    // Clear any in-memory state if needed
    // The actual files will be cleaned up by test cleanup
  }
}
