import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import { setActivity } from '../activity.ts';
import { ConfigParser } from '../config.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.ts';
import { Observability } from '../observability.ts';
import type { StateManager } from '../state-manager.js';
import { WebPageState } from '../state-manager.js';
import { Stats } from '../stats.ts';
import { diffAriaSnapshots, parseAriaLocator } from '../utils/aria.ts';
import { isErrorPage } from '../utils/error-page.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { isBodyEmpty } from '../utils/html.ts';
import { createDebug, pluralize, tag } from '../utils/logger.js';
import { findTableLineRange, parseSections } from '../utils/markdown-parser.ts';
import { mdq } from '../utils/markdown-query.ts';
import { type ResearchSection, extractContainerFromBlockquote, parseResearchSections, rebuildSectionMarkdown } from '../utils/research-parser.ts';
import { EXPANDABLE_ICON_DESCRIPTIONS, EXPANDABLE_XPATHS, buildClickableXPath, cssToAncestorXPath, evaluateXPath } from '../utils/xpath.ts';
import type { Agent } from './agent.js';
import type { Conversation } from './conversation.js';
import type { Navigator } from './navigator.ts';
import type { Provider } from './provider.js';
import { locatorRule as generalLocatorRuleText, listElementRule, screenshotUiMapRule, uiMapTableFormat } from './rules.js';
import { TaskAgent } from './task-agent.ts';

const debugLog = createDebug('explorbot:researcher');

const POSSIBLE_SECTIONS = {
  focus: 'focused overlay (modal, drawer, popup, active form)',
  list: 'list area (items collection, table, cards, or list view)',
  detail: 'detail area (selected item preview or full details)',
  panes: 'screen is split into equal panes, describe each pane',
  content: 'main area of page',
  menu: 'navigation area',
};

export interface Locator {
  section: string;
  container: string | null;
  element: string;
  type: 'css' | 'xpath' | 'aria';
  locator: string;
  valid: boolean | null;
}

export class Researcher extends TaskAgent implements Agent {
  protected readonly ACTION_TOOLS = ['click'];
  emoji = '🔍';
  private static researchCache: Record<string, string> = {};
  private static researchCacheTimestamps: Record<string, number> = {};
  private explorer: Explorer;
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;
  private hasScreenshotToAnalyze = false;
  private actionResult?: ActionResult;
  private hooksRunner: HooksRunner;

  constructor(explorer: Explorer, provider: Provider) {
    super();
    this.explorer = explorer;
    this.provider = provider;
    this.stateManager = explorer.getStateManager();
    this.experienceTracker = this.stateManager.getExperienceTracker();
    this.hooksRunner = new HooksRunner(explorer, explorer.getConfig());
  }

  protected getNavigator(): Navigator {
    throw new Error('not implemented');
  }

  protected getExperienceTracker(): ExperienceTracker {
    return this.experienceTracker;
  }

  protected getKnowledgeTracker(): KnowledgeTracker {
    return this.explorer.getKnowledgeTracker();
  }

  protected getProvider(): Provider {
    return this.provider;
  }

  static getCachedResearch(state: WebPageState): string {
    if (!state.hash) return '';
    const ttl = 60 * 60 * 1000;
    const now = Date.now();
    const timestamp = Researcher.researchCacheTimestamps[state.hash];
    if (timestamp && now - timestamp <= ttl) {
      return Researcher.researchCache[state.hash] || '';
    }
    const outputDir = ConfigParser.getInstance().getOutputDir();
    const researchFile = join(outputDir, 'research', `${state.hash}.md`);
    if (!existsSync(researchFile)) return '';
    const stats = statSync(researchFile);
    if (now - stats.mtimeMs > ttl) return '';
    const cached = readFileSync(researchFile, 'utf8');
    Researcher.researchCache[state.hash] = cached;
    Researcher.researchCacheTimestamps[state.hash] = now;
    return cached;
  }

  getSystemMessage(): string {
    const customPrompt = this.provider.getSystemPromptForAgent('researcher');
    return dedent`
    <role>
    You are senior QA focused on exploritary testig of web application.
    </role>

    ${customPrompt || ''}
    `;
  }

  async research(state: WebPageState, opts: { screenshot?: boolean; force?: boolean; deep?: boolean; data?: boolean; fix?: boolean; _retriesLeft?: number } = {}): Promise<string> {
    const { screenshot = false, force = false, deep = false, data = false, fix = true } = opts;
    const maxRetries = (this.explorer.getConfig().ai?.agents?.researcher as any)?.retries ?? 2;
    const retriesLeft = opts._retriesLeft ?? maxRetries;
    this.actionResult = ActionResult.fromState(state);
    const stateHash = state.hash || this.actionResult.getStateHash();
    const outputDir = stateHash ? ConfigParser.getInstance().getOutputDir() : null;
    const researchDir = stateHash && outputDir ? join(outputDir, 'research') : null;
    const researchFile = stateHash && researchDir ? join(researchDir, `${stateHash}.md`) : null;

    if (!force && stateHash) {
      const cached = Researcher.getCachedResearch({ hash: stateHash } as WebPageState);
      if (cached) {
        debugLog('Previous research result found');
        return cached;
      }
    }

    Stats.researches++;

    const sessionName = `researcher: ${state.url}`;
    return Observability.run(sessionName, { tags: ['researcher'], sessionId: stateHash }, async () => {
      tag('info').log(`Researching ${state.url} to understand the context...`);
      setActivity(`${this.emoji} Researching...`, 'action');

      const isOnCurrentState = this.actionResult!.getStateHash() === this.stateManager.getCurrentState()?.hash;
      await this.ensureNavigated(state.url, screenshot && this.provider.hasVision());
      await this.hooksRunner.runBeforeHook('researcher', state.url);

      if (isErrorPage(this.actionResult!)) {
        tag('warn').log(`Detected error page at ${state.url}`);
        return dedent`
          ## Error Page Detected

          URL: ${state.url}
          Title: ${this.actionResult!.title || 'N/A'}

          Research skipped. Navigate to a valid page to continue.
        `;
      }

      debugLog('Researching web page:', this.actionResult!.url);

      this.hasScreenshotToAnalyze = screenshot && this.provider.hasVision() && isOnCurrentState;

      const conversation = this.provider.startConversation(this.getSystemMessage(), 'researcher');

      const prompt = await this.buildResearchPrompt();
      conversation.addUserText(prompt);

      const result = await this.provider.invokeConversation(conversation);
      if (!result) throw new Error('Failed to get response from provider');

      let researchText = result.response.text;

      debugLog(`Original research response length: ${researchText.length} chars`);

      let locators = this.getLocators(researchText);
      debugLog(`Extracted ${locators.length} locators from research`);

      if (locators.length === 0) {
        tag('substep').log('No locators parsed from response, re-prompting for correct format...');
        conversation.addUserText(dedent`
          Your response could not be parsed. Each section MUST be a separate ## heading with its own table:

          ## Section Name

          Description.

          > Container: '.css-selector'

          | Element | ARIA | CSS | XPath |
          |---------|------|-----|-------|
          | 'Element Name' | { role: 'button', text: 'Click' } | '.btn' | '//button' |

          Please restructure your response following this format.
        `);
        const retryResult = await this.provider.invokeConversation(conversation);
        if (retryResult?.response?.text) {
          researchText = retryResult.response.text;
          locators = this.getLocators(researchText);
          debugLog(`Re-prompt extracted ${locators.length} locators`);
        }
      }

      const brokenContainers = await this.testContainers(locators);
      if (brokenContainers.length > 0) {
        for (const loc of locators) {
          if (loc.container && brokenContainers.includes(loc.container)) {
            loc.container = null;
          }
        }
      }

      if (this.hasScreenshotToAnalyze) {
        this.actionResult = await this.explorer.createAction().caputrePageWithScreenshot();
        const screenshotAnalysis = await this.analyzeScreenshotForUIElements();
        if (screenshotAnalysis) {
          this.addScreenshotPrompt(conversation, screenshotAnalysis);
          const screenshotResult = await this.provider.invokeConversation(conversation);
          if (screenshotResult?.response?.text) {
            researchText = screenshotResult.response.text;
            locators = this.getLocators(researchText);
          }
        }
      }

      await this.testLocators(locators);

      const brokenRatio = locators.length > 0 ? locators.filter((l) => l.valid === false).length / locators.length : 0;
      if (brokenRatio > 0.8 && retriesLeft > 0) {
        tag('warn').log(`${Math.round(brokenRatio * 100)}% locators broken, waiting 3s and retrying research (${maxRetries - retriesLeft + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, 3000));
        return this.research(state, { ...opts, force: true, _retriesLeft: retriesLeft - 1 } as any);
      }

      researchText = this.cleanBrokenLocators(researchText, locators);

      const needsFix = locators.some((l) => l.valid === false);
      if (fix && needsFix) {
        researchText = await this.fixBrokenLocators(researchText, locators, { brokenContainers });
        const reLocators = this.getLocators(researchText);
        await this.testLocators(reLocators);
        researchText = this.cleanBrokenLocators(researchText, reLocators);
      }

      if (deep) {
        researchText += await this.performDeepAnalysis(state, researchText);
      }

      if (data) {
        const extractedData = await this.extractData(state);
        researchText += `\n\n## Data\n\n${extractedData}`;
      }

      if (stateHash && researchDir && researchFile) {
        if (!existsSync(researchDir)) mkdirSync(researchDir, { recursive: true });
        writeFileSync(researchFile, researchText);
        Researcher.researchCache[stateHash] = researchText;
        Researcher.researchCacheTimestamps[stateHash] = Date.now();
      }

      const summary = this.extractSummary(researchText);
      if (summary) {
        this.experienceTracker.updateSummary(this.actionResult!, summary);
      }

      tag('multiline').log(researchText);
      tag('success').log(`Research complete! ${researchText.length} characters`);
      tag('substep').log(`Research file saved to: ${researchFile}`);

      await this.hooksRunner.runAfterHook('researcher', state.url);
      return researchText;
    });
  }

  getLocators(researchText: string): Locator[] {
    const sections = parseResearchSections(researchText);
    const locators: Locator[] = [];
    for (const section of sections) {
      for (const el of section.elements) {
        if (el.css) locators.push({ section: section.name, container: section.containerCss, element: el.name, type: 'css', locator: el.css, valid: null });
        if (el.xpath) locators.push({ section: section.name, container: section.containerCss, element: el.name, type: 'xpath', locator: el.xpath, valid: null });
        if (el.aria && /\w/.test(el.aria.text)) locators.push({ section: section.name, container: section.containerCss, element: el.name, type: 'aria', locator: `{ role: '${el.aria.role}', text: '${el.aria.text}' }`, valid: null });
      }
    }
    return locators;
  }

  async testContainers(locators: Locator[]): Promise<string[]> {
    const containers = [...new Set(locators.map((l) => l.container).filter(Boolean))] as string[];
    if (containers.length === 0) return [];

    const broken: string[] = [];
    for (const container of containers) {
      const valid = await this.explorer.hasPlaywrightLocator((page) => page.locator(container), { contents: true });
      if (!valid) {
        debugLog(`BROKEN container: "${container}"`);
        broken.push(container);
      }
    }

    if (broken.length > 0) {
      tag('substep').log(`Containers: ${containers.length - broken.length} valid, ${broken.length} broken`);
    }
    return broken;
  }

  async testLocators(locators: Locator[]): Promise<Locator[]> {
    const broken: Locator[] = [];

    for (const loc of locators) {
      loc.valid = await this.explorer.hasPlaywrightLocator((page) => {
        const base = loc.container ? page.locator(loc.container) : page;
        if (loc.type === 'aria') {
          const parsed = parseAriaLocator(loc.locator);
          if (!parsed) return page.locator('__invalid__');
          return base.getByRole(parsed.role as any, { name: parsed.text });
        }
        const converted = loc.locator.replace(/:contains\(/g, ':has-text(');
        if (converted !== loc.locator) {
          loc.locator = converted;
        }
        return base.locator(loc.locator);
      });
      if (!loc.valid) {
        debugLog(`BROKEN [${loc.section}] ${loc.type} "${loc.element}": ${loc.locator}`);
        broken.push(loc);
      }
    }

    tag('substep').log(`Validated ${locators.length} locators: ${locators.length - broken.length} valid, ${broken.length} broken`);
    return broken;
  }

  private cleanBrokenLocators(researchText: string, locators: Locator[]): string {
    const byElement = new Map<string, Locator[]>();
    for (const loc of locators) {
      const key = `${loc.section}::${loc.element}`;
      const group = byElement.get(key) || [];
      group.push(loc);
      byElement.set(key, group);
    }

    const sectionsToUpdate = new Set<string>();
    for (const group of byElement.values()) {
      if (!group.some((l) => l.valid === false)) continue;
      if (!group.some((l) => l.valid === true)) continue;
      sectionsToUpdate.add(group[0].section);
      for (const loc of group) {
        if (loc.valid === false) loc.valid = null;
      }
    }

    let result = researchText;
    for (const section of sectionsToUpdate) {
      result = this.updateSection(
        result,
        section,
        locators.filter((l) => l.section === section)
      );
    }
    return result;
  }

  async fixBrokenLocators(researchText: string, locators: Locator[], opts: { brokenContainers?: string[] } = {}): Promise<string> {
    const { brokenContainers = [] } = opts;
    const broken = locators.filter((l) => l.valid === false);
    if (broken.length === 0) return researchText;

    const bySection = new Map<string, Locator[]>();
    for (const loc of broken) {
      const list = bySection.get(loc.section) || [];
      list.push(loc);
      bySection.set(loc.section, list);
    }

    let result = researchText;

    for (const [name, sectionBroken] of bySection) {
      const section = parseResearchSections(result).find((s) => s.name === name);
      const originalContainer = section?.containerCss;
      const containerBroken = !originalContainer || brokenContainers.includes(originalContainer);

      let sectionHtml = '';

      if (!containerBroken) {
        const hasContent = await this.explorer.hasPlaywrightLocator((page) => page.locator(originalContainer), {
          contents: true,
          success: async (loc) => {
            sectionHtml = await loc.innerHTML();
          },
        });
        if (!hasContent) {
          debugLog(`Container "${originalContainer}" for "${name}" has no content, treating as broken`);
        }
      }

      tag('substep').log(`Correcting ${containerBroken ? 'container + ' : ''}${sectionBroken.length} locators in "${name}"...`);

      const invalidList = sectionBroken.map((b) => `- ${b.element}: ${b.type} '${b.locator}'`).join('\n');
      const model = this.provider.getModelForAgent('researcher');

      const needsContainerFix = containerBroken || !sectionHtml;
      let containerInstruction: string;
      if (needsContainerFix) {
        sectionHtml = await this.actionResult!.combinedHtml();
        containerInstruction = dedent`
          Section: "${name}"
          IMPORTANT: The container CSS '${originalContainer || 'none'}' is INCORRECT — it does not match any element on the page.
          You MUST provide the correct container CSS that wraps this section.
          Include it as: > Container: '<correct_css>'
        `;
      } else {
        containerInstruction = `Section: "${name}" (Container: \`${originalContainer}\`)`;
      }

      const prompt = dedent`
        You are fixing broken CSS/XPath locators in a UI map.

        ${containerInstruction}

        These elements have invalid locators:
        ${invalidList}

        <section_html>
        ${sectionHtml}
        </section_html>

        Fix ONLY the broken locators. Return a corrected markdown section with table.
        ${needsContainerFix ? '' : 'CSS selectors must be relative to the section container.'}
        XPath selectors must be absolute (start with //).

        ${generalLocatorRuleText}

        ${listElementRule}
      `;

      try {
        const aiResult = await this.provider.chat([{ role: 'user', content: prompt }], model, { telemetryFunctionId: 'researcher.fixBrokenLocators' });

        const correctedSections = parseResearchSections(`## ${name}\n\n${aiResult.text}`);
        if (correctedSections.length === 0 || correctedSections[0].elements.length === 0) continue;

        if (needsContainerFix && correctedSections[0].containerCss) {
          const newContainer = correctedSections[0].containerCss;
          debugLog(`Fixed container for "${name}": '${originalContainer}' → '${newContainer}'`);
          if (originalContainer) {
            const escaped = originalContainer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            result = result.replace(new RegExp(`^>\\s*Container:\\s*['"\`]?${escaped}['"\`]?`, 'm'), `> Container: '${newContainer}'`);
          }
        }

        const correctedByName = new Map(correctedSections[0].elements.map((el) => [el.name, el]));

        for (const loc of sectionBroken) {
          const fix = correctedByName.get(loc.element);
          if (!fix) continue;
          if (loc.type === 'css' && fix.css) {
            loc.locator = fix.css;
            loc.valid = null;
          }
          if (loc.type === 'xpath' && fix.xpath) {
            loc.locator = fix.xpath;
            loc.valid = null;
          }
          if (loc.type === 'aria' && fix.aria) {
            loc.locator = `{ role: '${fix.aria.role}', text: '${fix.aria.text}' }`;
            loc.valid = null;
          }
        }

        const allSectionLocators = locators.filter((l) => l.section === name);
        result = this.updateSection(result, name, allSectionLocators);
      } catch (err) {
        tag('substep').log(`AI correction failed for "${name}": ${err instanceof Error ? err.message : err}`);
      }
    }

    return result;
  }

  private updateSection(researchText: string, sectionName: string, locators: Locator[]): string {
    const sections = parseResearchSections(researchText);
    const section = sections.find((s) => s.name === sectionName);
    if (!section) return researchText;

    for (const el of section.elements) {
      const elLocators = locators.filter((l) => l.element === el.name);
      for (const loc of elLocators) {
        const value = loc.valid === false ? null : loc.locator || null;
        if (loc.type === 'css') el.css = value;
        if (loc.type === 'xpath') el.xpath = value;
        if (loc.type === 'aria') el.aria = value ? parseAriaLocator(value) : null;
      }
    }

    return this.rebuildSectionInText(researchText, section);
  }

  private rebuildSectionInText(text: string, section: ResearchSection): string {
    const newTable = rebuildSectionMarkdown(section);
    const tableRange = findTableLineRange(section.rawMarkdown);
    if (!tableRange) return text;

    const sectionStart = text.indexOf(section.rawMarkdown);
    if (sectionStart === -1) return text;

    const linesBeforeSection = text.slice(0, sectionStart).split('\n').length - 1;
    const tableStartLine = linesBeforeSection + tableRange.start;
    const tableEndLine = linesBeforeSection + tableRange.end;

    const lines = text.split('\n');
    const result = [...lines.slice(0, tableStartLine), ...newTable.trimEnd().split('\n'), ...lines.slice(tableEndLine)].join('\n');

    const sectionLines = section.rawMarkdown.split('\n');
    section.rawMarkdown = [...sectionLines.slice(0, tableRange.start), ...newTable.trimEnd().split('\n'), ...sectionLines.slice(tableRange.end)].join('\n');

    return result;
  }

  private async discoverExpandableElements(dataContainers: string[] = []): Promise<ExpandableElement[]> {
    const freshState = await this.explorer.createAction().capturePageState();
    const html = freshState.html;
    if (!html) return [];

    const exclusions = dataContainers.map((css) => cssToAncestorXPath(css)).filter(Boolean) as string[];
    const exclusionPredicate = exclusions.length > 0 ? `[not(ancestor::*[${exclusions.join(' or ')}])]` : '';

    const combined = EXPANDABLE_XPATHS.map((x) => `(${x}${exclusionPredicate})`).join(' | ');
    const result = await evaluateXPath(html, combined);
    if (result.error || result.matches.length === 0) return [];

    const elements: ExpandableElement[] = result.matches
      .filter((m) => m.tag !== 'a')
      .map((m) => ({
        xpath: m.absoluteXPath,
        clickXPath: buildClickableXPath(m),
        description: `<${m.tag} ${['role', 'id', 'class', 'aria-label']
          .map((k) => (m.allAttrs[k] ? `${k}="${m.allAttrs[k].slice(0, 40)}"` : ''))
          .filter(Boolean)
          .join(' ')}> text="${m.text.slice(0, 40)}"`,
      }));

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

  private async discoverExpandableByScreenshot(state: WebPageState, alreadyFound: string[]): Promise<string[]> {
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

      For each icon found, report on a separate line:
      <description> at <x>X, <y>Y
      where X and Y are integer pixel coordinates of the icon center.

      If no expandable icons found, respond with "none".
    `;

    try {
      const result = await this.provider.processImage(prompt, screenshot.toString('base64'));
      const text = result.text || '';
      if (text.toLowerCase().includes('none')) return [];

      const elements: string[] = [];
      const coordRegex = /(.+?)\s+at\s+(\d+)X,\s*(\d+)Y/gi;
      let match: RegExpExecArray | null;
      while ((match = coordRegex.exec(text)) !== null) {
        const desc = match[1].trim();
        const x = match[2];
        const y = match[3];
        elements.push(`[VISUAL] ${desc} at (${x}, ${y})  clickXY: I.clickXY(${x}, ${y})`);
      }
      return elements;
    } catch (err) {
      debugLog(`Screenshot expandable discovery failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }

  private async performDeepAnalysis(state: WebPageState, researchText: string): Promise<string> {
    debugLog('Starting deep analysis (3-stage)');
    const expandedSections: string[] = [];
    const navigationLinks: Array<{ code: string; url: string }> = [];

    const allSections = parseSections(researchText);
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

    const discoveredElements = await this.discoverExpandableElements(dataContainers);
    debugLog(`Stage 1: clicking ${discoveredElements.length} XPath-discovered elements`);
    await this.clickExpandableElements(
      discoveredElements.map((el) => ({ locator: el.clickXPath, fallbackLocator: el.xpath, description: el.description })),
      state,
      expandedSections,
      navigationLinks
    );

    debugLog(`Stage 2: asking AI for missed elements (sections so far: ${expandedSections.length})`);
    const aiElements = await this.discoverMissedElements(state, expandedSections);
    if (aiElements.length > 0) {
      debugLog(`Stage 2: clicking ${aiElements.length} AI-discovered elements`);
      await this.clickExpandableElements(aiElements, state, expandedSections, navigationLinks);
    }

    if (this.provider.hasVision()) {
      debugLog(`Stage 3: asking screenshot for missed icons (sections so far: ${expandedSections.length})`);
      const visualElements = await this.discoverExpandableByScreenshot(
        state,
        expandedSections.map((s) => s.slice(0, 100))
      );
      if (visualElements.length > 0) {
        debugLog(`Stage 3: clicking ${visualElements.length} visual elements`);
        await this.clickExpandableElements(
          visualElements.map((v) => {
            const coordMatch = v.match(/I\.clickXY\((\d+),\s*(\d+)\)/);
            return { locator: coordMatch ? `I.clickXY(${coordMatch[1]}, ${coordMatch[2]})` : v, description: v };
          }),
          state,
          expandedSections,
          navigationLinks
        );
      }
    }

    debugLog(`Deep analysis complete. Sections: ${expandedSections.length}, navigation links: ${navigationLinks.length}`);

    let result = '';
    if (expandedSections.length > 0) {
      result += `\n\n# Extended Research\n\n${expandedSections.join('\n\n---\n\n')}`;
    }
    if (navigationLinks.length > 0) {
      const links = navigationLinks.map((l) => `- \`${l.code}\` opens ${l.url}`).join('\n');
      result += `\n\n## Navigation Links\n\n${links}`;
    }
    return result;
  }

  private async clickExpandableElements(elements: Array<{ locator: string; fallbackLocator?: string; description: string }>, state: WebPageState, expandedSections: string[], navigationLinks: Array<{ code: string; url: string }>): Promise<void> {
    for (const el of elements) {
      debugLog(`Clicking: ${el.description.slice(0, 100)}`);
      const previousState = ActionResult.fromState(this.stateManager.getCurrentState()!);

      const escaped = el.locator.replace(/'/g, "\\'");
      const isCodeceptCmd = el.locator.startsWith('I.');
      const clickSucceeded = await this.tryClickStrategies(isCodeceptCmd ? el.locator : escaped, el.fallbackLocator, isCodeceptCmd);
      if (!clickSucceeded) {
        debugLog(`Click failed: ${el.description.slice(0, 80)}`);
        continue;
      }

      await new Promise((r) => setTimeout(r, 500));
      await this.explorer.createAction().capturePageState();
      const currentState = this.stateManager.getCurrentState()!;
      const currAR = ActionResult.fromState(currentState);
      const toolResult = await currAR.toToolResult(previousState, el.description);
      const pageDiff = toolResult.pageDiff;

      const clickCode = isCodeceptCmd ? el.locator : `I.click('${escaped}')`;

      if (pageDiff?.urlChanged) {
        debugLog(`Click navigated to ${pageDiff.currentUrl}`);
        navigationLinks.push({ code: clickCode, url: pageDiff.currentUrl });
        await this.navigateTo(state.url);
        continue;
      }

      if (!pageDiff?.ariaChanges && !pageDiff?.htmlChanges) {
        debugLog(`No changes from: ${el.description.slice(0, 80)}`);
        try {
          await this.explorer.createAction().execute("I.pressKey('Escape')");
          await this.explorer.createAction().execute("I.click('//body')");
        } catch {
          /* dismiss attempt */
        }
        continue;
      }

      const sectionMarkdown = await this.analyzeExpandedClick({
        code: clickCode,
        explanation: el.description,
        ariaChanges: pageDiff.ariaChanges || '',
        htmlChanges: pageDiff.htmlChanges || '',
      });
      if (sectionMarkdown) {
        expandedSections.push(sectionMarkdown);
        debugLog(`Captured section from: ${el.description.slice(0, 80)}`);
      }

      await this.cancelInUi();
    }
  }

  private async tryClickStrategies(locator: string, fallbackLocator?: string, isCodeceptCmd?: boolean): Promise<boolean> {
    const tryClick = async (code: string): Promise<{ ok: boolean; error?: string }> => {
      const action = this.explorer.createAction();
      try {
        await action.execute(code);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };

    if (isCodeceptCmd) return (await tryClick(locator)).ok;

    const locators = [locator, ...(fallbackLocator ? [fallbackLocator.replace(/'/g, "\\'")] : [])];
    for (const loc of locators) {
      const result = await tryClick(`I.click('${loc}')`);
      if (result.ok) return true;
      if (!result.error?.includes('interactable')) continue;
      debugLog(`Element not interactable, using forceClick: ${loc.slice(0, 60)}`);
      const force = await tryClick(`I.forceClick('${loc}')`);
      if (!force.ok) continue;
      await new Promise((r) => setTimeout(r, 100));
      return true;
    }
    return false;
  }

  private async discoverMissedElements(state: WebPageState, alreadySections: string[]): Promise<Array<{ locator: string; description: string }>> {
    const ariaSnapshot = state.ariaSnapshot || '';
    const alreadyList = alreadySections.length > 0 ? alreadySections.map((s) => s.split('\n')[0]).join('\n') : 'none';

    const prompt = dedent`
      Analyze this ARIA tree and find expandable elements we may have missed.
      We already expanded these sections:
      ${alreadyList}

      <page_aria>
      ${ariaSnapshot}
      </page_aria>

      Find elements that could reveal hidden UI (dropdowns, modals, popups, accordions, tabs).
      Look for:
      - Buttons with aria-haspopup or aria-expanded="false"
      - Icon-only buttons (no text label)
      - Ellipsis/more/dots buttons
      - Chevron/arrow elements indicating expandable sections
      - Tab elements that load different content

      For each element, respond with ONE line:
      <ARIA locator as JSON> | <short description>

      Example:
      {"role":"button","text":"More options"} | ellipsis menu in toolbar
      {"role":"button","text":""} | unnamed button near search

      If nothing missed, respond with "none".
    `;

    const model = this.provider.getModelForAgent('researcher');
    const result = await this.provider.chat([{ role: 'user', content: prompt }], model, { telemetryFunctionId: 'researcher.discoverMissed' });
    const text = result.text || '';
    if (text.toLowerCase().includes('none')) return [];

    const elements: Array<{ locator: string; description: string }> = [];
    for (const line of text.split('\n')) {
      const match = line.match(/(\{[^}]+\})\s*\|\s*(.+)/);
      if (!match) continue;
      const ariaLocator = match[1].trim();
      const textMatch = ariaLocator.match(/"text"\s*:\s*"([^"]*)"/);
      if (textMatch && !/\w/.test(textMatch[1])) continue;
      const description = match[2].trim();
      elements.push({ locator: `I.click('${ariaLocator}')`, description });
    }
    return elements;
  }

  private async analyzeExpandedClick(diff: { code: string; explanation: string; ariaChanges: string; htmlChanges: string }): Promise<string | null> {
    const prompt = dedent`
      A click on "${diff.explanation}" (\`${diff.code}\`) revealed new UI content.
      Analyze the changes and produce a UI map section.

      ARIA changes:
      ${diff.ariaChanges || 'none'}

      HTML changes:
      ${diff.htmlChanges || 'none'}

      Respond with a SINGLE section in this format:

      ### <Short descriptive name>

      Action:

      \`\`\`js
      ${diff.code}
      \`\`\`

      > Container: \`<css-selector>\`

      <One sentence about what appeared>

      | Element | ARIA | CSS | XPath |
      |---------|------|-----|-------|
      | 'Name' | { role: 'x', text: 'y' } | - | - |

      Rules:
      - Container CSS must NOT use dynamic IDs (ember*, react*, data-id)
      - Use ARIA locators for elements inside the container
      - Set CSS and XPath to \`-\` for elements inside expandable containers
      - If changes are minor (no new interactive elements), respond with "No meaningful expansion."
      - If the revealed content is purely data items (list of records, entries, rows) with no new UI controls, respond with "No meaningful expansion."
    `;

    const model = this.provider.getModelForAgent('researcher');
    const result = await this.provider.chat([{ role: 'user', content: prompt }], model, { telemetryFunctionId: 'researcher.analyzeExpandedClick' });
    const text = result.text || '';

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

  private async ensureNavigated(url: string, screenshot?: boolean): Promise<void> {
    if (!this.actionResult) {
      debugLog('No action result, navigating to URL');
      await this.explorer.visit(url);
      this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot: screenshot });
      return;
    }

    const isOnCurrentState = this.actionResult.getStateHash() === this.stateManager.getCurrentState()?.hash;
    const stateHtml = await this.actionResult.combinedHtml();
    const isEmpty = isBodyEmpty(stateHtml);

    if (!isEmpty && isOnCurrentState) {
      if ((!this.actionResult.screenshot && screenshot) || !this.actionResult.ariaSnapshot) {
        this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot: screenshot });
      }
      return;
    }

    if (isEmpty) {
      debugLog('HTML body is empty, refreshing page');
      tag('step').log('Page body is empty, refreshing...');
    } else {
      debugLog('Not on current state, navigating to URL');
      tag('step').log('Navigating to URL...');
    }

    await this.explorer.visit(url);
    this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot: screenshot ?? false });
  }

  private buildResearchTaskPrompt(): string {
    return dedent`
      <task>
      Examine the provided page and explain its main purpose from the user perspective.
      Identify the main user actions of this page.
      Break down the page by sections and identify structural patterns.
      Provide a comprehensive UI map report in markdown format.
      </task>

      <rules>
      - Explain what the user can achieve on this page.
      - Focus on primary user actions and interactive elements only.
      - Research all menus and navigational areas.
      - Ignore purely decorative sidebars, footer-only links, and external links.
      - Detect layout patterns: list/detail split, 2-pane, or 3-pane layouts.
      - If multiple elements match, pick the element inside the most relevant section and closest to recent UI context.
      - UI map table must include ARIA, CSS, and XPath for every element.
      - ARIA locator must be JSON with role and text keys (NOT "name").
      </rules>

      ${generalLocatorRuleText}

      ${uiMapTableFormat}

      ${listElementRule}

      <section_identification>
      Identify page sections in this priority order:
      ${Object.entries(POSSIBLE_SECTIONS)
        .map(([name, description]) => `* ${name}: ${description}`)
        .join('\n')}

      - Sections can overlap, prefer more detailed sections over broader ones.
      - If a proposed section is not relevant or not detected, do not include it.
      - Each section must have a container CSS locator.
      - UI map CSS and XPath locators must be relative to the section container.
      </section_identification>

      <section_format>
      ## Section Name

      Explanation of this section and its purpose.

      > Container: '.container-css-selector'

      | Element | ARIA | CSS | XPath |
      </section_format>
      <section_example>
      ## Focus Section

      Login modal dialog that appears as an overlay when user clicks the login button.

      > Container: '[role="dialog"]'

      | Element | ARIA | CSS | XPath |
      | 'Email' | { role: 'textbox', text: 'Email' } | 'input[name="email"]' | '//input[@name="email"]' |
      | 'Password' | { role: 'textbox', text: 'Password' } | 'input[name="password"]' | '//input[@name="password"]' |
      | 'Sign In' | { role: 'button', text: 'Sign In' } | 'button[type="submit"]' | '//button[@type="submit"]' |
      | 'Cancel' | { role: 'button', text: 'Cancel' } | 'button.cancel-btn' | '//button[contains(@class,"cancel-btn")]' |
      | 'Close' | { role: 'button', text: 'Close' } | '.close-btn' | '//button[@aria-label="Close"]' |
      </section_example>

      <css_selector_rules>
      CSS/XPath selectors MUST point to the actual interactive element (input, button, a, select), NOT to container divs.
      - If a submit button is inside a wrapper div, target the input/button directly
      - Bad: '#submit-wrapper' (div container)
      - Good: '#submit-wrapper input[type="submit"]' or 'input[type="submit"][value="Submit"]'
      - For buttons with similar text, include distinguishing attributes like type, value, or form context
      </css_selector_rules>
    `;
  }

  private async buildResearchPrompt(): Promise<string> {
    if (!this.actionResult) throw new Error('actionResult is not set');

    const html = await this.actionResult.combinedHtml();
    const knowledgeFiles = this.stateManager.getRelevantKnowledge();

    let knowledge = '';
    if (knowledgeFiles.length > 0) {
      const knowledgeContent = knowledgeFiles
        .map((k) => k.content)
        .filter((k) => !!k)
        .join('\n\n');

      tag('substep').log(`Found ${knowledgeFiles.length} relevant knowledge ${pluralize(knowledgeFiles.length, 'file')} for: ${this.actionResult.url}`);
      knowledge = `
        <hint>
        Here is relevant knowledge for this page:

        ${knowledgeContent}
        </hint>`;
    }

    const ariaSnapshot = this.actionResult.ariaSnapshot || '';

    return dedent`
      Analyze this web page and provide a comprehensive research report in markdown format.

      <error_detection>
      IMPORTANT: First check if this looks like an error page (404, 500, access denied,
      not found, server error, forbidden, or similar). If so, respond ONLY with:

      ## Error Page Detected
      Type: [error type]
      Reason: [what indicates this is an error page]

      Then stop - do not provide normal research output for error pages.
      </error_detection>

      ${this.buildResearchTaskPrompt()}

      URL: ${this.actionResult.url || 'Unknown'}
      Title: ${this.actionResult.title || 'Unknown'}

      <context>
      HTML Content:
      ${html}

      ${ariaSnapshot ? `ARIA Tree:\n${ariaSnapshot}` : ''}
      </context>

      ${knowledge}

      <output>

      <output_rules>
      - Please provide a structured analysis in markdown format divided by sections
      - Use tables for section UI maps only.
      - List sections by provided priorities: ${Object.keys(POSSIBLE_SECTIONS).join(', ')}
      - If a section is not present, do not include it in the output.
      - Include coordinates when available from screenshot analysis. Use "-" when not available.
      - If some sections are not present, do not include them in the output.
      - Proposed sections must be relevant to the page.
      - List all interactive elements on page and put them into appropriate sections.
      - Group similar interactive elements (like dynamic lists or content) into one item
      - At minimum include Main section if no other sections are clear.
      - For pane sections, explain the relationship between panes.
      - Each section must include only its relevant UI elements.   
      - Follow <section_format> and provided <section_example> when describing sections.
      - When a section contains a list of similar data items (records, entities, rows — content that varies by data, not by app UI), output it as a Data section with NO table.
      - Data section heading MUST be a level-2 heading (##) that starts exactly with "Data:" — for example: "## Data: Suites List". Do NOT use ### or add section numbers.
      - Data sections must NOT include a UI map table. Only include the container and a brief summary line.
      - Example data section:

      ## Data: Suites List

      > Container: \`.suites-list-content\`

      Suite items, 13 items. List of test suites with expand/collapse buttons.
      </output_rules>


    `;
  }

  async textContent(state: WebPageState): Promise<string> {
    const actionResult = ActionResult.fromState(state);
    const html = await actionResult.combinedHtml();

    const prompt = dedent`
      Transform into markdown. 
      Identify headers, footers, asides, special application parts and main contant.
      Content should be in markdown format. If it is content: tables must be tables, lists must be lists. 
      Navigation elements should be represented as standalone blocks after the content.
      Do not summarize content, just transform it into markdown.
      It is important to list all the content text
      If it is link it must be linked
      You can summarize footers/navigation/aside elements. 
      But main conteint should be kept as text and formatted as markdown based on its current markup.
      Links to external web sites should be avoided in output.

      Break down into sections:

      ## Content Area

      ## Navigation Area

      <page_html>
      ${html}
      </page_html>
    `;

    const model = this.provider.getModelForAgent('researcher');
    const result = await this.provider.chat([{ role: 'user', content: prompt }], model, { telemetryFunctionId: 'researcher.textContent' });

    return result.text;
  }

  private getScreenshotFromState(state: WebPageState): { actionResult: ActionResult; image: Buffer } | null {
    const actionResult = ActionResult.fromState(state);
    const image = actionResult.screenshot;
    if (!image) {
      debugLog('No screenshot found', actionResult);
      return null;
    }
    return { actionResult, image };
  }

  async analyzeScreenshotForUIElements(): Promise<string | null> {
    if (!this.actionResult) return null;
    const screenshotData = this.getScreenshotFromState(this.actionResult);
    if (!screenshotData) return null;

    const { actionResult, image } = screenshotData;
    tag('step').log('Analyzing page screenshot for UI elements');

    const prompt = dedent`
        <role>
        You are UI/UX designer analyzing all UI elements on the webpage
        </role>
        Analyze this web page and provide a comprehensive research report in markdown format.

        <task>
        Examine the provided page and understand its main purpose from the user perspective.

        Then proceed with:
        - Identify the main user actions of this page.
        - Identify the main content of the page.
        - Identify the main navigation of the page.
        - Provide a comprehensive UI map report in markdown format.
        - List all buttons, forms, inputs, accordions, dropdowns, tabs, etc.
        - Write coordinates of all listed elements
        </task>

        <rules>
        - Analyze the web page and provide a comprehensive UI map report.
        - Explain the main purpose of the page and what user can achieve from this page.
        - Focus on primary user actions of this page
        - Provide Container, ARIA, CSS, XPath, and Coordinates locators.
        - Research all menus and navigational areas;
        - Focus on interactive elements: forms, buttons, links, clickable elements, etc.
        - Pay especial attention for clickable icons (hamburgers, ellipsis, toggles, arrows, etc.) and images that are clickable.
        - Describe clickable icons in text format for easy recognition. Explain in short what that symbol might do in web UI context.
        - There is no such thing as 'hamburger menu' or 'ellipsis menu' explain what kind of menu it is (main nav, items context menu).
        - Structure the report by sections.
        - Focus on UI elements, not on static content.
        - Ignore purely decorative sidebars and footer-only links.
        </rules>

        ${generalLocatorRuleText}

        URL: ${actionResult.url || 'Unknown'}
        Title: ${actionResult.title || 'Unknown'}

        <output>

        <output_rules>
        Please provide a structured analysis in markdown format.
        Use tables for section UI maps only.
        If a section is not present, do not include it in the output.

        Section order: Summary -> list/detail/panes/content/menu in priority order
        List all interactive elements on page and put them into appropriate sections.
        Group similar interactive elements (like dynamic lists or content) into one item.
        </output_rules>

        <element_format>
        ${screenshotUiMapRule}

        Example:
        | Element | ARIA | CSS | XPath | Coordinates | Color | Icon |
        | 'Sign In' | { role: 'button', text: 'Sign In' } | 'button.btn-signin' | '//button[@class="btn-signin"]' | (450, 320) | blue | - |
        | 'Delete' | { role: 'button', text: 'Delete' } | 'button.btn-delete' | '//button[@class="btn-delete"]' | (500, 320) | red | trash |
        | 'Email' | { role: 'textbox', text: 'Email' } | 'input#email' | '//input[@id="email"]' | (300, 200) | - | - |
        | 'Settings' | { role: 'link', text: 'Settings' } | 'a.settings-link' | '//a[@class="settings-link"]' | (850, 50) | - | gear |
        | 'Menu Toggle' | - | '.hamburger-btn' | '//button[contains(@class,"hamburger-btn")]' | (30, 25) | - | hamburger |

        Group elements by type (Buttons, Links, Inputs, etc.) within each section.
        CRITICAL: Include Coordinates and Icon for EVERY element in the table. Do NOT create separate sections for them.
        </element_format>

        <output_format>

        ## Summary

        Brief overview of the page purpose and main content.

        ## Section Name

        Explanation

        > Container: '.container-css-selector'

        | Element | ARIA | CSS | XPath | Coordinates | Color | Icon |
        | 'Element Name' | { role: 'button', text: '...' } | 'css' | '//button[@type="button"]' | (X, Y) | blue | - |
        | 'Dropdown' | { role: 'button', text: '...' } | 'button.dropdown' | '//button[@class="dropdown"]' | (X, Y) | - | down-chevron |

        </output_format>

        </output>

        The screenshot is provided below
        `;

    const result = await this.provider.processImage(prompt, image.toString('base64'));
    return result.text;
  }

  async checkElementLocation(state: WebPageState, elementDescription: string): Promise<string | null> {
    const screenshotData = this.getScreenshotFromState(state);
    if (!screenshotData) return null;

    const { actionResult, image } = screenshotData;
    tag('step').log('Checking element location on screenshot');
    const prompt = dedent`
        <role>
        You are a precise UI inspector focused on confirming a single interface element on a webpage screenshot.
        </role>

        <task>
        Focus ONLY on the element described as: "${elementDescription}".
        Determine whether it is present and usable. If you locate it, respond with a short sentence describing the element and include its coordinates in the format "<description> at <x>X, <y>Y" (numbers must be integers followed by X and Y respectively).
        If it is not visible or cannot be reached, explain that it was not found and provide a brief suggestion.
        Do not list other elements.
        </task>

        <rules>
        - Keep the answer under two sentences.
        - Mention if the element is obscured or disabled when applicable.
        - Always include coordinates only when the element is found.
        - Coordinates must follow the pattern "123X, 456Y" with X and Y suffixes.
        </rules>

        URL: ${actionResult.url || 'Unknown'}
        Title: ${actionResult.title || 'Unknown'}

        The screenshot is provided below.
        `;

    const result = await this.provider.processImage(prompt, image.toString('base64'));
    return result.text;
  }

  async answerQuestionAboutScreenshot(state: WebPageState, question: string): Promise<string | null> {
    const screenshotData = this.getScreenshotFromState(state);
    if (!screenshotData) return null;

    const { actionResult, image } = screenshotData;
    tag('step').log('Answering question about screenshot');
    const prompt = dedent`
        <role>
        You are a UI analyst examining a webpage screenshot to answer specific questions about its state or content.
        </role>

        <task>
        Answer the following question about the webpage screenshot: "${question}"

        Examine the screenshot carefully and provide a clear, concise answer based on what you observe.
        Be specific and factual in your response.
        If the question cannot be answered from the screenshot alone, explain what information is missing.
        </task>

        <rules>
        - Provide a direct answer to the question.
        - Be specific and reference visual elements when relevant.
        - If the answer requires checking form fields, buttons, or other UI elements, describe their state clearly.
        - Keep the response focused and under 5 sentences unless more detail is needed.
        </rules>

        URL: ${actionResult.url || 'Unknown'}
        Title: ${actionResult.title || 'Unknown'}

        The screenshot is provided below.
        `;

    const result = await this.provider.processImage(prompt, image.toString('base64'));
    return result.text;
  }

  async extractData(state: WebPageState): Promise<string> {
    const actionResult = ActionResult.fromState(state);
    tag('step').log('Extracting data from page');

    const html = await actionResult.combinedHtml();

    const prompt = dedent`
      <task>
      Extract all domain-specific content data items from this HTML page.
      Focus only on actual content entities that represent business data, not navigation or UI controls.
      </task>

      <rules>
      Include:
      - Articles, posts, products, items, entries, records, cards, listings
      - User profiles, accounts, entities
      - Documents, files, resources that can be accessed individually
      - Any data items that have their own detail pages
      - Content that represents actual domain entities (users, products, tasks, etc.)

      Exclude:
      - Navigation menus, breadcrumbs, pagination controls
      - Buttons, form inputs, search boxes, filters
      - Headers, footers, sidebars (unless they contain actual content items)
      - UI controls, toolbars, action buttons
      - Links that are purely navigational (home, about, contact, etc.)
      - Decorative elements, logos, icons without content
      - Empty placeholders or loading states

      Type requirements:
      - The type field must be explicit and specific to the domain
      - Use precise type names: "article", "comment", "product", "review", "order", etc.
      - Never use generic terms like "content", "item", "element", "entry", "data"
      - Infer the specific type from context, HTML structure, URL patterns, or semantic meaning
      - Each distinct domain entity type should have its own specific name
      </rules>

      <output_format>
      Return a markdown table with columns: type | title | link | meta

      - type: Explicit and specific category of the content item. Must be a precise type name, not generic terms.
        Examples: "article", "comment", "product", "user", "task", "document", "post", "review", "order", "project".
        DO NOT use generic types like "content", "item", "element", "entry" - always use the specific domain type.
        If unsure, infer the type from the context, URL structure, or surrounding elements.
      - title: Display name or heading of the item
      - link: URL or relative path to the item's detail page if available, otherwise "-"
      - meta: Additional metadata (author, date, status, etc.) as key-value pairs or "-"
      </output_format>

      <example>
      For a blog listing page with comments, extract:
      | type | title | link | meta |
      | article | "Getting Started with Testing" | "/articles/getting-started" | "author: John, date: 2024-01-15" |
      | article | "Advanced Patterns" | "/articles/advanced-patterns" | "author: Jane, date: 2024-01-20" |
      | comment | "Great tutorial!" | "/articles/getting-started#comment-1" | "author: Alice, date: 2024-01-16" |

      Correct types: "article", "comment", "product", "review", "user", "order"
      Incorrect types: "content", "item", "element", "entry", "data"

      Do NOT include navigation like:
      - "Home" link
      - "Next Page" button
      - Search input field
      - Category filter dropdown
      </example>

      URL: ${actionResult.url || 'Unknown'}
      Title: ${actionResult.title || 'Unknown'}

      HTML:
      ${html}
    `;

    const model = this.provider.getModelForAgent('researcher');
    const result = await this.provider.chat([{ role: 'user', content: prompt }], model, { telemetryFunctionId: 'researcher.extractData' });

    return result.text;
  }

  private extractSummary(researchText: string): string {
    const summaryMatch = researchText.match(/## Summary\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (!summaryMatch) return '';
    const summaryContent = summaryMatch[1].trim();
    const firstLine = summaryContent.split('\n')[0].trim();
    return firstLine.slice(0, 200);
  }

  async summary(state: WebPageState, opts: { allowNewResearch?: boolean } = {}): Promise<string> {
    const { allowNewResearch = false } = opts;
    let researchText = Researcher.getCachedResearch(state);
    if (!researchText && allowNewResearch) {
      researchText = await this.research(state);
    }
    if (!researchText) return '';
    return this.extractBrief(researchText);
  }

  private extractBrief(researchText: string): string {
    return mdq(researchText)
      .query('section2')
      .each()
      .map((s) => {
        const heading = s.query('h2').text().trim();
        const paragraph = s.query('paragraph[0]').text().trim();
        if (!paragraph) return heading;
        return `${heading}\n${paragraph}`;
      })
      .filter(Boolean)
      .join('\n\n');
  }

  private async navigateTo(url: string): Promise<void> {
    const action = this.explorer.createAction();
    await action.execute(`I.amOnPage("${url}")`);
  }

  private async cancelInUi() {
    const beforeAria = this.stateManager.getCurrentState()?.ariaSnapshot || null;
    const action = this.explorer.createAction();

    await action.execute(`I.click('//body')`);
    if (diffAriaSnapshots(beforeAria, this.stateManager.getCurrentState()?.ariaSnapshot || null)) return;

    await action.execute(`I.pressKey('Escape')`);
    if (diffAriaSnapshots(beforeAria, this.stateManager.getCurrentState()?.ariaSnapshot || null)) return;

    const url = this.stateManager.getCurrentState()?.url;
    if (url) {
      await action.execute(`I.amOnPage("${url.split('?')[0]}")`);
    }
  }

  private addScreenshotPrompt(conversation: Conversation, screenshotAnalysis: string): void {
    conversation.addUserText(dedent`
      <screenshot_analysis>
      ${screenshotAnalysis}
      </screenshot_analysis>

      IMPORTANT: Merge screenshot analysis INTO your UI map tables:
      1. ADD Coordinates, Color, and Icon columns to ALL UI map tables
      2. For each element, include coordinates (X, Y) from screenshot analysis
      3. For each element, include accent color if it has a distinctive color (red, green, blue, etc.)
      4. For each element, include one-word icon description if the element has a visual icon (down-chevron, plus, hamburger, ellipsis, gear, trash, etc.)
      5. Use "-" for elements not visible in screenshot, without distinctive color, or without icon
      6. DO NOT create separate Coordinates, Color, or Icon sections - they must be IN the tables

      Final table format must be:
      | Element | ARIA | CSS | XPath | Coordinates | Color | Icon |

      Also incorporate any visual elements not captured in HTML (icons, images, visual indicators).
    `);
  }
}

interface ExpandableElement {
  xpath: string;
  clickXPath: string;
  description: string;
}
