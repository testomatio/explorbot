import dedent from 'dedent';
import { ActionResult, type Diff } from '../../action-result.js';
import { executionController } from '../../execution-controller.ts';
import type Explorer from '../../explorer.ts';
import type { StateManager } from '../../state-manager.js';
import { WebPageState } from '../../state-manager.js';
import { detectFocusArea, diffAriaSnapshots } from '../../utils/aria.ts';
import { extractCodeBlocks } from '../../utils/code-extractor.ts';
import { tag } from '../../utils/logger.js';
import { mdq } from '../../utils/markdown-query.ts';
import type { Provider } from '../provider.js';
import { getCachedResearch, getPreviousResearch, saveResearch } from './cache.ts';
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
      await (this as any).navigateTo(state.fullUrl || state.url);

      const maxClicks = (this.explorer.getConfig().ai?.agents?.researcher as any)?.maxExpandableClicks ?? DEFAULT_MAX_EXPANDABLE_CLICKS;

      const expandedSections: string[] = [];
      const navigationLinks: Array<{ code: string; url: string }> = [];
      let verifiedCodes: string[] = [];
      let missing: PreviousSection[] = [];

      const previousSections = this._loadPreviousExtendedSections(state.hash || '');
      if (previousSections.length > 0) {
        tag('substep').log(`Replaying ${previousSections.length} previously discovered sections`);
        const replay = await this._replayPreviousSections(state, previousSections, maxClicks);
        expandedSections.push(...replay.verified);
        verifiedCodes = replay.verifiedCodes;
        missing = replay.missing;
        tag('info').log(`Reused ${replay.verified.length}/${previousSections.length} previous sections, ${missing.length} to re-discover`);

        if (missing.length === 0 && replay.verified.length >= maxClicks) {
          tag('info').log('Page appears unchanged, reusing previous sections and skipping discovery');
          this._appendExtendedResearch(result, expandedSections, navigationLinks);
          return;
        }
      }

      let expandables = await this._discoverExpandables(result.text, missing, verifiedCodes);
      if (expandables.length > maxClicks) {
        expandables = await this._selectExpandables(expandables, state.fullUrl || state.url, maxClicks);
        tag('substep').log(`Selected ${expandables.length} expandables to click (max: ${maxClicks})`);
      }

      const elements = expandables
        .map((el) => ({
          commands: this._buildClickCommands(el),
          description: el.name,
        }))
        .filter((el) => el.commands.length > 0)
        .filter((el) => !el.commands.some((cmd) => verifiedCodes.includes(cmd)));

      if (elements.length === 0) {
        tag('info').log('No new expandable elements to click');
        this._appendExtendedResearch(result, expandedSections, navigationLinks);
        return;
      }

      const expandableRows = elements.map((el) => `| ${el.description} | \`${el.commands[0]}\` |`).join('\n');
      result.text += `\n\n# Expandables\n\n| Element | Action |\n|---------|--------|\n${expandableRows}`;

      for (const el of elements) debugLog(`Expandable: ${el.description} → ${el.commands[0]}`);
      tag('substep').log(`Clicking ${elements.length} expandable elements`);

      await this._clickExpandableElements(elements, state, expandedSections, navigationLinks);

      tag('info').log(`Deep analysis complete. Sections: ${expandedSections.length}, navigation links: ${navigationLinks.length}`);

      this._appendExtendedResearch(result, expandedSections, navigationLinks);
    }

    async researchOverlay(current: ActionResult, previous: ActionResult, pageStateHash: string): Promise<string | null> {
      const focusArea = detectFocusArea(current.ariaSnapshot);
      if (!focusArea.detected || !focusArea.name) return null;
      if (focusArea.type !== 'dialog' && focusArea.type !== 'modal') return null;

      const cached = getCachedResearch(pageStateHash);
      if (!cached) return null;

      const escaped = focusArea.name.replace(/"/g, '\\"');
      if (mdq(cached).query(`section3(~"${escaped}")`).count() > 0) {
        debugLog(`Overlay "${focusArea.name}" already in cached research, skipping`);
        return null;
      }

      const diff = await current.diff(previous);
      await diff.calculate();

      if (!diff.ariaChanged && diff.htmlParts.length === 0) {
        debugLog(`No diff between current and previous state for overlay "${focusArea.name}"`);
        return null;
      }

      const alreadyExpanded = this._summarizeExpanded(
        parseResearchSections(cached)
          .filter((s) => s.elements.length > 0)
          .map((s) => s.rawMarkdown)
      );

      tag('substep').log(`Researching overlay: ${focusArea.name}`);
      const sectionMarkdown = await this._analyzeExpandedAction('', focusArea.name, diff, alreadyExpanded);
      if (!sectionMarkdown) {
        debugLog(`Overlay "${focusArea.name}" produced no meaningful expansion`);
        return null;
      }

      const extQuery = mdq(cached).query('section1(~"Extended Research")');
      let updated: string;
      if (extQuery.count() > 0) {
        const existing = extQuery.text().trimEnd();
        updated = extQuery.replace(`${existing}\n\n${sectionMarkdown}\n`);
      } else {
        updated = `${cached.trimEnd()}\n\n# Extended Research\n\n${sectionMarkdown}\n`;
      }

      saveResearch(pageStateHash, updated);
      tag('substep').log(`Overlay research appended: ${focusArea.name}`);
      return sectionMarkdown;
    }

    private _loadPreviousExtendedSections(hash: string): PreviousSection[] {
      if (!hash) return [];
      const previous = getPreviousResearch(hash);
      if (!previous) return [];

      const sections: PreviousSection[] = [];
      for (const section of parseResearchSections(previous)) {
        if (!section.isExtended) continue;
        const code = extractCodeBlocks(section.rawMarkdown)[0];
        if (!code) continue;
        sections.push({ name: section.name, code });
      }
      return sections;
    }

    private async _replayPreviousSections(state: WebPageState, prevSections: PreviousSection[], maxClicks: number): Promise<{ verified: string[]; verifiedCodes: string[]; missing: PreviousSection[] }> {
      const originalAria = state.ariaSnapshot || '';
      const verified: string[] = [];
      const verifiedCodes: string[] = [];
      const missing: PreviousSection[] = [];

      for (const section of prevSections.slice(0, maxClicks)) {
        if (executionController.isInterrupted()) break;

        let outcome: ExpansionOutcome;
        try {
          outcome = await this._executeAndAnalyze([section.code], section.name, state, originalAria, this._summarizeExpanded(verified));
        } catch (err) {
          tag('warning').log(`Replay failed for "${section.name}": ${err instanceof Error ? err.message : err}`);
          await this._restorePageState(state.url, originalAria).catch(() => {});
          missing.push(section);
          continue;
        }

        if (outcome.status === 'revealed') {
          verified.push(outcome.sectionMarkdown);
          verifiedCodes.push(section.code);
          debugLog(`Replayed and verified section: ${section.name}`);
          continue;
        }

        debugLog(`Could not replay previous section: ${section.name}`);
        missing.push(section);
      }

      return { verified, verifiedCodes, missing };
    }

    private _appendExtendedResearch(result: ResearchResult, expandedSections: string[], navigationLinks: Array<{ code: string; url: string }>): void {
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

    private async _discoverExpandables(researchText: string, missing: PreviousSection[] = [], verifiedCodes: string[] = []): Promise<ExpandableElement[]> {
      const allElements = new Map<string, ExpandableElement>();
      for (const section of parseResearchSections(researchText)) {
        for (const el of section.elements) {
          if (el.eidx != null) allElements.set(el.eidx, { ...el, container: section.containerCss });
        }
      }
      if (allElements.size === 0) return [];

      const eidxList = [...allElements.keys()].join(', ');

      let missingHint = '';
      if (missing.length > 0) {
        const list = missing.map((s) => `- "${s.name}" (previously revealed via ${s.code})`).join('\n');
        missingHint = dedent`

          These sections were present on a previous visit but their trigger could not be replayed now — the element may have moved or been renamed. Prioritize finding the element that now reveals each:
          ${list}
        `;
      }

      const textPrompt = dedent`
        From this UI research, identify elements that could reveal hidden UI when clicked
        (dropdown menus, popups, expandable panels, accordion sections, overflow menus, tab switches).

        Available eidx refs: ${eidxList}

        ${researchText}
        ${missingHint}

        Rules:
        - Only pick elements that HIDE content until clicked (menus, dropdowns, accordions, tabs)
        - Skip regular links, data items, and navigation
        - For repeated elements (same expand button on every row), pick only the FIRST one
        - Respond with comma-separated eidx refs only, e.g.: e3, e7, e15
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
          This screenshot has interactive elements labeled with eidx refs (solid bordered boxes with labels).
          Identify elements that could reveal hidden UI when clicked.

          Look for: overflow/ellipsis menus, chevron dropdowns, hamburger menus,
          gear/settings buttons, accordion toggles, tab switches, filter buttons.
          ${missingHint}

          Rules:
          - For repeated icons (same icon on every list row), pick only the FIRST one
          - Skip regular text buttons, links, and navigation items
          - Respond with comma-separated eidx refs only, e.g.: e3, e7, e15
        `;
        visionCall = this.provider.processImage(visionPrompt, screenshot.toString('base64'));
      }

      let textRes: { text?: string } | null = null;
      let visionRes: { text?: string } | null = null;
      try {
        [textRes, visionRes] = await Promise.all([textCall, visionCall]);
      } catch (err) {
        tag('warning').log(`Expandable discovery failed, skipping deep analysis: ${err instanceof Error ? err.message : err}`);
        return [];
      }

      const eidxSet = new Set<string>();
      const parseRefs = (text: string | undefined) => {
        if (!text) return [];
        const matches = text.match(/e?\d+/g) || [];
        const refs = matches.map((m) => (m.startsWith('e') ? m : `e${m}`));
        return refs.filter((r) => allElements.has(r));
      };

      for (const res of [textRes, visionRes]) {
        for (const ref of parseRefs(res?.text)) {
          eidxSet.add(ref);
        }
      }

      const textRefs = parseRefs(textRes?.text);
      const visionRefs = parseRefs(visionRes?.text);
      debugLog(`Text model picked eidx: [${textRefs.join(', ')}], Vision model picked eidx: [${visionRefs.join(', ')}]`);

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
      let r: { text?: string };
      try {
        r = await this.provider.chat([{ role: 'user', content: prompt }], model, {
          agentName: 'researcher',
          telemetryFunctionId: 'researcher.selectExpandables',
        });
      } catch (err) {
        tag('warning').log(`Expandable selection failed, using first ${maxClicks}: ${err instanceof Error ? err.message : err}`);
        return expandables.slice(0, maxClicks);
      }

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
            await this.explorer.attemptAction(hoverCmd, undefined, false);
            await new Promise((r) => setTimeout(r, 500));

            await this.explorer.capturePageState();
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

          const outcome = await this._executeAndAnalyze(el.commands, el.description, state, originalAria, this._summarizeExpanded(expandedSections));
          if (outcome.status === 'navigated') {
            navigationLinks.push({ code: outcome.code, url: outcome.url });
            continue;
          }
          if (outcome.status === 'revealed') {
            expandedSections.push(outcome.sectionMarkdown);
            debugLog(`Captured section from: ${el.description.slice(0, 80)}`);
          }
        } catch (err) {
          tag('warning').log(`Expandable click failed for "${el.description.slice(0, 80)}": ${err instanceof Error ? err.message : err}`);
          try {
            await this._restorePageState(state.url, originalAria);
          } catch {}
        }
      }
    }

    private async _executeAndAnalyze(commands: string[], description: string, state: WebPageState, originalAria: string, alreadyExpanded: string[]): Promise<ExpansionOutcome> {
      const previousState = ActionResult.fromState(this.stateManager.getCurrentState()!);

      let clickCode: string | null = null;
      const action = this.explorer.createAction();
      for (const cmd of commands) {
        if (await action.attempt(cmd, undefined, false)) {
          clickCode = cmd;
          break;
        }
      }
      if (!clickCode) {
        debugLog(`Click failed: ${description.slice(0, 80)}`);
        return { status: 'failed' };
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
        return { status: 'failed' };
      }

      if (diff.urlHasChanged()) {
        const url = this.stateManager.getCurrentState()?.url || '';
        debugLog(`Click navigated to ${url}`);
        await (this as any).navigateTo(state.url);
        return { status: 'navigated', code: clickCode, url };
      }

      const clickHtmlSize = diff.htmlParts.reduce((sum, p) => sum + p.subtree.length, 0);
      if (!diff.ariaChanged && clickHtmlSize <= 150) {
        debugLog(`No changes from: ${description.slice(0, 80)}`);
        return { status: 'none', code: clickCode };
      }

      const sectionMarkdown = await this._analyzeExpandedAction(clickCode, description, diff, alreadyExpanded);
      await this._restorePageState(state.url, originalAria);
      if (!sectionMarkdown) return { status: 'none', code: clickCode };
      return { status: 'revealed', code: clickCode, sectionMarkdown };
    }

    private async _restorePageState(url: string, originalAria: string): Promise<void> {
      try {
        await (this as any).cancelInUi();
        await this.explorer.capturePageState();
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

      let intro: string;
      if (code) {
        intro = `An action on "${description}" (\`${code}\`) revealed new UI content.`;
      } else {
        intro = `An overlay "${description}" appeared on the page.`;
      }

      let actionBlock = '';
      if (code) {
        actionBlock = dedent`
          Action:

          \`\`\`js
          ${code}
          \`\`\`

        `;
      }

      const prompt = dedent`
        ${intro}
        Analyze the changes and produce a UI map section.

        ARIA changes:
        ${diff.ariaChanged || 'none'}

        HTML changes:
        ${diff.htmlParts.map((p) => `[Container: ${p.container}]\n${p.subtree}`).join('\n\n') || 'none'}
        ${alreadyHint}

        Respond with a SINGLE section in this format:

        ### <Short descriptive name>

        ${actionBlock}<One sentence: what appeared — dropdown menu, modal, tab content, expanded panel, etc.>

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

interface PreviousSection {
  name: string;
  code: string;
}

type ExpansionOutcome = { status: 'revealed'; code: string; sectionMarkdown: string } | { status: 'navigated'; code: string; url: string } | { status: 'none'; code: string } | { status: 'failed' };

export interface DeepAnalysisMethods {
  performDeepAnalysis(state: WebPageState, result: ResearchResult): Promise<void>;
  researchOverlay(current: ActionResult, previous: ActionResult, pageStateHash: string): Promise<string | null>;
}
