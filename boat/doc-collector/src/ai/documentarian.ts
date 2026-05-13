import dedent from 'dedent';
import { z } from 'zod';
import type { AIProvider } from '../../../../src/ai/provider.ts';
import type { WebPageState } from '../../../../src/state-manager.ts';
import type { DocbotConfig } from '../config.ts';

class Documentarian {
  private provider: AIProvider;
  private config: DocbotConfig;

  constructor(provider: AIProvider, config: DocbotConfig = {}) {
    this.provider = provider;
    this.config = config;
  }

  async document(state: WebPageState, research: string): Promise<PageDocumentation> {
    try {
      return await this.generateDocumentation(state, research);
    } catch (error) {
      if (!this.shouldRetryWithSanitizedResearch(error)) {
        throw error;
      }

      return this.generateDocumentation(state, this.sanitizeResearch(research), true);
    }
  }

  private getSystemPrompt(): string {
    const customPrompt = this.config.docs?.prompt;
    let promptSuffix = '';
    if (customPrompt) {
      promptSuffix = customPrompt;
    }

    return dedent`
    <role>
    You are a product analyst preparing functional website documentation from UI research.
    </role>

    <task>
    Convert exploratory UI research into a precise spec of what users can do on the current page.
    Distinguish proven capabilities from assumptions.
    Prefer accuracy over coverage.
    </task>

    <rules>
    Only list capabilities that are grounded in the provided page research.
    Put actions into "can" only when there is direct evidence in the page context.
    Put actions into "might" only when the UI strongly suggests a capability but proof is incomplete.
    Describe each action from the end-user perspective.
    Be explicit about scope:
    - one item
    - list of items
    - bulk operations
    - all items
    - page-level
    Avoid implementation details, selectors, and QA wording.
    Avoid duplicate actions with different phrasing.
    </rules>

    ${promptSuffix}
    `;
  }

  private buildPrompt(state: WebPageState, research: string, simplified = false): string {
    const headings = [state.h1, state.h2, state.h3, state.h4].filter(Boolean).join(' | ');
    const links = (state.links || [])
      .slice(0, 50)
      .map((link) => `- ${link.title}: ${link.url}`)
      .join('\n');
    const simplificationNote = simplified
      ? dedent`
        <fallback_mode>
        The research text was simplified because the original formatting was noisy.
        Ignore malformed table syntax and rely only on clear, repeated signals.
        Prefer fewer actions over speculative coverage.
        </fallback_mode>
        `
      : '';

    return dedent`
    <page>
    URL: ${state.url}
    Title: ${state.title || ''}
    Headings: ${headings}
    </page>

    <navigation_links>
    ${links}
    </navigation_links>

    <research>
    ${research}
    </research>

    ${simplificationNote}

    <output_requirements>
    Return structured data.
    summary: short page purpose statement.
    can: actions you are 100% sure are available on page.
    might: actions that look possible but are not fully proven.
    For each action provide:
    - action: concise user-facing capability phrased as "user can ..."
    - scope: one of one item, list of items, bulk operations, all items, page-level
    - evidence: short reason based on visible UI or research
    </output_requirements>
    `;
  }

  private async generateDocumentation(state: WebPageState, research: string, simplified = false): Promise<PageDocumentation> {
    const messages = [
      {
        role: 'system' as const,
        content: this.getSystemPrompt(),
      },
      {
        role: 'user' as const,
        content: this.buildPrompt(state, research, simplified),
      },
    ];

    const response = await this.provider.generateObject(messages, pageDocumentationSchema, undefined, {
      agentName: 'documentarian',
    });

    return response.object as PageDocumentation;
  }

  private shouldRetryWithSanitizedResearch(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Failed to generate JSON') || message.includes('failed_generation');
  }

  private sanitizeResearch(research: string): string {
    const lines = research.split('\n');
    const sanitized: string[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        sanitized.push(line);
        continue;
      }

      if (!line.includes('|')) {
        sanitized.push(line);
        continue;
      }

      const pipeCount = (line.match(/\|/g) || []).length;
      if (pipeCount < 2) {
        continue;
      }

      if (line.includes('|------')) {
        sanitized.push(line);
        continue;
      }

      if (line.trim().startsWith('|') && pipeCount >= 4) {
        sanitized.push(line);
      }
    }

    return sanitized.join('\n');
  }
}

const capabilitySchema = z.object({
  action: z.string(),
  scope: z.enum(['one item', 'list of items', 'bulk operations', 'all items', 'page-level']),
  evidence: z.string(),
});

const pageDocumentationSchema = z.object({
  summary: z.string(),
  can: z.array(capabilitySchema),
  might: z.array(capabilitySchema),
});

type PageDocumentation = z.infer<typeof pageDocumentationSchema>;

export { Documentarian };
export type { PageDocumentation };
