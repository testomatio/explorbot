import { readFileSync } from 'node:fs';
import matter from 'gray-matter';
import debug from 'debug';
import type { Provider } from './provider.js';

const debugLog = debug('explorbot:experience-compactor');

export class ExperienceCompactor {
  private provider: Provider;
  private MAX_LENGTH = 5000;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  async compactExperienceFile(filePath: string): Promise<string> {
    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const parsed = matter(fileContent);

      if (!parsed.content.trim()) {
        return '';
      }

      const prompt = this.buildCompactionPrompt(parsed.content);
      const response = await this.provider.chat([
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: prompt },
      ]);

      return response.text;
    } catch (error) {
      debugLog('Error compacting experience file:', error);
      return '';
    }
  }

  private getSystemPrompt(): string {
    return `
You are an expert test automation engineer specializing in CodeceptJS.
Your task is to compact experience data from test automation attempts.

Focus on:
1. Successful solutions - keep all working code blocks
2. Failed locators - identify and document problematic locators
3. Common error patterns - group similar errors
4. Keep output under 5000 characters while preserving the most valuable information

Format your response as structured markdown with clear sections.
`;
  }

  private buildCompactionPrompt(content: string): string {
    return `
Please compact this experience data from test automation attempts:

${content}

Requirements:
- Focus on successful attempts and working code blocks
- Identify and document failed locators that should be avoided
- Group similar errors to reduce noise
- Keep the output under ${this.MAX_LENGTH} characters
- Preserve all successful CodeceptJS code blocks
- Highlight which locators failed and why
- Structure the output with clear sections (Successful Solutions, Failed Locators, Common Errors)

Make the content concise but informative for future automation attempts.
`;
  }
}
