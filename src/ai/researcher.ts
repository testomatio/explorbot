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
import { diffAriaSnapshots } from '../utils/aria.ts';
import { isErrorPage } from '../utils/error-page.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { isBodyEmpty } from '../utils/html.ts';
import { createDebug, pluralize, tag } from '../utils/logger.js';
import { mdq } from '../utils/markdown-query.ts';
import { withRetry } from '../utils/retry.ts';
import { executionController } from '../execution-controller.ts';
import type { Agent } from './agent.js';
import type { Navigator } from './navigator.ts';
import { ContextLengthError, type Provider } from './provider.js';
import { findSimilarResearch, getCachedResearch, saveResearch } from './researcher/cache.ts';
import { type CoordinateMethods, WithCoordinates } from './researcher/coordinates.ts';
import { type DeepAnalysisMethods, WithDeepAnalysis } from './researcher/deep-analysis.ts';
import { FOCUSED_MARKER, detectFocusFromAria, hasFocusedSection, markSectionAsFocused, pickDefaultFocusedSection } from './researcher/focus.ts';
import { type LocatorMethods, WithLocators } from './researcher/locators.ts';
import { extractValidContainers, parseResearchSections } from './researcher/parser.ts';
import { ResearchResult } from './researcher/research-result.ts';
import { locatorRule as generalLocatorRuleText } from './rules.js';
import { RulesLoader } from '../utils/rules-loader.ts';
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

function formatResearchSummary(text: string, opts?: { visionUsed?: boolean }): string {
  const sections = parseResearchSections(text);
  const coordCount = sections.reduce((sum, s) => sum + s.elements.filter((e) => e.coordinates !== null).length, 0);

  const lines: string[] = [];
  for (const s of sections) {
    const focused = s.rawMarkdown.includes(FOCUSED_MARKER);
    lines.push(`- **${s.name}** (${pluralize(s.elements.length, 'element')})`);
    if (focused) lines.push('  - Focused');
    if (s.containerCss) lines.push(`  - Container: \`${s.containerCss}\``);
  }

  lines.push('', `Chars: ${text.length}`);

  if (opts?.visionUsed || coordCount > 0) {
    lines.push(`Vision: ${coordCount} elements with coordinates`);
  }

  return lines.join('\n');
}

const ResearcherBase = WithDeepAnalysis(WithCoordinates(WithLocators(TaskAgent as unknown as new (...args: any[]) => TaskAgent)));

export interface Researcher extends LocatorMethods, CoordinateMethods, DeepAnalysisMethods {}

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

    <wording>
    In the UI map and all descriptions, name concrete UI parts (visible labels, headings, regions, ARIA roles). Do not use vague placeholders like "the page", "the element", "the button", "the input", "the link", "the form", "the table", "the list", or "the item". Do not use filler such as "comprehensive", "All required", "All elements", or "All necessary".
    </wording>

    ${customPrompt || ''}
    `;
  }

  async research(state: WebPageState, opts: { screenshot?: boolean; force?: boolean; deep?: boolean; data?: boolean; fix?: boolean; _retriesLeft?: number; _skipErrorPageRetry?: boolean } = {}): Promise<string> {
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
      tag('info').log(`Researching ${state.url} to understand the context...`);
      setActivity(`${this.emoji} Researching...`, 'action');

      await this.ensureNavigated(state.url, screenshot && this.provider.hasVision());
      await this.hooksRunner.runBeforeHook('researcher', state.url);

      const annotatedCount = await this.explorer.annotateElements();
      debugLog(`Annotated ${annotatedCount} interactive elements with eidx`);
      this.actionResult = await this.explorer.createAction().capturePageState({ includeScreenshot: screenshot && this.provider.hasVision() });

      if (isErrorPage(this.actionResult!)) {
        const recovered = await this.waitForPageLoad(screenshot);
        if (!recovered) {
          tag('warning').log(`Detected error page at ${state.url}`);
          return dedent`
            ## Error Page Detected

            URL: ${state.url}
            Title: ${this.actionResult!.title || 'N/A'}

            Research skipped. Navigate to a valid page to continue.
          `;
        }
      }

      debugLog('Researching web page:', this.actionResult!.url);

      const combinedHtml = await this.actionResult!.combinedHtml();

      if (!deep) {
        const similar = await findSimilarResearch(combinedHtml);
        if (similar) {
          tag('info').log('Similar research found, reusing cached result');
          if (stateHash) saveResearch(stateHash, similar, combinedHtml);
          tag('multiline').log(formatResearchSummary(similar));
          tag('success').log(`Research complete! ${similar.length} characters (reused)`);
          await this.hooksRunner.runAfterHook('researcher', state.url);
          return similar;
        }
      }

      const isOnCurrentState = this.actionResult!.getStateHash() === this.stateManager.getCurrentState()?.hash;
      this.hasScreenshotToAnalyze = screenshot && this.provider.hasVision() && isOnCurrentState;

      const conversation = this.provider.startConversation(this.getSystemMessage(), 'researcher');

      const prompt = await this.buildResearchPrompt();
      conversation.addUserText(prompt);

      let invocationResult: Awaited<ReturnType<typeof this.provider.invokeConversation>>;
      try {
        invocationResult = await this.provider.invokeConversation(conversation, undefined, { agentName: 'researcher' });
      } catch (error) {
        if (!(error instanceof ContextLengthError) || retriesLeft <= 0) {
          if (error instanceof ContextLengthError) {
            tag('warning').log('Output truncated. Try lowering reasoning effort or increasing maxTokens in ai.config.');
          }
          throw error;
        }
        tag('warning').log('Output truncated, retrying with focused instructions...');
        retriesLeft = 0;
        conversation.addUserText(this.buildFocusedRetryPrompt());
        invocationResult = await this.provider.invokeConversation(conversation, undefined, { agentName: 'researcher' });
      }
      if (!invocationResult) throw new Error('Failed to get response from provider');

      const result = new ResearchResult(invocationResult.response.text, state.url);
      debugLog(`Original research response length: ${result.text.length} chars`);

      if (mdq(result.text).query('section("Error Page Detected")').count() > 0 && result.text.length < 500) {
        if (!opts._skipErrorPageRetry && (await this.waitForPageLoad(screenshot))) {
          return this.research(state, { ...opts, force: true, _skipErrorPageRetry: true });
        }
        tag('warning').log(`AI detected error page at ${state.url}`);
        if (stateHash) saveResearch(stateHash, result.text);
        await this.hooksRunner.runAfterHook('researcher', state.url);
        return result.text;
      }

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
        await this.fixBrokenSections(result, conversation);
      }

      // Focused section: parse AI declaration, then ARIA fallback
      const focusMatch = result.text.match(/^>\s*Focused:\s*(.+)/m);
      if (focusMatch) {
        result.text = result.text.replace(focusMatch[0], '');
        markSectionAsFocused(result, focusMatch[1].trim());
      }
      if (!hasFocusedSection(result.text)) {
        const sections = parseResearchSections(result.text);
        const ariaSnapshot = this.actionResult?.getCompactARIA() || '';
        const focusedName = detectFocusFromAria(ariaSnapshot, sections);
        if (focusedName) markSectionAsFocused(result, focusedName);
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

      // Focused section: final fallback
      if (!hasFocusedSection(result.text)) {
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
      tag('success').log(`Research complete! ${result.text.length} characters`);
      if (researchFile) tag('substep').log(`Research file saved to: ${researchFile}`);
      if (this.actionResult?.screenshotFile) {
        const screenshotPath = join(ConfigParser.getInstance().getOutputDir(), this.actionResult.screenshotFile);
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

  private async waitForPageLoad(screenshot: boolean): Promise<boolean> {
    const errorPageTimeout = (this.explorer.getConfig().ai?.agents?.researcher as any)?.errorPageTimeout ?? 10;
    if (errorPageTimeout <= 0) return false;

    try {
      await withRetry(
        async () => {
          await this.explorer.annotateElements();
          this.actionResult = await this.explorer.createAction().capturePageState({
            includeScreenshot: screenshot && this.provider.hasVision(),
          });
          if (isErrorPage(this.actionResult!)) throw new Error('Error page detected');
        },
        {
          maxAttempts: Math.ceil(errorPageTimeout / 3) + 1,
          baseDelay: 1000,
          maxDelay: 5000,
          backoffMultiplier: 2,
          retryCondition: (e) => e.message === 'Error page detected',
        }
      );
      return true;
    } catch {
      return false;
    }
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
      - UI map table must include ARIA and CSS for every element.
      - Every element MUST have a CSS selector. NEVER leave CSS as "-".
      - For icon-only buttons with empty aria-label, set ARIA to "-" but ALWAYS provide CSS.
      - NEVER skip elements that have an eidx attribute. Every element with eidx MUST appear in the UI map table, even if it has no text or accessible name. Describe icon-only elements using their SVG class (e.g., md-icon-dots-horizontal → "More actions (ellipsis)") or their visual appearance.
      - ARIA locator must be JSON with role and text keys (NOT "name").
      - Note elements likely to have hover interactions (elements with title attribute, aria-describedby, navigation menu items with submenus) and mark them with "(hover)" in the UI map.
      </rules>

      ${generalLocatorRuleText}

      ${RulesLoader.loadRules('researcher', ['ui-map-table', 'list-element'], this.stateManager.getCurrentState()?.url || '')}

      <section_identification>
      Identify page sections in this priority order:
      ${Object.entries(sections)
        .map(([name, description]) => `* ${name}: ${description}`)
        .join('\n')}

      - Sections can overlap, prefer more detailed sections over broader ones.
      - Never name a section "Focus" or "Focused" — describe what the section actually contains (e.g., "Detail", "Modal", "Form", "Content", "List").
      - If a proposed section is not relevant or not detected, do not include it.
      - Each section must have a container CSS locator.
      - UI map CSS locators must be relative to the section container.
      </section_identification>

      <container_rules>
      CRITICAL: Container CSS must be a SINGLE selector — one class, one ID, or one attribute.
      No spaces, no >, no combinators, no nesting.
      - INVALID: '.filterbar-filter-btn-div button', 'div.static nav', 'div > .content'
      - INVALID: 'div', 'section', 'nav', 'div:first' (bare tags are not containers)
      - VALID: '.sticky-header', '.tree-list-item', '[role="dialog"]', 'nav.static', '.pagination-centered'
      Container must uniquely identify a semantic wrapper, not a path through the DOM.
      </container_rules>

      <section_format>
      ## Section Name

      Explanation of this section and its purpose.

      > Container: '.container-css-selector'

      | Element | ARIA | CSS | eidx |
      </section_format>
      <section_example>
      ## List

      Product catalog showing available items with sorting and filtering.

      > Container: '.product-list'

      | Element | ARIA | CSS | eidx |
      | 'Sort by price' | { role: 'button', text: 'Sort by price' } | '.sort-btn' | 3 |
      | 'Add to cart' | { role: 'button', text: 'Add to cart' } | '.add-btn' | 4 |
      | 'Product name' | { role: 'link', text: 'Widget Pro' } | 'a.product-link' | 5 |
      </section_example>

      <focused_section>
      At the very end of your output, add a single line declaring which section is the user's primary focus area:

      > Focused: <exact section name>

      Rules for determining the focused section:
      - If the page has a dialog, modal, drawer, or overlay — that section is focused
      - If no overlay exists, pick the section where the user performs the main business action of this page (e.g., a list section for a catalog page, a detail section for an item page, a content section for an article page)
      - Navigation is NEVER focused — it exists on every page
      - Menu/toolbar is NEVER focused — it contains actions, not the main content
      - The focused section is the one the user came to this page to interact with
      </focused_section>

      <css_selector_rules>
      CSS selectors MUST point to the actual interactive element (input, button, a, select), NOT to container divs.
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

    const ariaSnapshot = this.actionResult.getCompactARIA();

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

  private buildFocusedRetryPrompt(): string {
    return dedent`
      Your previous response was truncated and could not be parsed.

      Please retry with a shorter output. Focus ONLY on the main interactive section of the page.
      Skip navigation, sidebar, and footer sections. Output ONE section only with max 15 elements.
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

    await action.execute(`I.clickXY(0, 0)`);
    if (diffAriaSnapshots(beforeAria, this.stateManager.getCurrentState()?.ariaSnapshot || null)) return;

    await action.execute(`I.pressKey('Escape')`);
  }
}
