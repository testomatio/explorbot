import { join } from 'node:path';
import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import { setActivity } from '../activity.ts';
import { ConfigParser, outputPath } from '../config.ts';
import { executionController } from '../execution-controller.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.ts';
import { Observability } from '../observability.ts';
import type { StateManager } from '../state-manager.js';
import { WebPageState } from '../state-manager.js';
import { Stats } from '../stats.ts';
import { diffAriaSnapshots } from '../utils/aria.ts';
import { ErrorPageError, detectPageCondition } from '../utils/error-page.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { isBodyEmpty } from '../utils/html.ts';
import { createDebug, pluralize, tag } from '../utils/logger.js';
import { mdq } from '../utils/markdown-query.ts';
import { RulesLoader } from '../utils/rules-loader.ts';
import type { Agent } from './agent.js';
import type { Navigator } from './navigator.ts';
import { ContextLengthError, type Provider } from './provider.js';
import { findSimilarResearch, getCachedResearch, saveResearch } from './researcher/cache.ts';
import { type CoordinateMethods, WithCoordinates } from './researcher/coordinates.ts';
import { type DeepAnalysisMethods, WithDeepAnalysis } from './researcher/deep-analysis.ts';
import { detectFocusedSection, hasFocusedSection, markSectionAsFocused, pickDefaultFocusedSection } from './researcher/focus.ts';
import { type LocatorMethods, WithLocators } from './researcher/locators.ts';
import { extractValidContainers, formatResearchSummary, parseResearchSections } from './researcher/parser.ts';
import { ResearchResult } from './researcher/research-result.ts';
import { type SectionMethods, WithSections } from './researcher/sections.ts';
import { locatorRule as generalLocatorRuleText } from './rules.js';
import { TaskAgent } from './task-agent.ts';

export type { Locator } from './researcher/locators.ts';

const debugLog = createDebug('explorbot:researcher');

export const POSSIBLE_SECTIONS = {
  overlay: 'dialog, modal, drawer, popup, or active form overlay',
  list: 'list area (items collection, table, cards, or list view)',
  detail: 'detail area (selected item preview or full details)',
  panes: 'screen is split into equal panes, describe each pane',
  content: 'main area of page',
  menu: 'page menu (toolbar, context actions, filters, dropdowns)',
  navigation: 'main navigation (top bar, sidebar, breadcrumbs)',
};

const ResearcherBase = WithSections(WithDeepAnalysis(WithCoordinates(WithLocators(TaskAgent as unknown as new (...args: any[]) => TaskAgent))));

export interface Researcher extends LocatorMethods, CoordinateMethods, DeepAnalysisMethods, SectionMethods {}

export class Researcher extends ResearcherBase implements Agent {
  protected readonly ACTION_TOOLS = ['click'];
  emoji = '🔍';
  declare explorer: Explorer;
  declare provider: Provider;
  declare stateManager: StateManager;
  private experienceTracker!: ExperienceTracker;
  private hasScreenshotToAnalyze = false;
  declare actionResult: ActionResult | undefined;
  private hooksRunner!: HooksRunner;

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
    return getCachedResearch(state.hash || '');
  }

  getSystemMessage(): string {
    const currentUrl = this.stateManager.getCurrentState()?.url;
    const customPrompt = this.provider.getSystemPromptForAgent('researcher', currentUrl);
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
    let retriesLeft = opts._retriesLeft ?? maxRetries;
    this.actionResult = ActionResult.fromState(state);
    const stateHash = state.hash || this.actionResult.getStateHash();

    if (!force && stateHash) {
      const cached = getCachedResearch(stateHash);
      if (cached) {
        debugLog('Previous research result found');
        return `!! UI MAP IS CACHED AND MAY NOT REPRESENT CURRENT STATE; REFRESH RESEARCH IF YOU NOTICE ISSUES !!\n\n${cached}`;
      }
    }

    Stats.researches++;

    const sessionName = `researcher: ${state.url}`;
    return Observability.run(sessionName, { tags: ['researcher'], sessionId: stateHash }, async () => {
      setActivity(`${this.emoji} Researching...`, 'action');

      await this.ensureNavigated(state.url, screenshot && this.provider.hasVision());
      await this.hooksRunner.runBeforeHook('researcher', state.url);

      const annotatedElements = await this.explorer.annotateElements();
      debugLog(`Annotated ${annotatedElements.length} interactive elements with eidx`);
      this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot: screenshot && this.provider.hasVision() });

      const condition = detectPageCondition(this.actionResult!);
      if (condition === 'error') {
        tag('warning').log(`Detected error page at ${state.url}`);
        throw new ErrorPageError(state.url, this.actionResult!.title);
      }
      if (condition === 'loading') {
        const settled = await this.waitUntilSettled(screenshot);
        if (!settled) {
          tag('warning').log(`Page at ${state.url} did not finish loading within timeout, continuing with best-effort research`);
        }
      }

      debugLog('Researching web page:', this.actionResult!.url);

      const combinedHtml = await this.actionResult!.combinedHtml();

      if (!deep && !force) {
        const similar = await findSimilarResearch(combinedHtml);
        if (similar) {
          tag('substep').log('Similar research found, reusing cached result');
          if (stateHash) saveResearch(stateHash, similar, combinedHtml);
          tag('multiline').log(formatResearchSummary(similar));
          tag('success').log('Research complete (reused)');
          await this.hooksRunner.runAfterHook('researcher', state.url);
          return similar;
        }
      }

      const isOnCurrentState = this.actionResult!.getStateHash() === this.stateManager.getCurrentState()?.hash;
      this.hasScreenshotToAnalyze = screenshot && this.provider.hasVision() && isOnCurrentState;

      const conversation = this.provider.startConversation(this.getSystemMessage(), 'researcher');

      const prompt = await this.buildResearchPrompt();
      conversation.addUserText(prompt);

      let researchText: string;
      let activeConversation = conversation;
      try {
        const invocationResult = await this.provider.invokeConversation(conversation, undefined, { agentName: 'researcher' });
        if (!invocationResult) throw new Error('Failed to get response from provider');
        researchText = invocationResult.response.text;
      } catch (error) {
        if (!(error instanceof ContextLengthError) || retriesLeft <= 0) {
          if (error instanceof ContextLengthError) {
            tag('warning').log('Output truncated. Try lowering reasoning effort or increasing maxTokens in ai.config.');
          }
          throw error;
        }
        retriesLeft = 0;
        researchText = await this.researchBySections();
        activeConversation = this.provider.startConversation(this.getSystemMessage(), 'researcher');
      }

      const result = new ResearchResult(researchText, state.url);
      debugLog(`Original research response length: ${result.text.length} chars`);

      const interrupted = () => executionController.isInterrupted();

      // Stage 2: Test containers + locators
      result.parseLocators();
      debugLog(`Extracted ${result.locators.length} locators from research`);

      if (!interrupted() && result.locators.length === 0 && retriesLeft > 0) {
        tag('warning').log(`No locators parsed, retrying research (${maxRetries - retriesLeft + 1}/${maxRetries})...`);
        await new Promise((r) => setTimeout(r, 1000));
        return this.research(state, { ...opts, force: true, _retriesLeft: retriesLeft - 1 } as any);
      }

      if (!interrupted()) {
        const containerLocs = result.containerLocators;
        await this.testLocators(containerLocs);
        const brokenContainers = containerLocs.filter((l) => l.valid === false);
        if (containerLocs.length > 0 && brokenContainers.length === containerLocs.length && retriesLeft > 0) {
          tag('warning').log(`All ${containerLocs.length} containers broken, retrying research (${maxRetries - retriesLeft + 1}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, 2000));
          return this.research(state, { ...opts, force: true, _retriesLeft: retriesLeft - 1 } as any);
        }

        for (const loc of result.locators) {
          if (loc.container && brokenContainers.some((c) => c.locator === loc.container)) {
            loc.valid = false;
            loc.error = 'container broken';
          }
        }

        const toTest = result.locators.filter((l) => l.valid === null);
        await this.testLocators(toTest);

        const brokenCount = result.locators.filter((l) => l.valid === false).length;
        const brokenRatio = result.locators.length > 0 ? brokenCount / result.locators.length : 0;
        if (brokenRatio > 0.8 && retriesLeft > 0) {
          tag('warning').log(`${Math.round(brokenRatio * 100)}% locators broken, waiting 3s and retrying research (${maxRetries - retriesLeft + 1}/${maxRetries})...`);
          await new Promise((r) => setTimeout(r, 3000));
          return this.research(state, { ...opts, force: true, _retriesLeft: retriesLeft - 1 } as any);
        }
      }

      // Stage 3: Fix broken sections via AI conversation continuation
      if (!interrupted() && fix && result.locators.some((l) => l.valid === false)) {
        await this.fixBrokenSections(result, activeConversation);
      }

      // Focused section: unified Playwright probe (HTML+CSS+visibility).
      // Must run BEFORE visuallyAnnotateContainers — annotation overlays inject z-index 99998+ which would pollute the scoring.
      if (!interrupted() && this.hasScreenshotToAnalyze) {
        const sections = parseResearchSections(result.text);
        const focused = await detectFocusedSection(this.explorer.playwrightHelper.page, sections);
        if (focused) markSectionAsFocused(result, focused);
      }

      // Stage 4: Visual analysis
      if (!interrupted() && this.hasScreenshotToAnalyze) {
        const validContainers = extractValidContainers(result.text);
        result.parseLocators();
        const freshContainerLocs = result.containerLocators;
        await this.testLocators(freshContainerLocs);
        const freshBroken = freshContainerLocs.filter((l) => l.valid === false).map((l) => l.locator);
        const containers = validContainers.filter((c) => !freshBroken.includes(c.css));
        await this.visuallyAnnotateElements({ containers });
        this.actionResult = await this.explorer.createAction().caputrePageWithScreenshot();
        const visualResult = await this.analyzeScreenshotForVisualProps();
        if (visualResult.elements.size > 0) {
          await this.mergeVisualData(result, visualResult.elements);
          result.parseLocators();
        }
        if (visualResult.pagePurpose || visualResult.primaryActions?.length) {
          const lines: string[] = ['## Primary Actions', ''];
          if (visualResult.pagePurpose) lines.push(visualResult.pagePurpose, '');
          if (visualResult.primaryActions?.length) lines.push(...visualResult.primaryActions);
          result.text = `${lines.join('\n')}\n\n${result.text}`;
        }

        // Focused section: visual fallback
        if (!hasFocusedSection(result.text) && visualResult.focusedSection) {
          markSectionAsFocused(result, visualResult.focusedSection);
        }
      }

      // Stage 5: Backfill broken elements
      if (!interrupted()) {
        await this.backfillCoordinates(result);
        await this.backfillBrokenLocators(result);
      }

      // Focused section: final fallback (vision-only — without a screenshot we don't infer focus)
      if (this.hasScreenshotToAnalyze && !hasFocusedSection(result.text)) {
        const sections = parseResearchSections(result.text);
        const fallback = pickDefaultFocusedSection(sections);
        if (fallback) markSectionAsFocused(result, fallback);
      }

      if (!interrupted() && deep) {
        await this.performDeepAnalysis(state, result);
      }

      if (!interrupted() && data) {
        const extractedData = await this.extractData(state);
        result.text += `\n\n## Data\n\n${extractedData}`;
      }

      if (interrupted()) {
        tag('info').log('Research interrupted, returning partial result');
      }

      result.cleanup();

      let researchFile: string | null = null;
      if (stateHash) {
        researchFile = saveResearch(stateHash, result.text, combinedHtml);
      }

      const summaryMatch = result.text.match(/## Summary\s*\n+([\s\S]*?)(?=\n##|$)/i);
      if (summaryMatch) {
        const summaryLine = summaryMatch[1].trim().split('\n')[0].trim().slice(0, 200);
        if (summaryLine) this.experienceTracker.updateSummary(this.actionResult!, summaryLine);
      }

      tag('multiline').log(formatResearchSummary(result.text, { visionUsed: this.hasScreenshotToAnalyze }));
      tag('success').log('Research complete');
      if (researchFile) tag('substep').log(`Research file saved to: ${researchFile}`);
      if (this.actionResult?.screenshotFile) {
        const screenshotPath = outputPath('states', this.actionResult.screenshotFile);
        tag('substep').log(`UI screenshot: file://${screenshotPath}`);
      }

      await this.hooksRunner.runAfterHook('researcher', state.url);
      return result.text;
    });
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

    if (isEmpty && isOnCurrentState) {
      debugLog('HTML body empty on current URL, waiting for content');
      tag('step').log('Page body is empty, waiting for content...');
      await this.waitUntilSettled(screenshot ?? false);
      return;
    }

    debugLog('Not on current state, navigating to URL');
    tag('step').log('Navigating to URL...');

    await this.explorer.visit(url);
    this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot: screenshot ?? false });
  }

  private async waitUntilSettled(screenshot: boolean): Promise<boolean> {
    const errorPageTimeout = (this.explorer.getConfig().ai?.agents?.researcher as any)?.errorPageTimeout ?? 10;
    if (errorPageTimeout <= 0) return false;

    const page = this.explorer.playwrightHelper.page;
    const includeScreenshot = screenshot && this.provider.hasVision();

    try {
      await page?.waitForLoadState('networkidle', { timeout: errorPageTimeout * 1000 });
    } catch {}

    await this.explorer.annotateElements();
    this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot });

    let condition = detectPageCondition(this.actionResult!);
    if (condition === 'error') {
      throw new ErrorPageError(this.actionResult!.url, this.actionResult!.title);
    }
    if (condition === 'ok') return true;

    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await this.explorer.annotateElements();
      this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot });
      condition = detectPageCondition(this.actionResult!);
      if (condition === 'error') {
        throw new ErrorPageError(this.actionResult!.url, this.actionResult!.title);
      }
      if (condition === 'ok') return true;
    }

    return false;
  }

  private getConfiguredSections(): Record<string, string> {
    const configSections = (this.explorer.getConfig().ai?.agents?.researcher as any)?.sections as string[] | undefined;
    if (!configSections?.length) return POSSIBLE_SECTIONS;
    const filtered: Record<string, string> = {};
    for (const key of configSections) {
      if (key in POSSIBLE_SECTIONS) filtered[key] = POSSIBLE_SECTIONS[key as keyof typeof POSSIBLE_SECTIONS];
    }
    return Object.keys(filtered).length > 0 ? filtered : POSSIBLE_SECTIONS;
  }

  private researchRules(): string {
    const sections = this.getConfiguredSections();
    const currentUrl = this.stateManager.getCurrentState()?.url || '';
    return dedent`
      <task>
      Examine the page and explain its main purpose from the user perspective.
      Identify the primary user actions and break the page into sections.
      Provide a UI map report in markdown.
      </task>

      <rules>
      - Explain what the user can achieve on this page.
      - Focus on primary user actions and interactive elements only.
      - Research all menus and navigational areas.
      - Ignore decorative sidebars, footer-only links, and external links.
      - Detect layout patterns: list/detail split, 2-pane, or 3-pane layouts.
      - Every element with an eidx attribute MUST appear in the UI map — describe icon-only buttons by their visual role.
      - Every UI map row needs a CSS selector; ARIA may be "-" for icon-only buttons, CSS must never be "-".
      - ARIA locator JSON uses keys "role" and "text" (NOT "name").
      - Mark elements with likely hover interactions (title, aria-describedby, menu items with submenus) as "(hover)".
      </rules>

      ${generalLocatorRuleText}

      ${RulesLoader.loadRules('researcher', ['ui-map-table', 'list-element', 'container-rules'], currentUrl)}

      <section_identification>
      Identify page sections in this priority order:
      ${Object.entries(sections)
        .map(([name, description]) => `* ${name}: ${description}`)
        .join('\n')}

      - Sections can overlap; prefer more detailed sections over broader ones.
      - Never name a section "Focus" or "Focused" — use what it contains (Detail, Modal, Form, Content, List).
      - Omit sections that are not present or not relevant.
      - Each section needs a container CSS locator; UI map CSS locators are relative to it.
      </section_identification>

      <section_format>
      ## Section Name

      Explanation of this section and its purpose.

      > Container: '.container-css-selector'

      | Element | ARIA | CSS | eidx |
      </section_format>
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

    const ariaSnapshot = this.actionResult.getCompactARIA();

    return dedent`
      Analyze this web page and provide a comprehensive research report in markdown format.

      ${this.researchRules()}

      URL: ${this.actionResult.url || 'Unknown'}
      Title: ${this.actionResult.title || 'Unknown'}

      <eidx_mapping>
      Elements have \`eidx\` attribute (e.g. \`eidx="5"\`) — include its value in the eidx column.
      Never include \`eidx\` attribute in CSS or XPath selectors.
      </eidx_mapping>

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
      - List sections by provided priorities: ${Object.keys(this.getConfiguredSections()).join(', ')}
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
    const r = await this.provider.chat([{ role: 'user', content: prompt }], model, { agentName: 'researcher', telemetryFunctionId: 'researcher.textContent' });

    return r.text;
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

    const r = await this.provider.processImage(prompt, image.toString('base64'));
    return r.text;
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

    const r = await this.provider.processImage(prompt, image.toString('base64'));
    return r.text;
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
    const r = await this.provider.chat([{ role: 'user', content: prompt }], model, { agentName: 'researcher', telemetryFunctionId: 'researcher.extractData' });

    return r.text;
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

  extractBrief(researchText: string): string {
    return mdq(researchText)
      .query('section2')
      .each()
      .map((s) => {
        const heading = s.query('h2').text().trim();
        const paragraph = s.query('paragraph[0]').text().trim();
        const elements = s
          .query('table')
          .toJson()
          .map((row) => Object.values(row)[0])
          .filter(Boolean);

        const parts = [heading];
        if (paragraph) parts.push(paragraph);
        if (elements.length) parts.push(`Elements: ${elements.join(', ')}`);
        if (heading.toLowerCase() === 'primary actions') {
          const listItems = s.query('list').text().trim();
          if (listItems) parts.push(listItems);
        }
        return parts.join('\n');
      })
      .filter(Boolean)
      .join('\n\n');
  }

  async navigateTo(url: string): Promise<void> {
    const action = this.explorer.createAction();
    await action.execute(`I.amOnPage("${url}")`);
  }

  async cancelInUi() {
    const beforeAria = this.stateManager.getCurrentState()?.ariaSnapshot || null;
    const action = this.explorer.createAction();

    await action.execute('I.clickXY(0, 0)');
    if (diffAriaSnapshots(beforeAria, this.stateManager.getCurrentState()?.ariaSnapshot || null)) return;

    await action.execute(`I.pressKey('Escape')`);
  }
}
