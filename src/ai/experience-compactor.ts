import { readFileSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import { json } from 'zod';
import { createDebug, log } from '../utils/logger.js';
import type { Provider } from './provider.js';

const debugLog = createDebug('explorbot:experience-compactor');

export class ExperienceCompactor {
  private provider: Provider;
  private MAX_LENGTH = 5000;

  constructor(provider: Provider) {
    this.provider = provider;
  }

  async compactExperience(experience: string): Promise<string> {
    if (experience.length < this.MAX_LENGTH) {
      return experience;
    }

    const prompt = this.buildCompactionPrompt(experience);
    const response = await this.provider.chat([
      { role: 'user', content: this.getSystemPrompt() },
      { role: 'user', content: prompt },
    ]);
    return response.text;
  }

  async compactExperienceFile(filePath: string): Promise<string> {
    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const parsed = matter(fileContent);

      debugLog('Experience file to compact:', filePath);

      if (parsed.content.length < this.MAX_LENGTH) {
        return parsed.content;
      }

      const text = await this.compactExperience(parsed.content);

      log('Experience file compacted:', filePath);
      debugLog('Experience file compacted:', text);

      return text;
    } catch (error) {
      debugLog('Error compacting experience file:', error);
      return '';
    }
  }

  private getSystemPrompt(): string {
    return `
You are an expert test automation engineer specializing in CodeceptJS.
Your task is to compact experience data from test automation attempts.

`;
  }

  private buildCompactionPrompt(content: string): string {
    return `
<rules>
- Focus on successful attempts and working code blocks
- Keep output under ${this.MAX_LENGTH / 5} words while preserving the most valuable information-
- Identify and document failed locators that should be avoided
- Group similar errors to reduce noise
- Preserve all successful CodeceptJS code blocks with their intentions
- Highlight which locators failed and why
- Common error patterns - group similar errors
- Structure the output with clear sections (Successful Solutions, Failed Locators, Common Errors)
- Your task is ONLY to compact the current experience data.
- Be explicit and short. Do not add any proposals or explanations on your own.
</rules>

<output>
Format your response as structured text MARKDOWN format prepared for LLM usage.
Use <success>, <locators>, <bad_example> sections to structure the output by context.
In each section provide code blocks and intention of the code block.
Keep the output under ${this.MAX_LENGTH} characters
Proposed output format:

<output_format>
<successfu_attempts>
  <attempt>
  - <purpose>
    \`\`\`js
    <code>
    \`\`\`
  </attempt>
  ...
</successful_attempts>

<locators>
  - <locator> - [accessible or not accessible locator for this Page, if accessible what it refers to]
</locators>

<failed_attempts>
  - <purpose>
    \`\`\`js
    <code>
    \`\`\`
  ...
</failed_attempts>
</output_format>
</output>

Please compact this experience data from test automation attempts:

<context>
${content}
</context>

`;
  }
}
