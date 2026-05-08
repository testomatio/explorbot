import dedent from 'dedent';
import type { ActionResult } from '../../action-result.js';
import { executionController } from '../../execution-controller.ts';
import type Explorer from '../../explorer.ts';
import type { StateManager } from '../../state-manager.js';
import { tag } from '../../utils/logger.js';
import { RulesLoader } from '../../utils/rules-loader.ts';
import type { Provider } from '../provider.js';
import { locatorRule as generalLocatorRuleText } from '../rules.js';
import { markSectionAsFocused } from './focus.ts';
import type { Constructor } from './mixin.ts';
import { ResearchResult } from './research-result.ts';

export interface SectionMethods {
  researchBySections(): Promise<string>;
}

export function WithSections<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;
    declare provider: Provider;
    declare stateManager: StateManager;
    declare actionResult: ActionResult | undefined;

    async researchBySections(): Promise<string> {
      const ariaSnapshot = this.actionResult?.getCompactARIA() || '';
      const configured = (this as any).getConfiguredSections() as Record<string, string>;
      const focusCss = await this._detectFocusCss();

      let targets: Array<[string, string]>;
      if (focusCss) {
        targets = [['Focus', `element bounded by CSS container '${focusCss}'`]];
        tag('info').log(`Focus element detected via selector '${focusCss}', researching focused area only`);
      } else {
        targets = Object.entries(configured);
        tag('info').log(`Splitting research into ${targets.length} per-section requests`);
      }

      const parts: string[] = [];
      for (const [name, description] of targets) {
        if (executionController.isInterrupted()) break;
        let text = '';
        try {
          text = await this._researchSingleSection(name, description, ariaSnapshot, focusCss);
        } catch (err) {
          tag('warning').log(`Section "${name}" research failed, skipping: ${err instanceof Error ? err.message : err}`);
          continue;
        }
        if (!text) continue;
        const trimmed = text.trim();
        if (trimmed === 'NOT_PRESENT' || trimmed.startsWith('NOT_PRESENT')) continue;
        parts.push(trimmed);
      }

      if (parts.length === 0) {
        throw new Error('Per-section research produced no sections — AI responses all empty or NOT_PRESENT');
      }

      const merged = parts.join('\n\n');
      if (!focusCss) return merged;
      const focused = new ResearchResult(merged, this.actionResult?.url || '');
      markSectionAsFocused(focused, 'Focus');
      return focused.text;
    }

    private async _detectFocusCss(): Promise<string | null> {
      const focusSections = (this.explorer.getConfig().ai?.agents?.researcher as any)?.focusSections as string[] | undefined;
      if (!focusSections?.length) return null;

      for (const css of focusSections) {
        const count = await this.explorer.playwrightLocatorCount((page: any) => page.locator(css)).catch(() => 0);
        if (count > 0) return css;
      }
      return null;
    }

    private async _researchSingleSection(name: string, description: string, ariaSnapshot: string, focusCss: string | null): Promise<string> {
      const currentUrl = this.stateManager.getCurrentState()?.url || '';
      const rules = RulesLoader.loadRules('researcher', ['ui-map-table', 'list-element', 'container-rules'], currentUrl);
      const url = this.actionResult?.url || 'Unknown';
      const title = this.actionResult?.title || 'Unknown';

      let focusHint = '';
      if (focusCss) {
        focusHint = dedent`
          The user's focus is the element matching CSS '${focusCss}'.
          Use that CSS as the Container for this section.
        `;
      }

      const prompt = dedent`
        <task>
        Identify the "${name}" section on this page: ${description}
        If this section is NOT present on the page, respond with ONLY: NOT_PRESENT
        Otherwise output only this single section in the format below.
        ${focusHint}
        </task>

        <section_format>
        ## ${name}

        > Container: '.semantic-container-selector'

        | Element | ARIA | CSS | eidx |
        </section_format>

        <rules>
        - Every element with eidx MUST appear in the table.
        - Every row needs CSS; ARIA may be "-" for icon-only buttons.
        - ARIA locator JSON uses keys "role" and "text" (NOT "name").
        </rules>

        ${generalLocatorRuleText}

        ${rules}

        URL: ${url}
        Title: ${title}

        <aria>
        ${ariaSnapshot}
        </aria>
      `;

      const conversation = this.provider.startConversation((this as any).getSystemMessage(), 'researcher');
      conversation.addUserText(prompt);

      const result = await this.provider.invokeConversation(conversation, undefined, { agentName: 'researcher' });
      return result?.response.text || '';
    }
  };
}
