import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import dedent from 'dedent';
import { z } from 'zod';
import type { ExperienceTracker } from '../experience-tracker.js';
import { createDebug, log } from '../utils/logger.js';
import type { Agent } from './agent.js';
import type { Provider } from './provider.js';

const debugLog = createDebug('explorbot:experience-compactor');

interface ExperienceFile {
  filePath: string;
  data: { url?: string; title?: string; [key: string]: any };
  content: string;
}

interface MergeGroup {
  pattern: string;
  files: ExperienceFile[];
}

export class ExperienceCompactor implements Agent {
  emoji = '🗜️';
  private provider: Provider;
  private experienceTracker: ExperienceTracker;
  private MAX_LENGTH = 5000;

  constructor(provider: Provider, experienceTracker: ExperienceTracker) {
    this.provider = provider;
    this.experienceTracker = experienceTracker;
  }

  async compactExperience(experience: string): Promise<string> {
    if (experience.length < this.MAX_LENGTH) {
      return experience;
    }

    const prompt = this.buildCompactionPrompt(experience);
    const model = this.provider.getModelForAgent('experience-compactor');
    const response = await this.provider.chat(
      [
        { role: 'user', content: this.getSystemPrompt() },
        { role: 'user', content: prompt },
      ],
      model,
      { telemetryFunctionId: 'experience.compact' }
    );
    return response.text;
  }

  async compactAllExperiences(): Promise<number> {
    await this.mergeSimilarExperiences();

    const experienceFiles = this.experienceTracker.getAllExperience();
    let compactedCount = 0;

    for (const experience of experienceFiles) {
      const prevContent = experience.content;
      const frontmatter = experience.data;
      const compactedContent = await this.compactExperienceFile(experience.filePath);

      if (prevContent !== compactedContent) {
        const stateHash = experience.filePath.split('/').pop()?.replace('.md', '') || '';
        this.experienceTracker.writeExperienceFile(stateHash, compactedContent, frontmatter);
        debugLog('Experience file compacted:', experience.filePath);
        compactedCount++;
      }
    }

    return compactedCount;
  }

  async mergeSimilarExperiences(): Promise<number> {
    const experienceFiles = this.experienceTracker.getAllExperience();
    if (experienceFiles.length < 2) {
      return 0;
    }

    const mergeGroups = await this.identifyMergeGroups(experienceFiles);
    let mergedCount = 0;

    for (const group of mergeGroups) {
      if (group.files.length < 2) {
        continue;
      }

      await this.mergeExperienceGroup(group);
      mergedCount += group.files.length - 1;
    }

    return mergedCount;
  }

  private async identifyMergeGroups(files: ExperienceFile[]): Promise<MergeGroup[]> {
    const filesWithUrl = files.filter((f) => f.data.url && !f.data.url.startsWith('~'));
    if (filesWithUrl.length < 2) {
      return [];
    }

    const urlList = filesWithUrl.map((f) => f.data.url as string);
    const mergeDecisions = await this.askAiForMergeDecisions(urlList);

    const groups: MergeGroup[] = [];
    const usedFiles = new Set<string>();

    for (const decision of mergeDecisions) {
      const matchingFiles = filesWithUrl.filter((f) => decision.urls.includes(f.data.url as string) && !usedFiles.has(f.filePath));

      if (matchingFiles.length >= 2) {
        groups.push({
          pattern: decision.pattern,
          files: matchingFiles,
        });
        for (const f of matchingFiles) {
          usedFiles.add(f.filePath);
        }
      }
    }

    return groups;
  }

  private async askAiForMergeDecisions(urls: string[]): Promise<{ urls: string[]; pattern: string }[]> {
    const prompt = this.buildMergePrompt(urls);
    const model = this.provider.getModelForAgent('experience-compactor');

    const schema = z.object({
      mergeGroups: z.array(
        z.object({
          urls: z.array(z.string()).describe('URLs that should be merged together'),
          pattern: z.string().describe('Regex pattern that matches all URLs in the group, wrapped in ~ delimiters'),
        })
      ),
    });

    try {
      const response = await this.provider.generateObject([{ role: 'user', content: prompt }], schema, model);
      debugLog('AI merge decisions:', response.object);
      return response.object.mergeGroups || [];
    } catch (error) {
      debugLog('Error getting merge decisions from AI:', error);
      return [];
    }
  }

  private buildMergePrompt(urls: string[]): string {
    return dedent`
      Analyze these experience file URLs and identify groups that represent the same page type with dynamic URL parameters.

      <urls>
      ${urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}
      </urls>

      <rules>
      - Identify URLs that represent the same page structure but with different dynamic values (IDs, slugs, etc.)
      - Example: /item/101, /item/102, /item/105 should be grouped with pattern ~/item/\\d+~
      - Example: /user/john, /user/jane should be grouped with pattern ~/user/[^/]+~
      - Only group URLs that are clearly the same page type with dynamic segments
      - Do NOT group unrelated pages
      - Return regex patterns wrapped in ~ delimiters (e.g., ~/path/\\d+~)
      - If no URLs should be merged, return empty mergeGroups array
      </rules>

      Return JSON with mergeGroups array. Each group should have:
      - urls: array of URLs that should be merged
      - pattern: regex pattern (wrapped in ~) that matches all URLs in the group
    `;
  }

  private async mergeExperienceGroup(group: MergeGroup): Promise<void> {
    const [targetFile, ...sourceFiles] = group.files;
    const combinedContent = group.files.map((f) => f.content).join('\n\n---\n\n');

    const targetStateHash = targetFile.filePath.split('/').pop()?.replace('.md', '') || '';
    const newFrontmatter = {
      ...targetFile.data,
      url: group.pattern,
      mergedFrom: group.files.map((f) => f.data.url),
    };

    this.experienceTracker.writeExperienceFile(targetStateHash, combinedContent, newFrontmatter);
    log(`Merged ${group.files.length} experience files into ${targetFile.filePath}`);
    debugLog('New URL pattern:', group.pattern);

    for (const sourceFile of sourceFiles) {
      try {
        unlinkSync(sourceFile.filePath);
        debugLog('Deleted merged source file:', sourceFile.filePath);
      } catch (error) {
        debugLog('Error deleting source file:', error);
      }
    }
  }

  async compactExperienceFile(filePath: string): Promise<string> {
    try {
      const fileContent = readFileSync(filePath, 'utf8');
      const parsed = matter(fileContent);

      if (parsed.content.length < this.MAX_LENGTH) {
        return parsed.content;
      }
      debugLog('Experience file to compact:', filePath);

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
    return dedent`
      You are an expert test automation engineer specializing in CodeceptJS.
      Your task is to compact experience data from test automation attempts into clean markdown format.
    `;
  }

  private buildCompactionPrompt(content: string): string {
    return dedent`
      <rules>
      - Use markdown headers only (##, ###) - NO XML tags or wrappers in output
      - Merge successful sessions if they overlap or are similar
      - Keep maximum 5 unsuccessful sessions/attempts (most recent or most informative)
      - Remove all I.amOnPage, I.grab, and I.see calls from compacted experiences
      - Keep output under ${this.MAX_LENGTH} characters
      - Be explicit and short - no proposals or explanations
      </rules>

      <output_format>
      Use this markdown structure:

      ## Successful Sessions

      For each successful session or merged group:
      - Purpose: what was accomplished
      \`\`\`js
      // working code
      \`\`\`

      ## Unsuccessful Attempts

      Keep only the 5 most recent or informative failed attempts:

      - Purpose: what was attempted
      \`\`\`js
      // failed code
      \`\`\`
      Reason: why it failed
      </output_format>

      <context>
      ${content}
      </context>

      Compact this experience data following the format above.
    `;
  }
}
