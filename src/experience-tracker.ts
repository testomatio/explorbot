import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import debug from 'debug';
import matter from 'gray-matter';
import type { ActionResult } from './action-result.js';

const debugLog = debug('explorbot:experience');

interface ExperienceEntry {
  timestamp: string;
  attempt: number;
  status: 'failed' | 'success';
  code: string;
  error: string | null;
  originalMessage: string;
}

export class ExperienceTracker {
  private experienceDir: string;

  constructor(experienceDir: string) {
    this.experienceDir = experienceDir;
    this.ensureDirectory(experienceDir);
  }

  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private getExperienceFilePath(stateHash: string): string {
    return join(this.experienceDir, `${stateHash}.md`);
  }

  private readExistingExperience(filePath: string): {
    frontmatter: any;
    entries: ExperienceEntry[];
  } {
    if (!existsSync(filePath)) {
      return { frontmatter: {}, entries: [] };
    }

    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const parsed = matter(fileContent);

      return {
        frontmatter: parsed.data,
        entries: parsed.data.experiences || [],
      };
    } catch (error) {
      return { frontmatter: {}, entries: [] };
    }
  }

  private compactError(error: string | null): string | null {
    if (!error) return null;

    // Extract first line of error, remove stack traces and extra details
    const firstLine = error.split('\n')[0];
    return firstLine.length > 100
      ? `${firstLine.substring(0, 100)}...`
      : firstLine;
  }

  private writeExperienceFile(
    state: ActionResult,
    entries: ExperienceEntry[],
    existingFrontmatter: any = {}
  ): void {
    const stateHash = state.getStateHash();
    const filePath = this.getExperienceFilePath(stateHash);

    const frontmatter = {
      ...existingFrontmatter,
      url: state.url,
      title: state.title,
      lastUpdated: new Date().toISOString(),
    };

    const content = this.generateCompactContent(state, entries);
    const fileContent = matter.stringify(content, frontmatter);

    writeFileSync(filePath, fileContent, 'utf8');
  }

  async saveFailedAttempt(
    state: ActionResult,
    originalMessage: string,
    code: string,
    executionError: string | null,
    expectationError: string | null,
    attempt: number
  ): Promise<void> {
    const filePath = this.getExperienceFilePath(state.getStateHash());
    const existing = this.readExistingExperience(filePath);

    const newEntry: ExperienceEntry = {
      timestamp: new Date().toISOString(),
      attempt,
      status: 'failed',
      code,
      error: this.compactError(executionError || expectationError),
      originalMessage: originalMessage.split('\n')[0],
    };

    const updatedEntries = [...existing.entries, newEntry];

    console.log('code failed', code, newEntry.error);
    console.log(`📊 Total entries: ${updatedEntries.length} (existing: ${existing.entries.length}, new: 1)`);

    this.writeExperienceFile(state, updatedEntries, existing.frontmatter);
    console.log(`📝 Added failed attempt ${attempt} to: ${state.getStateHash()}.md`);
  }

  async saveSuccessfulResolution(
    state: ActionResult,
    originalMessage: string,
    code: string,
    totalAttempts: number
  ): Promise<void> {
    const filePath = this.getExperienceFilePath(state.getStateHash());
    const existing = this.readExistingExperience(filePath);

    const newEntry: ExperienceEntry = {
      timestamp: new Date().toISOString(),
      attempt: totalAttempts,
      status: 'success',
      code,
      error: null,
      originalMessage: originalMessage.split('\n')[0],
    };

    const updatedEntries = [...existing.entries, newEntry];

    this.writeExperienceFile(state, updatedEntries, existing.frontmatter);
    console.log(`✅ Added successful resolution to: ${state.getStateHash()}.md`);
  }

  private generateCompactContent(
    state: ActionResult,
    entries: ExperienceEntry[]
  ): string {
    const successfulEntries = entries.filter((e) => e.status === 'success');
    const failedEntries = entries.filter((e) => e.status === 'failed');

    const content = `# Experience: ${state.title || 'Unknown Page'}

**URL:** ${state.url}
**State Hash:** ${state.getStateHash()}

## Successful Solutions
${
  successfulEntries.length > 0
    ? successfulEntries
        .map(
          (entry) => `### Attempt ${entry.attempt} (${entry.timestamp})

\`\`\`javascript
${entry.code}
\`\`\`
`
        )
        .join('\n')
    : '- None yet'
}

## Failed Attempts
${
  failedEntries.length > 0
    ? failedEntries
        .map(
          (entry) => `### Attempt ${entry.attempt} (${entry.timestamp})

\`\`\`javascript
${entry.code}
\`\`\`

**Error:** ${entry.error || 'Unknown error'}
`
        )
        .join('\n')
    : '- None'
}
`;

    return content;
  }

  async getExperienceByUrl(currentUrl: string): Promise<string | null> {
    if (!existsSync(this.experienceDir)) {
      return null;
    }

    try {
      const files = readdirSync(this.experienceDir).filter((file) =>
        file.endsWith('.md')
      );

      for (const file of files) {
        const filePath = join(this.experienceDir, file);
        const fileContent = readFileSync(filePath, 'utf8');
        const parsed = matter(fileContent);

        // Check if the URL matches (same origin and path)
        if (parsed.data.url && this.urlsMatch(currentUrl, parsed.data.url)) {
          return parsed.content;
        }
      }

      return null;
    } catch (error) {
      debugLog('Error reading experience files:', error);
      return null;
    }
  }

  private urlsMatch(url1: string, url2: string): boolean {
    try {
      const u1 = new URL(url1);
      const u2 = new URL(url2);

      // Match same origin and path (ignore query params and hash)
      return u1.origin === u2.origin && u1.pathname === u2.pathname;
    } catch {
      // If URL parsing fails, do string comparison
      return url1 === url2;
    }
  }
}
