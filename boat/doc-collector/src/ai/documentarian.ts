import dedent from 'dedent';
import { z } from 'zod';
import type { AIProvider } from '../../../../src/ai/provider.ts';
import type Explorer from '../../../../src/explorer.ts';
import type { StateManager } from '../../../../src/state-manager.ts';
import type { WebPageState } from '../../../../src/state-manager.ts';
import { parseAriaLocator } from '../../../../src/utils/aria.ts';
import { tag } from '../../../../src/utils/logger.ts';
import { parseResearchSections } from '../../../../src/ai/researcher/parser.ts';
import type { DocbotConfig } from '../config.ts';
import { type CaptureInteractionState, type DocStateTransition, collectDocInteractions } from './tools.ts';

class Documentarian {
  private provider: AIProvider;
  private config: DocbotConfig;
  private explorer?: Explorer;
  private stateManager?: StateManager;

  constructor(provider: AIProvider, config: DocbotConfig = {}, explorer?: Explorer, stateManager?: StateManager) {
    this.provider = provider;
    this.config = config;
    this.explorer = explorer;
    this.stateManager = stateManager;
  }

  async document(state: WebPageState, research: string, captureState?: CaptureInteractionState): Promise<PageDocumentation> {
    const interactiveEnabled = this.config.docs?.interactive === true && this.explorer;
    if (!interactiveEnabled) {
      tag('info').log('Documentarian: Using static mode (interactive disabled or no explorer)');
      return this.documentStatic(state, research);
    }

    tag('info').log('Documentarian: Using interactive mode with tools');
    return this.documentWithInteraction(state, research, captureState);
  }

  private async documentStatic(state: WebPageState, research: string): Promise<PageDocumentation> {
    try {
      return await this.generateDocumentation(state, research);
    } catch (error) {
      if (!this.shouldRetryWithSanitizedResearch(error)) {
        throw error;
      }

      return this.generateDocumentation(state, this.sanitizeResearch(research), true);
    }
  }

  private async documentWithInteraction(state: WebPageState, research: string, captureState?: CaptureInteractionState): Promise<PageDocumentation> {
    let meaningfulInteractions: StateTransition[] = [];
    try {
      tag('info').log('Starting interactive exploration...');

      const deterministicInteractions = await collectDocInteractions(this.explorer!, this.stateManager!, state, research, this.config, captureState);
      meaningfulInteractions = this.getMeaningfulInteractions(deterministicInteractions);
      if (meaningfulInteractions.length > 0) {
        tag('success').log(`Collected ${meaningfulInteractions.length} deterministic interactions`);
        return await this.generateDocumentationWithInteractions(state, research, meaningfulInteractions);
      }

      if (deterministicInteractions.length > 0) {
        tag('info').log('Interactive exploration found only low-value navigation changes. Using static documentation.');
      } else {
        tag('info').log('Interactive exploration found no reliable deterministic interactions. Using static documentation.');
      }

      return this.documentStatic(state, research);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      tag('warning').log(`Interactive documentation failed: ${message}.`);
      if (meaningfulInteractions.length > 0) {
        tag('info').log(`Retrying static documentation while preserving ${meaningfulInteractions.length} observed interaction(s).`);
        return this.documentStatic(state, research)
          .then((documentation) =>
            this.normalizeDocumentation(
              {
                ...documentation,
                interactions: meaningfulInteractions,
              },
              state,
              research
            )
          )
          .catch((fallbackError) => {
            const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            tag('warning').log(`Static documentation fallback failed: ${fallbackMessage}. Preserving observed interactions without AI summary.`);
            return this.normalizeDocumentation(
              {
                summary: `Observed ${meaningfulInteractions.length} interaction(s); AI-generated summary was unavailable.`,
                can: [],
                might: [],
                interactions: meaningfulInteractions,
              },
              state,
              research
            );
          });
      }
      return this.documentStatic(state, research);
    }
  }

  private getMeaningfulInteractions(interactions: StateTransition[]): StateTransition[] {
    return interactions.filter((interaction) => {
      if (interaction.targetUrl) {
        return true;
      }
      if (interaction.changes?.urlChanged) {
        return true;
      }
      if ((interaction.changes?.newElements || 0) > 0) {
        return true;
      }
      if ((interaction.changes?.removedElements || 0) > 0) {
        return true;
      }
      return (interaction.discoveredUrls || []).length > 0;
    });
  }

  private async generateDocumentationWithInteractions(state: WebPageState, research: string, interactions: StateTransition[]): Promise<PageDocumentation> {
    const messages = [
      {
        role: 'system' as const,
        content: this.getSystemPrompt(),
      },
      {
        role: 'user' as const,
        content: this.buildPrompt(state, `${research}${this.buildInteractionContext(interactions)}`),
      },
    ];

    const response = await this.provider.generateObject(messages, generatedPageDocumentationSchema, undefined, {
      agentName: 'documentarian',
    });

    return this.normalizeDocumentation(
      {
        ...(response.object as GeneratedPageDocumentation),
        interactions,
      },
      state,
      research
    );
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

    const response = await this.provider.generateObject(messages, generatedPageDocumentationSchema, undefined, {
      agentName: 'documentarian',
    });

    return this.normalizeDocumentation(response.object as GeneratedPageDocumentation, state, research);
  }

  private getSystemPrompt(): string {
    let promptSuffix = '';
    if (this.config.docs?.prompt) {
      promptSuffix = this.config.docs.prompt;
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
      Going to another page is navigation, not a capability. "can" and "might" list only actions the user performs on this page; links and menus are documented in a separate navigation section, never here.
      Raw interaction observations that change the URL are navigation evidence only. Never turn them into "can" or "might" actions.
      Exclude capabilities supplied by unrelated embedded support, marketing, consent, or feedback widgets. Include an embedded interface only when it is part of the current page's documented purpose.
      Describe each action from the end-user perspective.
      Be explicit about scope:
      - one item
      - list of items
      - bulk operations
      - all items
      - page-level
      Avoid implementation details, selectors, and QA wording — except the machine-consumed element field, which is a locator, not prose.
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

    let simplificationNote = '';
    if (simplified) {
      simplificationNote = dedent`
        <fallback_mode>
        The research text was simplified because the original formatting was noisy.
        Ignore malformed table syntax and rely only on clear, repeated signals.
        Prefer fewer actions over speculative coverage.
        </fallback_mode>
      `;
    }

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
      - element: required for every "can" and "might" action. Return the proving or suggesting control's locator copied verbatim from the page research table — the value from the ARIA column, or from the CSS column when the ARIA column is empty. Return null only when no single element supports the action. It is machine metadata used for validation and never shown as prose.
      Never copy the human-readable Element description from interaction_observations into element. It is not a locator.
      </output_requirements>
    `;
  }

  private buildInteractionContext(interactions: StateTransition[]): string {
    const lines = interactions
      .map((interaction) => {
        const parts = [`Action: ${interaction.action}`, `Element: ${this.formatInteractionElement(interaction)}`, `Before: ${interaction.before}`, `After: ${interaction.after}`, `Changes: ${this.formatInteractionChanges(interaction)}`];
        if (interaction.targetUrl) {
          parts.push(`Target URL: ${interaction.targetUrl}`);
        }
        if (interaction.discoveredUrls && interaction.discoveredUrls.length > 0) {
          parts.push(`Discovered URLs: ${interaction.discoveredUrls.join(', ')}`);
        }
        return `- ${parts.join('\n  ')}`;
      })
      .join('\n');
    return dedent`

      <interaction_observations>
      These are raw observations collected after interacting with visible controls. They are not semantic conclusions.
      Classify them yourself as proven user capabilities, possible capabilities, navigation, page-state changes, or noise.
      Do not trust the action label as a capability category; use the before/after state, element metadata, and URL changes as evidence.
      ${lines}
      </interaction_observations>
    `;
  }

  private shouldRetryWithSanitizedResearch(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Failed to generate JSON') || message.includes('Failed to validate JSON') || message.includes('failed_generation') || message.includes('No object generated') || message.includes('response did not match schema');
  }

  private normalizeDocumentation(documentation: GeneratedPageDocumentation & Partial<Pick<PageDocumentation, 'interactions'>>, _state: WebPageState, research: string): PageDocumentation {
    const normalized = { ...documentation };
    const navigationLocators = new Set<string>();
    const researchLocators = new Set<string>();
    for (const section of parseResearchSections(research)) {
      for (const element of section.elements) {
        const aria = element.aria ? `{ role: '${element.aria.role}', text: '${element.aria.text}' }` : null;
        if (aria) researchLocators.add(this.locatorKey(aria));
        if (element.css) researchLocators.add(this.locatorKey(element.css));
        if (element.aria?.role !== 'link') continue;
        if (aria) navigationLocators.add(this.locatorKey(aria));
        if (element.css) navigationLocators.add(this.locatorKey(element.css));
      }
    }
    normalized.can = normalized.can.filter((capability) => {
      if (!capability.element) return true;
      const key = this.locatorKey(capability.element);
      return researchLocators.has(key) && !navigationLocators.has(key);
    });
    normalized.might = normalized.might.filter((capability) => {
      if (!capability.element) return false;
      const key = this.locatorKey(capability.element);
      return researchLocators.has(key) && !navigationLocators.has(key);
    });
    if (!normalized.interactions) {
      normalized.interactions = undefined;
    }

    const qualityNotes = this.evaluateDocumentationQuality(normalized);

    return pageDocumentationSchema.parse({
      ...normalized,
      qualityNotes,
    });
  }

  private locatorKey(locator: string): string {
    const aria = parseAriaLocator(locator);
    if (aria) return `aria:${aria.role}:${aria.text}`;
    const trimmed = locator.trim();
    const first = trimmed.at(0);
    const last = trimmed.at(-1);
    if (first === last && (first === '`' || first === '"' || first === "'")) {
      return `css:${trimmed.slice(1, -1).trim()}`;
    }
    return `css:${trimmed}`;
  }

  private evaluateDocumentationQuality(documentation: PageDocumentation): string[] {
    const notes: string[] = [];

    if ((documentation.interactions || []).length === 0 && this.config.docs?.interactive) {
      notes.push('Interactive exploration did not produce any reliable page-specific transitions for this page.');
    }

    return notes;
  }

  private sanitizeResearch(research: string): string {
    const sanitized: string[] = [];

    for (const line of research.split('\n')) {
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

  private formatInteractionElement(interaction: StateTransition): string {
    if (!interaction.element) {
      return 'unknown element';
    }

    const parts = [`role=${interaction.element.role}`, `name=${interaction.element.name}`, `section=${interaction.element.section}`];
    if (interaction.element.container) {
      parts.push(`container=${interaction.element.container}`);
    }
    if (interaction.element.locator) {
      parts.push(`locator=${interaction.element.locator}`);
    }
    return parts.join(', ');
  }

  private formatInteractionChanges(interaction: StateTransition): string {
    if (!interaction.changes) {
      return 'unknown changes';
    }

    return `urlChanged=${interaction.changes.urlChanged}, newElements=${interaction.changes.newElements}, removedElements=${interaction.changes.removedElements}`;
  }
}

const capabilitySchema = z.object({
  action: z.string(),
  scope: z.enum(['one item', 'list of items', 'bulk operations', 'all items', 'page-level']),
  evidence: z.string(),
  element: z.string().nullable().optional(),
});

const generatedCapabilitySchema = z.object({
  action: z.string(),
  scope: z.enum(['one item', 'list of items', 'bulk operations', 'all items', 'page-level']),
  evidence: z.string(),
  element: z.string().nullable(),
});

const stateTransitionSchema = z.object({
  action: z.string(),
  before: z.string(),
  after: z.string(),
  targetUrl: z.string().optional(),
  discoveredUrls: z.array(z.string()).optional(),
  newCapabilities: z.array(z.string()).optional(),
  element: z
    .object({
      role: z.string(),
      name: z.string(),
      section: z.string(),
      container: z.string().optional(),
      locator: z.string().optional(),
    })
    .optional(),
  changes: z
    .object({
      urlChanged: z.boolean(),
      newElements: z.number(),
      removedElements: z.number(),
    })
    .optional(),
  targetState: z
    .object({
      kind: z.enum(['page', 'dialog', 'modal', 'section']),
      label: z.string(),
      url: z.string(),
    })
    .optional(),
  screenshot: z
    .object({
      title: z.string(),
      relativePath: z.string(),
    })
    .optional(),
});

const generatedPageDocumentationSchema = z.object({
  summary: z.string(),
  can: z.array(generatedCapabilitySchema),
  might: z.array(generatedCapabilitySchema),
});

const pageDocumentationSchema = z.object({
  summary: z.string(),
  can: z.array(capabilitySchema),
  might: z.array(capabilitySchema),
  interactions: z.array(stateTransitionSchema).optional(),
  qualityNotes: z.array(z.string()).optional(),
});

type StateTransition = DocStateTransition;
type GeneratedPageDocumentation = z.infer<typeof generatedPageDocumentationSchema>;
type PageDocumentation = z.infer<typeof pageDocumentationSchema>;

export { Documentarian };
export type { PageDocumentation, StateTransition };
