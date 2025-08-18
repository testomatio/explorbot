import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { log } from './logger.js';

interface PromptData {
  url: string;
  content: string;
  filePath: string;
}

export class PromptParser {
  private prompts: Map<string, PromptData> = new Map();

  async loadPromptsFromDirectory(
    directoryPath: string
  ): Promise<Map<string, PromptData>> {
    if (!fs.existsSync(directoryPath)) {
      log(`⚠️ Prompts directory not found: ${directoryPath}`);
      return this.prompts;
    }

    const files = fs.readdirSync(directoryPath);
    const mdFiles = files.filter((file) => file.endsWith('.md'));

    for (const file of mdFiles) {
      const filePath = path.join(directoryPath, file);
      await this.parsePromptFile(filePath);
    }

    log(`✅ Loaded ${this.prompts.size} prompts from ${directoryPath}`);
    return this.prompts;
  }

  private async parsePromptFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data: frontmatter, content: markdown } = matter(content);

      if (!frontmatter.url) {
        log(`⚠️ Prompt file ${filePath} missing 'url' in frontmatter`);
        return;
      }

      this.prompts.set(frontmatter.url, {
        url: frontmatter.url,
        content: markdown.trim(),
        filePath,
      });
    } catch (error) {
      log(`❌ Failed to parse prompt file ${filePath}:`, error);
    }
  }

  getPromptByUrl(url: string): PromptData | undefined {
    return this.prompts.get(url);
  }

  getAllPrompts(): Map<string, PromptData> {
    return this.prompts;
  }

  getPromptUrls(): string[] {
    return Array.from(this.prompts.keys());
  }
}
