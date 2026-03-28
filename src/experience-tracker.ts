import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import matter from 'gray-matter';
import type { ActionResult } from './action-result.js';
import { ConfigParser } from './config.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import type { WebPageState } from './state-manager.js';
import { createDebug, tag } from './utils/logger.js';
import { mdq } from './utils/markdown-query.js';
import { extractStatePath } from './utils/url-matcher.js';

const debugLog = createDebug('explorbot:experience');
const DEFAULT_MAX_EXPERIENCE_LINES = 100;

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

  async saveSuccessfulResolution(state: ActionResult, originalMessage: string, code: string, explanation?: string): Promise<void> {
    if (this.disabled || this.isWritingDisabled(state)) return;

    this.ensureExperienceFile(state);
    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);
    if (content.includes(code)) {
      debugLog('Skipping duplicate successful resolution', code);
      return;
    }

    const filteredCode = code.replace(/I\.amOnPage\s*\([^)]*\)/gs, '');
    const newEntryContent = `### SUCCEEDED: ${originalMessage.split('\n')[0]}

${explanation ? `Solution: ${explanation}` : ''}

\`\`\`javascript
${filteredCode}
\`\`\`
`;

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

  getRelevantExperience(state: ActionResult, options?: { includeDescendantExperience?: boolean }): { filePath: string; data: any; content: string }[] {
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

  saveSessionExperience(state: ActionResult, entry: SessionExperienceEntry): void {
    if (this.disabled || this.isWritingDisabled(state)) return;

    this.ensureExperienceFile(state);
    const stateHash = state.getStateHash();
    const { content, data } = this.readExperienceFile(stateHash);

    if (entry.relatedUrls?.length) {
      const currentPath = extractStatePath(state.url || '');
      const existingRelated = Array.isArray(data.related) ? data.related : [];
      const allRelated = [...new Set([...existingRelated, ...entry.relatedUrls])];
      data.related = allRelated.filter((url) => url !== currentPath);
    }

    const sessionContent = this.generateSessionContent(entry);
    const updatedContent = `${sessionContent}\n${content}`;
    this.writeExperienceFile(stateHash, updatedContent, data);

    tag('substep').log(`Added session experience to: ${stateHash}.md`);
  }

  private generateSessionContent(entry: SessionExperienceEntry): string {
    let content = `## Successful Flow: ${entry.scenario}\n\n`;

    for (const step of entry.steps) {
      content += `* ${step.message}\n\n`;
      if (step.code) {
        content += '```js\n';
        content += `${step.code}\n`;
        content += '```\n\n';
      }
      if (step.discovery) {
        const discoveries = step.discovery.split('\n').filter((d) => d.trim());
        for (const discovery of discoveries) {
          content += `> ${discovery.trim()}\n\n`;
        }
      }
    }

    content += '---\n';
    return content;
  }

  getSuccessfulExperience(state: ActionResult, options?: { includeDescendants?: boolean; stripCode?: boolean }): string[] {
    const records = this.getRelevantExperience(state, {
      includeDescendantExperience: options?.includeDescendants,
    });

    const results: string[] = [];
    for (const record of records) {
      if (!record.content) continue;

      const successFlows = mdq(record.content).query('section(~"Successful Flow")').text();
      const succeeded = mdq(record.content).query('section(~"SUCCEEDED")').text();
      let combined = [successFlows, succeeded].filter(Boolean).join('\n\n');

      if (!combined.trim()) continue;

      if (options?.stripCode) {
        combined = mdq(combined).query('code').replace('');
      }

      if (combined.trim()) results.push(combined.trim());
    }

    return results;
  }
}

export interface SessionStep {
  message: string;
  status: 'passed' | 'failed' | 'neutral';
  tool?: string;
  code?: string;
  discovery?: string;
}

export interface SessionExperienceEntry {
  scenario: string;
  result: 'success' | 'partial' | 'failed';
  steps: SessionStep[];
  relatedUrls?: string[];
}
