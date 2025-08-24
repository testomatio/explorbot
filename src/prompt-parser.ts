import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { createDebug } from './utils/logger.js';

const debugLog = createDebug('explorbot:prompt-parser');

interface PromptData {
  content: string;
  filePath: string;
  [key: string]: any;
}

interface PromptCriteria {
  url?: string | null | undefined;
  [key: string]: any;
}

export class PromptParser {
  private prompts: PromptData[] = [];

  async loadPromptsFromDirectory(directoryPath: string): Promise<PromptData[]> {
    if (!fs.existsSync(directoryPath)) {
      return this.prompts;
    }

    const files = fs.readdirSync(directoryPath);
    const mdFiles = files.filter((file) => /\.md$/i.test(file));

    for (const file of mdFiles) {
      const filePath = path.join(directoryPath, file);
      await this.parsePromptFile(filePath);
    }

    debugLog('Prompts loaded:', this.prompts.length);

    return this.prompts;
  }

  private async parsePromptFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data: frontmatter, content: markdown } = matter(content);

      const promptData: PromptData = {
        content: markdown.trim(),
        filePath,
      };

      for (const [key, value] of Object.entries(frontmatter)) {
        if (value !== undefined && value !== null) {
          promptData[key] = value;
        }
      }

      this.prompts.push(promptData);
    } catch {}
  }

  private globToRegex(pattern: string): RegExp {
    let regex = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    regex = regex.replace(/\*/g, '.*');
    return new RegExp(`^${regex}$`, 'i');
  }

  private normalizeUrl(url: string): string {
    return url.replace(/[?#].*$/, '');
  }

  private matchesPattern(value: string, pattern: string): boolean {
    if (pattern.includes('*')) {
      const regex = this.globToRegex(pattern);
      return regex.test(value);
    }
    return value === pattern;
  }

  getPromptsByCriteria(criteria: PromptCriteria): PromptData[] {
    const results: PromptData[] = [];

    for (const prompt of this.prompts) {
      let matches = true;

      for (const [criteriaKey, criteriaValue] of Object.entries(criteria)) {
        if (!criteriaValue) continue;

        const promptPattern = prompt[criteriaKey];
        if (!promptPattern) {
          matches = false;
          break;
        }

        const normalizedCriteriaValue =
          criteriaKey === 'url'
            ? this.normalizeUrl(criteriaValue)
            : criteriaValue;

        if (!this.matchesPattern(normalizedCriteriaValue, promptPattern)) {
          matches = false;
          break;
        }
      }

      if (matches) {
        results.push(prompt);
      }
    }

    return results;
  }

  getPromptsByUrl(url: string): PromptData[] {
    return this.getPromptsByCriteria({ url });
  }

  getAllPrompts(): PromptData[] {
    return [...this.prompts];
  }

  getPromptUrls(): string[] {
    return this.prompts
      .map((prompt) => prompt.url)
      .filter((url) => url !== undefined) as string[];
  }

  getPromptTitles(): string[] {
    return this.prompts
      .map((prompt) => prompt.title)
      .filter((title) => title !== undefined) as string[];
  }
}
