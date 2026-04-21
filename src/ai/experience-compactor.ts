import { unlinkSync } from 'node:fs';
import dedent from 'dedent';
import { type Tokens, marked } from 'marked';
import { z } from 'zod';
import { type ExperienceFile, type ExperienceTracker, RECENT_WINDOW_DAYS } from '../experience-tracker.js';
import { Observability } from '../observability.js';
import { createDebug, log, tag } from '../utils/logger.js';
import { mdq } from '../utils/markdown-query.js';
import { generalizeUrl, hasDynamicUrlSegment } from '../utils/url-matcher.js';
import type { Agent } from './agent.js';
import type { Provider } from './provider.js';

const debugLog = createDebug('explorbot:experience-compactor');

export type { ExperienceFile };

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
    const stripped = this.stripNonUsefulEntries(experience);
    if (stripped.length < this.MAX_LENGTH) {
      return stripped;
    }

    const prompt = this.buildCompactionPrompt(stripped);
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

  stripNonUsefulEntries(content: string): string {
    let result = dropNonReusableSections(content);
    result = dropEmptySections(result);
    return result;
  }

  isRecent(file: ExperienceFile): boolean {
    const ageDays = (Date.now() - file.mtime.getTime()) / (1000 * 60 * 60 * 24);
    return ageDays <= RECENT_WINDOW_DAYS;
  }

  async reviewExperienceQuality(content: string, context: { url?: string; title?: string }): Promise<string> {
    const sections = listSections(content);
    if (sections.length === 0) return content;

    const prompt = this.buildReviewPrompt(sections, context);
    const schema = z.object({
      sections: z.array(
        z.object({
          index: z.number().int(),
          keep: z.boolean(),
          reason: z.string(),
        })
      ),
    });

    try {
      const model = this.provider.getModelForAgent('experience-compactor');
      const response = await this.provider.generateObject(
        [
          { role: 'user', content: this.getSystemPrompt() },
          { role: 'user', content: prompt },
        ],
        schema,
        model,
        { telemetryFunctionId: 'experience.reviewQuality' }
      );

      const decisions = response?.object?.sections || [];
      let result = content;
      for (const decision of decisions) {
        if (decision.keep) continue;
        const target = sections[decision.index];
        if (!target) continue;
        debugLog('Dropping section: %s (reason: %s)', target.title, decision.reason);
        result = result.replace(target.raw, '');
      }
      return result;
    } catch (error) {
      debugLog('AI quality review failed, keeping content unchanged: %s', error);
      return content;
    }
  }

  async compactAllExperiences(): Promise<{ merged: number; compacted: number }> {
    return Observability.run('experience-compactor.compactAll', { tags: ['experience-compactor'] }, async () => {
      const aiMerged = await this.mergeSimilarExperiences();
      const generalized = this.generalizeDynamicUrls();
      const compacted = await this.compactFiles(this.experienceTracker.getAllExperience());
      return { merged: aiMerged + generalized, compacted };
    });
  }

  async autocompact(): Promise<{ merged: number; compacted: number }> {
    return Observability.run('experience-compactor.autocompact', { tags: ['experience-compactor'] }, async () => {
      const aiMerged = await this.mergeSimilarExperiences({ onlyDynamic: true });
      const generalized = this.generalizeDynamicUrls();
      const compacted = await this.compactFiles(this.experienceTracker.getAllExperience(), { skipSmall: true });
      return { merged: aiMerged + generalized, compacted };
    });
  }

  generalizeDynamicUrls(): number {
    const files = this.experienceTracker.getAllExperience();
    let count = 0;
    for (const file of files) {
      const url = file.data.url as string | undefined;
      if (!url || url.startsWith('~')) continue;
      const generalized = generalizeUrl(url);
      if (generalized === url) continue;
      const stateHash = file.filePath.split('/').pop()?.replace('.md', '') || '';
      const newData = { ...file.data, url: `~${generalized}~`, mergedFrom: [url] };
      this.experienceTracker.writeExperienceFile(stateHash, file.content, newData);
      tag('substep').log(`Generalized URL: ${url} → ~${generalized}~`);
      count++;
    }
    return count;
  }

  async compactFiles(files: ExperienceFile[], options?: { skipSmall?: boolean }): Promise<number> {
    const workingSet = options?.skipSmall ? files.filter((f) => f.content.length >= this.MAX_LENGTH) : files;

    let compactedCount = 0;
    const total = workingSet.length;
    const aiReviewCount = workingSet.filter((f) => this.isRecent(f)).length;

    if (total > 1) {
      tag('info').log(`Processing ${total} experience file${total === 1 ? '' : 's'} (${aiReviewCount} will get AI review — ~${aiReviewCount * 3}s minimum)…`);
    }

    for (let i = 0; i < workingSet.length; i++) {
      const experience = workingSet[i];
      const shortName = experience.filePath.split('/').pop() || experience.filePath;
      const willReview = this.isRecent(experience);

      if (total > 1 && willReview) {
        tag('substep').log(`[${i + 1}/${total}] reviewing ${shortName}`);
      }

      let content = this.stripNonUsefulEntries(experience.content);

      if (willReview) {
        content = await this.reviewExperienceQuality(content, experience.data);
      }

      if (content.length >= this.MAX_LENGTH) {
        if (total > 1) tag('substep').log(`[${i + 1}/${total}] compacting ${shortName} (over ${this.MAX_LENGTH} chars)`);
        const prompt = this.buildCompactionPrompt(content);
        const model = this.provider.getModelForAgent('experience-compactor');
        const response = await this.provider.chat(
          [
            { role: 'user', content: this.getSystemPrompt() },
            { role: 'user', content: prompt },
          ],
          model,
          { telemetryFunctionId: 'experience.compact' }
        );
        content = response.text;
      }

      if (content === experience.content) continue;

      const stateHash = experience.filePath.split('/').pop()?.replace('.md', '') || '';
      this.experienceTracker.writeExperienceFile(stateHash, content, experience.data);
      debugLog('Experience file compacted:', experience.filePath);
      compactedCount++;
    }

    return compactedCount;
  }

  async mergeSimilarExperiences(options?: { onlyDynamic?: boolean }): Promise<number> {
    return Observability.run('experience-compactor.merge', { tags: ['experience-compactor'] }, async () => {
      const experienceFiles = this.experienceTracker.getAllExperience();
      if (experienceFiles.length < 2) {
        return 0;
      }

      let candidates = experienceFiles.filter((f) => f.data.url && !f.data.url.startsWith('~'));
      if (options?.onlyDynamic) {
        candidates = candidates.filter((f) => hasDynamicUrlSegment(f.data.url as string));
      }

      if (candidates.length < 2) {
        debugLog('No mergeable URL patterns — skipping merge.');
        return 0;
      }

      tag('info').log(`Experience compaction: checking ${candidates.length} file${candidates.length === 1 ? '' : 's'} for mergeable URL patterns…`);

      const mergeGroups = await this.identifyMergeGroups(candidates);

      if (mergeGroups.length === 0) {
        tag('info').log('No URL groups to merge.');
        return 0;
      }

      tag('info').log(`Merging ${mergeGroups.length} URL group${mergeGroups.length === 1 ? '' : 's'}…`);
      let mergedCount = 0;

      for (const group of mergeGroups) {
        if (group.files.length < 2) {
          continue;
        }

        await this.mergeExperienceGroup(group);
        mergedCount += group.files.length - 1;
      }

      return mergedCount;
    });
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
      const response = await this.provider.generateObject([{ role: 'user', content: prompt }], schema, model, {
        telemetryFunctionId: 'experience.mergeDecisions',
      });
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

  private getSystemPrompt(): string {
    const customPrompt = this.provider.getSystemPromptForAgent('experience-compactor', '*');
    return dedent`
      You are an expert test automation engineer specializing in CodeceptJS.
      Your task is to compact experience data from test automation attempts into clean markdown format.

      ${customPrompt || ''}
    `;
  }

  private buildCompactionPrompt(content: string): string {
    return dedent`
      <rules>
      - Use markdown h2 headers only (##) - NO XML tags or wrappers in output
      - Merge similar flows to remove duplicates
      - Keep output under ${this.MAX_LENGTH} characters
      - Be explicit and short - no proposals or explanations

      KEEP only:
      - Positive flows that complete a business action (create, edit, delete, navigate)
      - Reusable interaction patterns (opening dropdowns, filling forms, using pickers)
      - Discovery lines (> prefixed) that document UI elements appearing at each step — keep at most 5 per flow step
      - Working CodeceptJS code for common interactions

      REMOVE:
      - All FAILED entries
      - Edge-case and negative flows (empty values, disabled buttons, validation errors, boundary testing)
      - Flows whose purpose is to test what happens when something goes wrong
      - All I.amOnPage, I.grab, I.see, I.seeElement, I.dontSee calls
      - Duplicate approaches that achieve the same goal
      </rules>

      <output_format>
      Use this markdown structure. Titles must be imperative verb phrases, lowercase-first (e.g. "create a new user"):

      ## FLOW: <multi-step imperative title>

      * <step message>
      \`\`\`js
      // working code
      \`\`\`
      ---

      ## ACTION: <single-step imperative title>

      \`\`\`js
      // working code
      \`\`\`
      </output_format>

      <context>
      ${content}
      </context>

      Compact this experience data following the format above. Every section must be either a multi-step FLOW or a single-step ACTION.
    `;
  }

  private buildReviewPrompt(sections: Array<{ title: string; raw: string }>, context: { url?: string; title?: string }): string {
    const url = context.url || 'unknown';
    const title = context.title || 'unknown';
    const sectionsList = sections
      .map((s, i) => {
        return `Section ${i}: ${s.title}\n${s.raw.trim()}`;
      })
      .join('\n\n---\n\n');

    return dedent`
      Review each experience section stored for the page below. For each, decide whether to keep it for future test automation use.

      <page>
      url: ${url}
      title: ${title}
      </page>

      <mental_model>
      Every section answers the question "HOW to <title>?". If the title does not complete that question naturally, the section has no value. A FLOW teaches a multi-step procedure; an ACTION teaches a single atomic step. Verifications and one-off recoveries are out of scope.
      </mental_model>

      <drop_if>
      - Title does not read as a reusable instruction — it describes a transient recovery, retry, or navigation step. Any title starting with "attempt", "try", "retry", "need to", "ensure", "go back", "return (to)", or ending with "(RESET)" is not a teaching.
      - Title is a verification / assertion rather than an action. Any "verify", "verification", "see that", "check that", "expect", "assert", or "and verify" phrasing means the teaching is about asserting state, not doing something — drop.
      - ACTION describes more than one atomic step. Multiple verb phrases, "and", "then", or comma-joined actions mean it is actually a FLOW, not an ACTION — drop so the flow gets re-captured correctly.
      - Locator is dynamic / brittle: ember IDs, random UUIDs, numeric data-testid, positional XPaths like div[3].
      - Too generic to reuse: "click button", "fill input" with no specific target.
      - Duplicates another section on this same page.
      - Body has no executable CodeceptJS code block.
      </drop_if>

      <keep_if>
      Everything else. Prefer keeping sections — only drop when clearly low value.
      </keep_if>

      <sections>
      ${sectionsList}
      </sections>

      Return a decision per section: { index, keep (boolean), reason (short) }.
    `;
  }
}

function listSections(content: string): { title: string; raw: string }[] {
  const tokens = marked.lexer(content);
  const sections: { title: string; raw: string }[] = [];

  let currentHeading: string | null = null;
  let currentRaw = '';

  const flush = () => {
    if (currentHeading !== null) sections.push({ title: currentHeading, raw: currentRaw });
  };

  for (const token of tokens) {
    const raw = (token as any).raw || '';
    if (token.type === 'heading' && (token as Tokens.Heading).depth === 2) {
      flush();
      currentHeading = (token as Tokens.Heading).text.trim();
      currentRaw = raw;
      continue;
    }
    if (currentHeading !== null) currentRaw += raw;
  }
  flush();
  return sections;
}

function dropEmptySections(content: string): string {
  let result = content;
  const sections = [...mdq(result).query('section2(~"FLOW:")').each(), ...mdq(result).query('section2(~"ACTION:")').each()];

  for (const section of sections) {
    const raw = section.text();
    const hasCode = mdq(raw).query('code').count() > 0;
    const hasList = mdq(raw).query('list').count() > 0;
    if (hasCode || hasList) continue;
    result = result.replace(raw, '');
  }

  return result;
}

function dropNonReusableSections(content: string): string {
  let result = content;
  const sections = [...mdq(result).query('section2(~"FLOW:")').each(), ...mdq(result).query('section2(~"ACTION:")').each()];

  for (const section of sections) {
    const raw = section.text();
    if (!/\bI\.clickXY\s*\(/.test(raw)) continue;
    result = result.replace(raw, '');
  }

  return result;
}
