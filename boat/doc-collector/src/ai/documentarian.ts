import dedent from 'dedent';
import { z } from 'zod';
import type { AIProvider } from '../../../../src/ai/provider.ts';
import type Explorer from '../../../../src/explorer.ts';
import type { WebPageState } from '../../../../src/state-manager.ts';
import { tag } from '../../../../src/utils/logger.ts';
import type { DocbotConfig } from '../config.ts';
import { collectDocInteractions } from './tools.ts';

class Documentarian {
  private provider: AIProvider;
  private config: DocbotConfig;
  private explorer?: Explorer;

  constructor(provider: AIProvider, config: DocbotConfig = {}, explorer?: Explorer) {
    this.provider = provider;
    this.config = config;
    this.explorer = explorer;
  }

  async document(state: WebPageState, research: string): Promise<PageDocumentation> {
    const interactiveEnabled = this.config.docs?.interactive === true && this.explorer;
    if (!interactiveEnabled) {
      tag('info').log('Documentarian: Using static mode (interactive disabled or no explorer)');
      return this.documentStatic(state, research);
    }

    tag('info').log('Documentarian: Using interactive mode with tools');
    return this.documentWithInteraction(state, research);
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

  private async documentWithInteraction(state: WebPageState, research: string): Promise<PageDocumentation> {
    try {
      tag('info').log('Starting interactive exploration...');

      const deterministicInteractions = await collectDocInteractions(this.explorer!, state, research);
      const meaningfulInteractions = this.getMeaningfulInteractions(deterministicInteractions);
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
      tag('warning').log(`Interactive documentation failed: ${message}. Falling back to static.`);
      return this.documentStatic(state, research);
    }
  }

  private getMeaningfulInteractions(interactions: StateTransition[]): StateTransition[] {
    return interactions.filter((interaction) => {
      const action = interaction.action || '';
      if (action.startsWith('Opened detail page:')) {
        return true;
      }
      if (action.startsWith('Opened pagination page:')) {
        return true;
      }
      if (action.startsWith('Switched to tab:')) {
        return true;
      }
      if (action.startsWith('Activated button:')) {
        return true;
      }
      if (action.startsWith('Opened category page:')) {
        return false;
      }
      if (action.startsWith('I.click(')) {
        return false;
      }

      return Boolean(interaction.targetUrl);
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

    const response = await this.provider.generateObject(messages, pageDocumentationSchema, undefined, {
      agentName: 'documentarian',
    });

    return this.normalizeDocumentation(
      {
        ...(response.object as PageDocumentation),
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

    const response = await this.provider.generateObject(messages, pageDocumentationSchema, undefined, {
      agentName: 'documentarian',
    });

    return this.normalizeDocumentation(response.object as PageDocumentation, state, research);
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
      </output_requirements>
    `;
  }

  private buildInteractionContext(interactions: StateTransition[]): string {
    const lines = interactions.map((interaction) => `- ${interaction.action}: ${interaction.before} -> ${interaction.after}`).join('\n');
    return `\n\n<interactions_found>\nThe following interactions were performed:\n${lines}\n</interactions_found>`;
  }

  private shouldRetryWithSanitizedResearch(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('Failed to generate JSON') || message.includes('Failed to validate JSON') || message.includes('failed_generation') || message.includes('No object generated') || message.includes('response did not match schema');
  }

  private normalizeDocumentation(documentation: PageDocumentation, state: WebPageState, research: string): PageDocumentation {
    const can = this.compactShellActions(documentation.can, research);
    const might = this.filterWeakMightActions(documentation.might, research, state);
    const qualityNotes = this.evaluateDocumentationQuality(
      {
        ...documentation,
        can,
        might,
      },
      state,
      research
    );

    return {
      ...documentation,
      can,
      might,
      qualityNotes,
    };
  }

  private compactShellActions(can: Capability[], research: string): Capability[] {
    const shellActions = can.filter((item) => this.isShellNavigationAction(item));
    if (shellActions.length < 3) {
      return can;
    }

    const compacted: Capability[] = [];
    const preserved = can.filter((item) => {
      if (this.isShellNavigationAction(item)) {
        return false;
      }
      if (this.isSearchAction(item.action)) {
        return false;
      }
      if (this.isPaginationAction(item.action)) {
        return false;
      }
      return true;
    });
    const hasSearch = can.some((item) => this.isSearchAction(item.action));
    const hasPagination = can.some((item) => this.isPaginationAction(item.action));
    const hasAccount = can.some((item) => this.isAccountAction(item.action));
    const hasSectionNavigation = can.some((item) => this.isSectionNavigationAction(item.action));
    const hasExternalNavigation = can.some((item) => this.isExternalLinkAction(item.action));
    const hasUtilityNavigation = can.some((item) => this.isUtilityAction(item.action));

    if (hasSectionNavigation) {
      compacted.push({
        action: 'user can navigate to major site sections using the visible navigation links',
        scope: 'page-level',
        evidence: this.hasMenuSection(research) ? 'Multiple section links are visible in the page header/menu.' : 'Multiple section links are visible on the page.',
      });
    }

    if (hasAccount) {
      compacted.push({
        action: 'user can access account-related pages from the visible header links',
        scope: 'page-level',
        evidence: 'Account-related links such as login or personal lists are visible in the page navigation.',
      });
    }

    if (hasSearch) {
      const searchAction = can.find((item) => this.isSearchAction(item.action));
      if (searchAction) {
        compacted.push(searchAction);
      }
    }

    if (hasPagination) {
      const paginationAction = can.find((item) => this.isPaginationAction(item.action));
      if (paginationAction) {
        compacted.push(paginationAction);
      }
    }

    if (hasExternalNavigation) {
      compacted.push({
        action: 'user can open external links shown on the page',
        scope: 'page-level',
        evidence: 'External destination links are visible in the page content or footer.',
      });
    }

    if (hasUtilityNavigation) {
      compacted.push({
        action: 'user can open utility or support pages linked from the site navigation',
        scope: 'page-level',
        evidence: 'Utility links such as feedback, help, or related support pages are visible in navigation.',
      });
    }

    return [...compacted, ...preserved];
  }

  private filterWeakMightActions(might: Capability[], research: string, state: WebPageState): Capability[] {
    return might.filter((item) => {
      const action = item.action.toLowerCase();
      const evidence = item.evidence.toLowerCase();

      if (/(add .*personal list|add .*favorites|add-to-list)/i.test(action) && !/(favorite|wishlist|bookmark|save|add)/i.test(research)) {
        return false;
      }

      if (/(typical|suggests functionality|suggests a personalized list page)/i.test(evidence)) {
        if (!this.hasPrimaryContentEvidence(research) && !this.looksLikeItemAction(action, state.url)) {
          return false;
        }
      }

      return true;
    });
  }

  private evaluateDocumentationQuality(documentation: PageDocumentation, state: WebPageState, research: string): string[] {
    const notes: string[] = [];
    const allPageLevel = documentation.can.length > 0 && documentation.can.every((item) => item.scope === 'page-level');
    const hasItemLevel = [...documentation.can, ...documentation.might].some((item) => item.scope === 'one item' || item.scope === 'list of items');
    const contentEvidence = this.hasPrimaryContentEvidence(research);

    if (allPageLevel && !hasItemLevel && /(films|movies|catalog|list|series|cartoons)/i.test(state.url)) {
      notes.push('Coverage is currently limited to page-level navigation and search actions; item-level content interactions were not confirmed.');
    }
    if (!contentEvidence) {
      notes.push('Research did not provide a dedicated content section, so content-specific behavior may be under-documented.');
    }
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

  private isShellNavigationAction(item: Capability): boolean {
    if (item.scope !== 'page-level') {
      return false;
    }

    const action = item.action.toLowerCase();
    return this.isSectionNavigationAction(action) || this.isAccountAction(action) || this.isExternalLinkAction(action) || this.isUtilityAction(action);
  }

  private isSectionNavigationAction(action: string): boolean {
    if (this.isPaginationAction(action) || this.isSearchAction(action) || this.isExternalLinkAction(action)) {
      return false;
    }

    return /(navigate to .*page|navigate to .*category|navigate to .*section|click the .* link to navigate)/i.test(action);
  }

  private isAccountAction(action: string): boolean {
    return /(login|log in|personal lists|my lists|account)/i.test(action);
  }

  private isSearchAction(action: string): boolean {
    return /search|search textbox|search button/.test(action.toLowerCase());
  }

  private isPaginationAction(action: string): boolean {
    return /pagination|navigate between pages|page \d+/.test(action.toLowerCase());
  }

  private isExternalLinkAction(action: string): boolean {
    return /external /.test(action.toLowerCase());
  }

  private isUtilityAction(action: string): boolean {
    return /(feedback|support|help|contact|abuse|report)/i.test(action);
  }

  private hasMenuSection(research: string): boolean {
    return /##\s+(menu|navigation|header)/i.test(research);
  }

  private hasPrimaryContentEvidence(research: string): boolean {
    return /##\s+(content|cards|results|grid|catalog)/i.test(research);
  }

  private looksLikeItemAction(action: string, url: string): boolean {
    return /(detail page|individual .* item|film item|movie item|view details)/i.test(action) || /(films|movies|catalog|list)/i.test(url);
  }
}

const capabilitySchema = z.object({
  action: z.string(),
  scope: z.enum(['one item', 'list of items', 'bulk operations', 'all items', 'page-level']),
  evidence: z.string(),
});

const stateTransitionSchema = z.object({
  action: z.string(),
  before: z.string(),
  after: z.string(),
  targetUrl: z.string().optional(),
  discoveredUrls: z.array(z.string()).optional(),
  newCapabilities: z.array(z.string()).optional(),
});

const pageDocumentationSchema = z.object({
  summary: z.string(),
  can: z.array(capabilitySchema),
  might: z.array(capabilitySchema),
  interactions: z.array(stateTransitionSchema).optional(),
});

type Capability = z.infer<typeof capabilitySchema>;
type StateTransition = z.infer<typeof stateTransitionSchema>;
type PageDocumentation = z.infer<typeof pageDocumentationSchema> & {
  interactions?: StateTransition[];
  qualityNotes?: string[];
};

export { Documentarian };
export type { PageDocumentation, StateTransition };
