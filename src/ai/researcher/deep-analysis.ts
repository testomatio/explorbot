import dedent from 'dedent';
import { ActionResult, type Diff } from '../../action-result.js';
import type Explorer from '../../explorer.ts';
import type { StateManager } from '../../state-manager.js';
import { WebPageState } from '../../state-manager.js';
import { diffAriaSnapshots } from '../../utils/aria.ts';
import { EXPANDABLE_ICON_DESCRIPTIONS, buildExpandableXPath, buildExpandableXPathInsideContainers } from '../../utils/expandable.ts';
import { tag } from '../../utils/logger.js';
import { findTableLineRange, parseSections } from '../../utils/markdown-parser.ts';
import { mdq } from '../../utils/markdown-query.ts';
import { WebElement } from '../../utils/web-element.ts';
import type { Provider } from '../provider.js';
import { hasFocusedSection } from './focus.ts';
import { type Constructor, debugLog } from './mixin.ts';
import { extractContainerFromBlockquote, parseResearchSections } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

const MAX_UNFILTERED_ELEMENTS = 3;

export function WithDeepAnalysis<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;
    declare provider: Provider;
    declare stateManager: StateManager;
    declare actionResult: ActionResult | undefined;

    async performDeepAnalysis(state: WebPageState, result: ResearchResult): Promise<void> {
      tag('info').log('Starting deep analysis to find all expandable elements');
      await (this as any).navigateTo(state.url);
      const expandedSections: string[] = [];
      const navigationLinks: Array<{ code: string; url: string }> = [];

      const allSections = parseSections(result.text);
      const dataContainerCandidates: string[] = [];
      for (const s of allSections) {
        const container = extractContainerFromBlockquote(s.rawMarkdown);
        if (!container) continue;
        const isDataSection = s.name.toLowerCase().includes('data') || !findTableLineRange(s.rawMarkdown);
        if (isDataSection) dataContainerCandidates.push(container);
      }
      const dataContainers: string[] = [];
      for (const css of dataContainerCandidates) {
        const valid = await this.explorer.hasPlaywrightLocator((page) => page.locator(css), { contents: true });
        if (valid) {
          dataContainers.push(css);
        } else {
          debugLog(`Data container "${css}" not found on page, skipping exclusion`);
        }
      }
      if (dataContainers.length > 0) debugLog(`Data containers to exclude: ${dataContainers.join(', ')}`);

      const discoveredElements = await this._discoverExpandableElements(dataContainers);
      const escapeQuote = (s: string) => s.replace(/'/g, "\\'");
      const xpathElements = discoveredElements.map((el) => {
        const commands = [`I.click('${escapeQuote(el.clickXPath)}')`];
        if (el.xpath) commands.push(`I.click('${escapeQuote(el.xpath)}')`);
        const desc = !el.text && el.outerHTML ? `${el.description} html: ${el.outerHTML}` : el.description;
        return { commands, description: desc };
      });

      let visualElements: Array<{ commands: string[]; description: string }> = [];
      if (this.provider.hasVision()) {
        tag('substep').log('Discovering expandable elements from screenshot');
        const visual = await this._discoverExpandableByScreenshot(
          state,
          discoveredElements.map((el) => el.description.slice(0, 100))
        );
        visualElements = visual.map((el) => ({ commands: [el.locator], description: el.description }));
      }

      const allElements = [...xpathElements, ...visualElements];
      tag('substep').log(`Found ${allElements.length} expandable elements (${xpathElements.length} XPath + ${visualElements.length} visual)`);

      const focusedContainer = this._getFocusedContainer(result.text);
      const filtered = await this._filterExpandableElements(allElements, result.text, state.url, focusedContainer);
      tag('substep').log(`Clicking ${filtered.length} filtered expandable elements`);
      await this._clickExpandableElements(filtered, state, expandedSections, navigationLinks);

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

    private async _discoverExpandableElements(dataContainers: string[] = []): Promise<WebElement[]> {
      const freshState = await this.explorer.createAction().capturePageState();
      const html = freshState.html;
      if (!html) return [];

      const findResult = await WebElement.findByXPath(html, buildExpandableXPath(dataContainers));
      if (findResult.error || findResult.elements.length === 0) return [];

      const elements = findResult.elements.filter((el) => !el.isNavigationLink);

      for (const xpath of buildExpandableXPathInsideContainers(dataContainers)) {
        const containerResult = await WebElement.findByXPath(html, xpath);
        const first = containerResult.elements.find((el) => !el.isNavigationLink);
        if (first) elements.push(first);
      }

      const clickXPathIndex = new Map<string, number>();
      for (const el of elements) {
        const idx = (clickXPathIndex.get(el.clickXPath) || 0) + 1;
        clickXPathIndex.set(el.clickXPath, idx);
        if (idx > 1) el.clickXPath = `(${el.clickXPath})[${idx}]`;
      }
      for (const [xpath, count] of clickXPathIndex) {
        if (count > 1) {
          const first = elements.find((el) => el.clickXPath === xpath);
          if (first) first.clickXPath = `(${xpath})[1]`;
        }
      }

      debugLog(`Discovered ${elements.length} expandable elements`);
      for (const el of elements) debugLog(`  -> ${el.description.slice(0, 80)}  click: ${el.clickXPath}`);

      return elements;
    }

    private async _discoverExpandableByScreenshot(state: WebPageState, alreadyFound: string[]): Promise<Array<{ locator: string; description: string }>> {
      const actionResult = ActionResult.fromState(state);
      const screenshot = actionResult.screenshot;
      if (!screenshot) return [];

      const alreadyList = alreadyFound.length > 0 ? `\nIgnore these elements already found:\n${alreadyFound.map((e, i) => `${i + 1}. ${e}`).join('\n')}` : '';

      const iconList = EXPANDABLE_ICON_DESCRIPTIONS.map((d) => `- ${d}`).join('\n');

      const prompt = dedent`
        Find ALL small clickable icons on this page that could reveal hidden UI (dropdowns, menus, popups, expandable sections).

        Look specifically for these icon types:
        ${iconList}

        Focus on icon-only buttons and small icons next to text labels.
        Ignore regular text buttons, links, and navigation items.
        ${alreadyList}

        Return a markdown table with columns: Description | X | Y
        where X and Y are integer pixel coordinates of the icon center.

        If no expandable icons found, respond with <none>.
      `;

      try {
        const r = await this.provider.processImage(prompt, screenshot.toString('base64'));
        const text = r.text || '';
        if (text.toLowerCase().includes('<none>')) return [];

        const rows = mdq(text).query('table').toJson();
        return rows
          .filter((r) => r.X && r.Y && /^\d+$/.test(r.X) && /^\d+$/.test(r.Y))
          .map((r) => ({
            locator: `I.clickXY(${r.X}, ${r.Y})`,
            description: `[VISUAL] ${r.Description || 'icon'} at (${r.X}, ${r.Y})`,
          }));
      } catch (err) {
        debugLog(`Screenshot expandable discovery failed: ${err instanceof Error ? err.message : err}`);
        return [];
      }
    }

    private async _filterExpandableElements(elements: Array<{ commands: string[]; description: string }>, researchText: string, url: string, focusedContainer?: string | null): Promise<Array<{ commands: string[]; description: string }>> {
      if (elements.length <= MAX_UNFILTERED_ELEMENTS) return elements;

      const sectionNames = parseSections(researchText).map((s) => s.name);
      const list = elements.map((el, i) => `${i + 1}. ${el.description}`).join('\n');
      const focusHint = focusedContainer ? `- Select expandable elements from the focused section (container: ${focusedContainer}) before selecting from other sections` : '';

      const prompt = dedent`
        Page: ${url}
        Page sections: ${sectionNames.join(', ')}

        These expandable elements were found on the page.
        Select which elements are worth clicking to discover hidden UI
        that is relevant to the page's main content and business goals.

        ${list}

        Rules:
        - Focus on elements in the MAIN CONTENT area of the page
        ${focusHint}
        - Buttons that reveal hidden content are the most valuable: overflow/ellipsis menus (hide actions like edit, delete), chevrons and arrows (expand sections, show submenus), accordion toggles, disclosure triangles
        - Skip global navigation, sidebar menus, user profile menus — anything unrelated to the page purpose
        - For repeated elements (e.g., per-row action buttons in a list), keep only the FIRST one
        - Respond with comma-separated numbers to keep, e.g.: 1, 3, 5
      `;

      const model = this.provider.getModelForAgent('researcher');
      const r = await this.provider.chat([{ role: 'user', content: prompt }], model, {
        agentName: 'researcher',
        telemetryFunctionId: 'researcher.filterExpandable',
      });

      const nums = (r.text || '').match(/\d+/g)?.map(Number) || [];
      const filtered = elements.filter((_, i) => nums.includes(i + 1));
      debugLog(`AI filtered ${elements.length} → ${filtered.length} elements`);
      return filtered.length > 0 ? filtered : elements.slice(0, MAX_UNFILTERED_ELEMENTS);
    }

    private async _clickExpandableElements(elements: Array<{ commands: string[]; description: string }>, state: WebPageState, expandedSections: string[], navigationLinks: Array<{ code: string; url: string }>): Promise<void> {
      const originalAria = state.ariaSnapshot || '';

      for (const el of elements) {
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
              const sectionMarkdown = await this._analyzeExpandedAction(hoverCmd, el.description, hoverDiff);
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

          const sectionMarkdown = await this._analyzeExpandedAction(clickCode, el.description, diff);
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

    private async _analyzeExpandedAction(code: string, description: string, diff: Diff): Promise<string | null> {
      const prompt = dedent`
        An action on "${description}" (\`${code}\`) revealed new UI content.
        Analyze the changes and produce a UI map section.

        ARIA changes:
        ${diff.ariaChanged || 'none'}

        HTML changes:
        ${diff.htmlParts.map((p) => `[Container: ${p.container}]\n${p.subtree}`).join('\n\n') || 'none'}

        Respond with a SINGLE section in this format:

        ### <Short descriptive name>

        Action:

        \`\`\`js
        ${code}
        \`\`\`

        > Container: \`<css-selector>\`

        <One sentence about what appeared>

        | Element | ARIA | CSS |
        |---------|------|-----|
        | 'Name' | { role: 'x', text: 'y' } | - |

        Rules:
        - Container CSS must NOT use dynamic IDs (ember*, react*, data-id)
        - Use ARIA locators for elements inside the container
        - Set CSS to \`-\` for elements inside expandable containers
        - If changes are minor (no new interactive elements), respond with "No meaningful expansion."
        - If the revealed content is purely data items (list of records, entries, rows) with no new UI controls, respond with "No meaningful expansion."
      `;

      const model = this.provider.getModelForAgent('researcher');
      const r = await this.provider.chat([{ role: 'user', content: prompt }], model, { agentName: 'researcher', telemetryFunctionId: 'researcher.analyzeExpandedAction' });
      const text = r.text || '';

      if (text.toLowerCase().includes('no meaningful expansion')) return null;

      const sections = parseResearchSections(text);
      if (sections.length === 0) return null;

      const section = sections[0];
      if (!section.containerCss) return null;
      if (/(?:#ember|#react|#__next)\d+/.test(section.containerCss)) {
        debugLog(`Expanded section "${section.name}" has dynamic ID container, skipping`);
        return null;
      }

      return section.rawMarkdown;
    }

    private _getFocusedContainer(researchText: string): string | null {
      if (!hasFocusedSection(researchText)) return null;
      for (const section of parseResearchSections(researchText)) {
        if (section.rawMarkdown.includes('> **Focused**') && section.containerCss) {
          return section.containerCss;
        }
      }
      return null;
    }

    private _deduplicateExpandedSections(sections: string[]): string[] {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const section of sections) {
        const container = extractContainerFromBlockquote(section);
        const fingerprint = container ? this._normalizeContainer(container) : null;
        if (fingerprint && seen.has(fingerprint)) {
          debugLog(`Dedup: skipping duplicate extended section with container "${container}"`);
          continue;
        }
        if (fingerprint) seen.add(fingerprint);
        result.push(section);
      }
      return result;
    }

    private _normalizeContainer(css: string): string {
      const lastSegment = css.split(/[\s>]+/).pop() || css;
      const classes = lastSegment.match(/\.[\w-]+/g);
      if (!classes || classes.length === 0) return css.trim().toLowerCase();
      return classes.sort().join(' ');
    }
  };
}

export interface DeepAnalysisMethods {
  performDeepAnalysis(state: WebPageState, result: ResearchResult): Promise<void>;
}
