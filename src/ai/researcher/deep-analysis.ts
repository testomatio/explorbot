import dedent from 'dedent';
import { ActionResult, type Diff } from '../../action-result.js';
import type Explorer from '../../explorer.ts';
import type { StateManager } from '../../state-manager.js';
import { WebPageState } from '../../state-manager.js';
import { diffAriaSnapshots } from '../../utils/aria.ts';
import { executionController } from '../../execution-controller.ts';
import { tag } from '../../utils/logger.js';
import type { Provider } from '../provider.js';
import { type Constructor, debugLog } from './mixin.ts';
import { type ResearchElement, parseResearchSections } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

const DEFAULT_MAX_EXPANDABLE_CLICKS = 10;

export function WithDeepAnalysis<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;
    declare provider: Provider;
    declare stateManager: StateManager;
    declare actionResult: ActionResult | undefined;

    async performDeepAnalysis(state: WebPageState, result: ResearchResult): Promise<void> {
      tag('info').log('Starting deep analysis of expandable elements');
      await (this as any).navigateTo(state.url);

      let expandables = await this._discoverExpandables(result.text);
      if (expandables.length === 0) {
        tag('info').log('No expandable elements identified by AI');
        return;
      }
      tag('substep').log(`Identified ${expandables.length} expandable elements`);

      const maxClicks = (this.explorer.getConfig().ai?.agents?.researcher as any)?.maxExpandableClicks ?? DEFAULT_MAX_EXPANDABLE_CLICKS;
      if (expandables.length > maxClicks) {
        expandables = await this._selectExpandables(expandables, state.url, maxClicks);
        tag('substep').log(`Selected ${expandables.length} expandables to click (max: ${maxClicks})`);
      }

      const elements = expandables
        .map((el) => ({
          commands: this._buildClickCommands(el),
          description: el.name,
        }))
        .filter((el) => el.commands.length > 0);

      if (elements.length === 0) {
        tag('info').log('No expandables with valid locators');
        return;
      }

      const expandableRows = elements.map((el) => `| ${el.description} | \`${el.commands[0]}\` |`).join('\n');
      result.text += `\n\n# Expandables\n\n| Element | Action |\n|---------|--------|\n${expandableRows}`;

      for (const el of elements) debugLog(`Expandable: ${el.description} → ${el.commands[0]}`);
      tag('substep').log(`Clicking ${elements.length} expandable elements`);

      const expandedSections: string[] = [];
      const navigationLinks: Array<{ code: string; url: string }> = [];

      await this._clickExpandableElements(elements, state, expandedSections, navigationLinks);

      tag('info').log(`Deep analysis complete. Sections: ${expandedSections.length}, navigation links: ${navigationLinks.length}`);

      const dedupedSections = this._deduplicateExpandedSections(expandedSections);
      if (dedupedSections.length !== expandedSections.length) {
        tag('substep').log(`Deduplicated ${expandedSections.length} → ${dedupedSections.length} extended sections`);
      }

      if (dedupedSections.length > 0) {
        result.text += `\n\n# Extended Research\n\n${dedupedSections.join('\n\n---\n\n')}`;
      }
      if (navigationLinks.length > 0) {
        const links = navigationLinks.map((l) => `- \`${l.code}\` opens ${l.url}`).join('\n');
        result.text += `\n\n## Navigation Links\n\n${links}`;
      }
    }

    private async _discoverExpandables(researchText: string): Promise<ExpandableElement[]> {
      const allElements = new Map<number, ExpandableElement>();
      for (const section of parseResearchSections(researchText)) {
        for (const el of section.elements) {
          if (el.eidx != null) allElements.set(el.eidx, { ...el, container: section.containerCss });
        }
      }
      if (allElements.size === 0) return [];

      const eidxList = [...allElements.keys()].join(', ');

      const textPrompt = dedent`
        From this UI research, identify elements that could reveal hidden UI when clicked
        (dropdown menus, popups, expandable panels, accordion sections, overflow menus, tab switches).

        Available eidx numbers: ${eidxList}

        ${researchText}

        Rules:
        - Only pick elements that HIDE content until clicked (menus, dropdowns, accordions, tabs)
        - Skip regular links, data items, and navigation
        - For repeated elements (same expand button on every row), pick only the FIRST one
        - Respond with comma-separated eidx numbers only, e.g.: 3, 7, 15
      `;

      const model = this.provider.getModelForAgent('researcher');
      const textCall = this.provider.chat([{ role: 'user', content: textPrompt }], model, {
        agentName: 'researcher',
        telemetryFunctionId: 'researcher.discoverExpandables.text',
      });

      let visionCall: Promise<{ text?: string } | null> = Promise.resolve(null);
      const screenshot = this.actionResult?.screenshot;
      if (screenshot && this.provider.hasVision()) {
        const visionPrompt = dedent`
          This screenshot has interactive elements labeled with eidx numbers (solid bordered boxes with numbers).
          Identify elements that could reveal hidden UI when clicked.

          Look for: overflow/ellipsis menus, chevron dropdowns, hamburger menus,
          gear/settings buttons, accordion toggles, tab switches, filter buttons.

          Rules:
          - For repeated icons (same icon on every list row), pick only the FIRST one
          - Skip regular text buttons, links, and navigation items
          - Respond with comma-separated eidx numbers only, e.g.: 3, 7, 15
        `;
        visionCall = this.provider.processImage(visionPrompt, screenshot.toString('base64'));
      }

      const [textRes, visionRes] = await Promise.all([textCall, visionCall]);

      const eidxSet = new Set<number>();
      for (const res of [textRes, visionRes]) {
        if (!res?.text) continue;
        const nums = res.text.match(/\d+/g)?.map(Number) || [];
        for (const n of nums) {
          if (allElements.has(n)) eidxSet.add(n);
        }
      }

      const textNums =
        textRes?.text
          ?.match(/\d+/g)
          ?.map(Number)
          .filter((n) => allElements.has(n)) || [];
      const visionNums =
        visionRes?.text
          ?.match(/\d+/g)
          ?.map(Number)
          .filter((n) => allElements.has(n)) || [];
      debugLog(`Text model picked eidx: [${textNums.join(', ')}], Vision model picked eidx: [${visionNums.join(', ')}]`);

      return [...eidxSet].map((eidx) => allElements.get(eidx)!);
    }

    private _buildClickCommands(el: ExpandableElement): string[] {
      const commands: string[] = [];
      const escapeQuote = (s: string) => s.replace(/'/g, "\\'");
      const hasAriaText = el.aria && /\w/.test(el.aria.text) && el.aria.text !== '-';
      if (hasAriaText && el.container) {
        commands.push(`I.click(${JSON.stringify(el.aria)}, '${escapeQuote(el.container)}')`);
      }
      if (hasAriaText) {
        commands.push(`I.click(${JSON.stringify(el.aria)})`);
      }
      if (el.css && el.container) {
        commands.push(`I.click('${escapeQuote(el.css)}', '${escapeQuote(el.container)}')`);
      }
      if (el.css) {
        commands.push(`I.click('${escapeQuote(el.css)}')`);
      }
      if (el.coordinates) {
        const match = el.coordinates.match(/\((\d+),\s*(\d+)\)/);
        if (match && Number(match[1]) > 1 && Number(match[2]) > 1) {
          commands.push(`I.clickXY(${match[1]}, ${match[2]})`);
        }
      }
      return commands;
    }

    private async _selectExpandables(expandables: ExpandableElement[], url: string, maxClicks: number): Promise<ExpandableElement[]> {
      const list = expandables.map((el, i) => `${i + 1}. ${el.name} ${el.aria ? JSON.stringify(el.aria) : el.css || ''}`).join('\n');

      const prompt = dedent`
        Page: ${url}

        These expandable elements were found on the page.
        Select up to ${maxClicks} elements worth clicking to discover hidden UI.

        ${list}

        Rules:
        - Prioritize overflow/ellipsis menus, settings dropdowns, and toolbar buttons
        - Skip repeated expand icons on list rows — keep only the first
        - Skip global navigation, sidebar menus, user profile menus
        - Respond with comma-separated numbers to keep, e.g.: 1, 3, 5
      `;

      const model = this.provider.getModelForAgent('researcher');
      const r = await this.provider.chat([{ role: 'user', content: prompt }], model, {
        agentName: 'researcher',
        telemetryFunctionId: 'researcher.selectExpandables',
      });

      const nums = (r.text || '').match(/\d+/g)?.map(Number) || [];
      const selected = expandables.filter((_, i) => nums.includes(i + 1));
      return selected.length > 0 ? selected.slice(0, maxClicks) : expandables.slice(0, maxClicks);
    }

    private async _clickExpandableElements(elements: Array<{ commands: string[]; description: string }>, state: WebPageState, expandedSections: string[], navigationLinks: Array<{ code: string; url: string }>): Promise<void> {
      const originalAria = state.ariaSnapshot || '';

      for (const el of elements) {
        if (executionController.isInterrupted()) break;
        try {
          debugLog(`Clicking: ${el.description.slice(0, 100)}`);
          const previousState = ActionResult.fromState(this.stateManager.getCurrentState()!);

          const isCoordinateClick = el.commands[0].startsWith('I.clickXY(');
          if (!isCoordinateClick) {
            const hoverCmd = el.commands[0].replace('I.click(', 'I.moveCursorTo(');
            const hoverAction = this.explorer.createAction();
            await hoverAction.attempt(hoverCmd, undefined, false);
            await new Promise((r) => setTimeout(r, 500));

            await this.explorer.createAction().capturePageState();
            const hoverAR = ActionResult.fromState(this.stateManager.getCurrentState()!);
            const hoverDiff = await hoverAR.diff(previousState);
            await hoverDiff.calculate();
            const hoverHtmlSize = hoverDiff.htmlParts.reduce((sum, p) => sum + p.subtree.length, 0);
            const hoverRevealed = hoverDiff.ariaChanged && hoverHtmlSize > 500;

            if (hoverRevealed) {
              const sectionMarkdown = await this._analyzeExpandedAction(hoverCmd, el.description, hoverDiff, this._summarizeExpanded(expandedSections));
              if (sectionMarkdown) {
                expandedSections.push(sectionMarkdown);
                debugLog(`Captured section from hover: ${el.description.slice(0, 80)}`);
                await this._restorePageState(state.url, originalAria);
                continue;
              }
              await this._restorePageState(state.url, originalAria);
            }
          }

          let clickCode: string | null = null;
          const action = this.explorer.createAction();
          for (const cmd of el.commands) {
            if (await action.attempt(cmd, undefined, false)) {
              clickCode = cmd;
              break;
            }
          }
          if (!clickCode) {
            debugLog(`Click failed: ${el.description.slice(0, 80)}`);
            continue;
          }

          await new Promise((r) => setTimeout(r, 500));

          let diff: Diff;
          try {
            await this.explorer.createAction().capturePageState();
            const currAR = ActionResult.fromState(this.stateManager.getCurrentState()!);
            diff = await currAR.diff(previousState);
            await diff.calculate();
          } catch (err) {
            tag('warning').log(`State capture failed after click: ${err instanceof Error ? err.message : err}`);
            await this._restorePageState(state.url, originalAria);
            continue;
          }

          if (diff.urlHasChanged()) {
            debugLog(`Click navigated to ${this.stateManager.getCurrentState()?.url}`);
            navigationLinks.push({ code: clickCode, url: this.stateManager.getCurrentState()?.url || '' });
            await (this as any).navigateTo(state.url);
            continue;
          }

          const clickHtmlSize = diff.htmlParts.reduce((sum, p) => sum + p.subtree.length, 0);
          if (!diff.ariaChanged && clickHtmlSize <= 150) {
            debugLog(`No changes from: ${el.description.slice(0, 80)}`);
            continue;
          }

          const sectionMarkdown = await this._analyzeExpandedAction(clickCode, el.description, diff, this._summarizeExpanded(expandedSections));
          if (sectionMarkdown) {
            expandedSections.push(sectionMarkdown);
            debugLog(`Captured section from: ${el.description.slice(0, 80)}`);
          }

          await this._restorePageState(state.url, originalAria);
        } catch (err) {
          tag('warning').log(`Expandable click failed for "${el.description.slice(0, 80)}": ${err instanceof Error ? err.message : err}`);
          try {
            await this._restorePageState(state.url, originalAria);
          } catch {}
        }
      }
    }

    private async _restorePageState(url: string, originalAria: string): Promise<void> {
      try {
        await (this as any).cancelInUi();
        await this.explorer.createAction().capturePageState();
        const currentAria = this.stateManager.getCurrentState()?.ariaSnapshot || '';
        if (!diffAriaSnapshots(originalAria, currentAria)) return;
      } catch (err) {
        tag('warning').log(`State capture failed after cancelInUi: ${err instanceof Error ? err.message : err}`);
      }
      debugLog('ARIA not restored after cancelInUi, reloading page');
      try {
        await (this as any).navigateTo(url);
      } catch (err) {
        tag('warning').log(`navigateTo failed during restore: ${err instanceof Error ? err.message : err}`);
      }
    }

    private async _analyzeExpandedAction(code: string, description: string, diff: Diff, alreadyExpanded: string[]): Promise<string | null> {
      const alreadyHint = alreadyExpanded.length > 0 ? `\nAlready expanded sections:\n${alreadyExpanded.join('\n')}` : '';

      const prompt = dedent`
        An action on "${description}" (\`${code}\`) revealed new UI content.
        Analyze the changes and produce a UI map section.

        ARIA changes:
        ${diff.ariaChanged || 'none'}

        HTML changes:
        ${diff.htmlParts.map((p) => `[Container: ${p.container}]\n${p.subtree}`).join('\n\n') || 'none'}
        ${alreadyHint}

        Respond with a SINGLE section in this format:

        ### <Short descriptive name>

        Action:

        \`\`\`js
        ${code}
        \`\`\`

        <One sentence: what appeared — dropdown menu, modal, tab content, expanded panel, etc.>

        | Element | ARIA | CSS |
        |---------|------|-----|
        | 'Save' | { role: 'button', text: 'Save' } | 'button.save' |

        Rules:
        - Only include interactive elements (buttons, links, inputs, selects, toggles)
        - Exclude non-interactive elements (paragraphs, headings, static text, decorative icons) — describe them in the sentence above the table
        - Provide CSS selectors derived from HTML classes, or ARIA locators — both are acceptable
        - Do NOT expand similar list items — if the revealed content has the same structure as an already expanded section (same type of elements on a different list row), respond with "No meaningful expansion."
        - If changes are minor (no new interactive elements), respond with "No meaningful expansion."
        - If the revealed content is purely data items (list of records, entries, rows) with no new UI controls, respond with "No meaningful expansion."
        - If you cannot clearly name what appeared, respond with "No meaningful expansion."
      `;

      const model = this.provider.getModelForAgent('researcher');
      const r = await this.provider.chat([{ role: 'user', content: prompt }], model, { agentName: 'researcher', telemetryFunctionId: 'researcher.analyzeExpandedAction' });
      const text = r.text || '';

      if (text.toLowerCase().includes('no meaningful expansion')) return null;

      const sections = parseResearchSections(text);
      if (sections.length === 0) return null;

      return sections[0].rawMarkdown;
    }

    private _deduplicateExpandedSections(sections: string[]): string[] {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const section of sections) {
        const fingerprint = this._sectionFingerprint(section);
        if (fingerprint && seen.has(fingerprint)) {
          debugLog('Dedup: skipping duplicate extended section');
          continue;
        }
        if (fingerprint) seen.add(fingerprint);
        result.push(section);
      }
      return result;
    }

    private _summarizeExpanded(expandedSections: string[]): string[] {
      return expandedSections
        .map((s) => {
          const info = this._parseSectionKeys(s);
          if (!info) return null;
          return `- ${info.name}: ${info.keys.join(', ')}`;
        })
        .filter(Boolean) as string[];
    }

    private _sectionFingerprint(sectionMarkdown: string): string | null {
      const info = this._parseSectionKeys(sectionMarkdown);
      if (!info) return null;
      return [...info.keys].sort().join('|');
    }

    private _parseSectionKeys(sectionMarkdown: string): { name: string; keys: string[] } | null {
      const parsed = parseResearchSections(sectionMarkdown);
      if (parsed.length === 0 || parsed[0].elements.length === 0) return null;
      const section = parsed[0];
      return { name: section.name, keys: section.elements.map((el) => el.css || (el.aria ? `${el.aria.role}:${el.aria.text}` : null) || el.name) };
    }
  };
}

interface ExpandableElement extends ResearchElement {
  container: string | null;
}

export interface DeepAnalysisMethods {
  performDeepAnalysis(state: WebPageState, result: ResearchResult): Promise<void>;
}
