import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import Action from '../action.ts';
import { setActivity } from '../activity.ts';
import { ConfigParser } from '../config.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import { Observability } from '../observability.ts';
import type { StateManager } from '../state-manager.js';
import { WebPageState } from '../state-manager.js';
import { Stats } from '../stats.ts';
import { collectInteractiveNodes, diffAriaSnapshots } from '../utils/aria.ts';
import { extractCodeBlocks } from '../utils/code-extractor.ts';
import { isErrorPage } from '../utils/error-page.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { type HtmlDiffResult, htmlDiff } from '../utils/html-diff.ts';
import { codeToMarkdown, isBodyEmpty } from '../utils/html.ts';
import { createDebug, pluralize, tag } from '../utils/logger.js';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.js';
import type { Conversation } from './conversation.js';
import type { Provider } from './provider.js';
import { locatorRule as generalLocatorRuleText, multipleLocatorRule, screenshotUiMapRule, sectionUiMapRule, uiMapTableFormat } from './rules.js';

const debugLog = createDebug('explorbot:researcher');

const POSSIBLE_SECTIONS = {
  focus: 'focused overlay (modal, drawer, popup, active form)',
  list: 'list area (items collection, table, cards, or list view)',
  detail: 'detail area (selected item preview or full details)',
  panes: 'screen is split into equal panes, describe each pane',
  content: 'main area of page',
  menu: 'navigation area',
};

const DEFAULT_STOP_WORDS = ['close', 'cancel', 'dismiss', 'exit', 'back', 'cookie', 'consent', 'gdpr', 'privacy', 'accept all', 'decline all', 'reject all', 'share', 'print', 'download'];

const CLICKABLE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'option', 'combobox', 'switch']);

export class Researcher implements Agent {
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
    this.explorer = explorer;
    this.provider = provider;
    this.stateManager = explorer.getStateManager();
    this.experienceTracker = this.stateManager.getExperienceTracker();
    this.hooksRunner = new HooksRunner(explorer, explorer.getConfig());
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

  async research(state: WebPageState, opts: { screenshot?: boolean; force?: boolean; deep?: boolean; data?: boolean } = {}): Promise<string> {
    Stats.researches++;
    const { screenshot = false, force = false, deep = false, data = false } = opts;
    this.actionResult = ActionResult.fromState(state);
    const stateHash = state.hash || this.actionResult.getStateHash();
    const outputDir = stateHash ? ConfigParser.getInstance().getOutputDir() : null;
    const researchDir = stateHash && outputDir ? join(outputDir, 'research') : null;
    const researchFile = stateHash && researchDir ? join(researchDir, `${stateHash}.md`) : null;

    if (!force && stateHash) {
      const cached = this.getCachedResearchResult(stateHash);
      if (cached) {
        debugLog('Previous research result found');
        return cached;
      }
    }

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

      const prompt = await this.buildResearchPrompt();

      const conversation = this.provider.startConversation(this.getSystemMessage(), 'researcher');
      conversation.addUserText(prompt);

      if (this.hasScreenshotToAnalyze) {
        this.actionResult = await this.explorer.createAction().caputrePageWithScreenshot();
        const screenshotAnalysis = await this.analyzeScreenshotForUIElements();
        if (screenshotAnalysis) {
          this.addScreenshotPrompt(conversation, screenshotAnalysis);
        }
      }

      const result = await this.provider.invokeConversation(conversation);
      if (!result) throw new Error('Failed to get response from provider');

      const { response } = result;

      let researchText = response.text;

      if (deep) {
        researchText += await this.performDeepAnalysis(conversation, state, state.html ?? '');
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

      await this.hooksRunner.runAfterHook('researcher', state.url);
      return researchText;
    });
  }

  private async performDeepAnalysis(conversation: Conversation, state: WebPageState, initialHtml: string): Promise<string> {
    debugLog('Starting DOM expansion loop to find hidden elements');

    const htmlConfig = ConfigParser.getInstance().getConfig().html;
    let additionalResearch = '';
    let previousHtml = initialHtml;

    await loop(
      async ({ stop }) => {
        conversation.addUserText(this.buildHiddenElementsPrompt());

        const hiddenElementsResult = await this.provider.invokeConversation(conversation);

        const codeBlocks = extractCodeBlocks(hiddenElementsResult?.response?.text || '');

        if (codeBlocks.length === 0) {
          debugLog('No hidden elements found to expand, stopping loop');
          stop();
          return;
        }

        debugLog(`Found ${codeBlocks.length} hidden elements to expand`);

        previousHtml = state.html ?? '';

        await loop(
          async ({ stop }) => {
            const codeBlock = codeBlocks.shift()!;
            if (!codeBlock) {
              stop();
              return;
            }

            const action = this.explorer.createAction();
            tag('step').log(codeBlock || 'No code block');
            await action.attempt(codeBlock, 'expand hidden elements');

            const currentState = action.getActionResult();
            if (!currentState) {
              debugLog('No current state found, continuing to next action');
              return;
            }

            if (!currentState.isMatchedBy({ url: `${state.url}*` })) {
              additionalResearch += `\n\nWhen ${codeBlock} original page changed to ${currentState.url}`;
              tag('step').log(`We moved away from the original page, returning to ${state.url}`);
              await this.navigateTo(state.url);
              return;
            }

            const htmlChanges = await htmlDiff(previousHtml, currentState.html ?? '', htmlConfig);
            if (htmlChanges.added.length === 0) {
              debugLog('No new HTML nodes added');
              additionalResearch += `\n\nWhen ${codeBlock} page did not change`;
              return;
            }

            tag('step').log('DOM changed, analyzing new HTML nodes...');

            conversation.addUserText(this.buildSubtreePrompt(codeBlock, htmlChanges));
            const htmlFragmentResult = await this.provider.invokeConversation(conversation);

            additionalResearch += dedent`\n\n---
            <expanded_ui_map>

              When executed <code>${codeBlock}</code>:
              ${htmlFragmentResult?.response?.text}
            </expanded_ui_map>`;

            await this.cancelInUi();

            if (state.ariaSnapshot && currentState.ariaSnapshot && state.ariaSnapshot === currentState.ariaSnapshot) {
              debugLog('Aria snapshots match, staying on current page');
              return;
            }

            await this.navigateTo(state.url);
            stop();
          },
          {
            maxAttempts: codeBlocks.length,
            observability: {
              agent: 'researcher',
            },
            catch: async (error) => {
              debugLog(error);
            },
          }
        );
      },
      {
        maxAttempts: ConfigParser.getInstance().getConfig().action?.retries || 3,
        observability: {
          agent: 'researcher',
        },
        catch: async ({ error, stop }) => {
          debugLog(error);
          stop();
        },
      }
    );

    return additionalResearch;
  }

  private async ensureNavigated(url: string, screenshot?: boolean): Promise<void> {
    if (!this.actionResult) {
      debugLog('No action result, navigating to URL');
      await this.navigateTo(url);
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

    await this.navigateTo(url);
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
      - UI map table must include Container, ARIA, CSS, and XPath for every element.
      - ARIA locator must be JSON with role and text keys (NOT "name").
      </rules>

      ${generalLocatorRuleText}

      ${uiMapTableFormat}

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

      Section Container CSS Locator: '...'

      Elements:

      | Element | ARIA | CSS | XPath |
      </section_format>
      <section_example>
      ## Focus Section

      Login modal dialog that appears as an overlay when user clicks the login button. This modal contains a form for user authentication with email and password fields, along with submit and cancel actions.

      Section Container CSS Locator: '[role="dialog"]'

      Elements:

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
      - Follow <section_format> and provided <section_example> when describing sections:   
      </output_rules>


    `;
  }

  private buildHiddenElementsPrompt(): string {
    return dedent`
    <task>
    Analyze the current page state and identify hidden or collapsible elements that should be expanded to discover more UI elements.
    Review previous conversation to find which hidden elements were already expanded.
    Do not repeat already expanded elements.
    If all hidden elements were already processed, return empty string.
    Pick exactly one UI element that must be expanded and provide codeblocks to expand it.
    </task>

    <rules>
    Look for hidden content or collapsible elements that should be expanded:
    - Dropdowns, tabs, accordions, hamburger menus
    - Look for links that open subpages (pages that have same path but different hash/query params/subpath)
    - "More/show" toggles, expandable sections
    - Hidden navigation menus, sidebar toggles
    - Modal triggers, popup buttons
    - Collapsed content areas
    
    Provide multiple code blocks using different locator strategies.
    Use only I.click() from CodeceptJS to expand elements.
    Each code block should be wrapped in \`\`\`js blocks.
    If there are no hidden elements that can be expanded, return empty string.
    </rules>

    <locators>
    ${multipleLocatorRule}
    ${generalLocatorRuleText}
    </locators>

    If you find a navbar toggle button, provide multiple approaches:
    <example_output>

    Expand navbar menu (simple locator):
    \`\`\`js
    I.click('.navbar-toggler');
    \`\`\`

    Expand navbar menu (more specific):
    \`\`\`js
    I.click('//nav[@class="navbar"]//button[@class="navbar-toggler"]');
    \`\`\`

    Expand navbar menu (by aria-label):
    \`\`\`js
    I.click('[aria-label="Toggle navigation"]');
    \`\`\`

    </example_output>
    </task>
  `;
  }

  private buildSubtreePrompt(action: string, htmlChanges: HtmlDiffResult): string {
    return dedent`
      To better understand the page, I performed the following action:
      ${action}

      The page changed and here is new HTML nodes:

    <context>
      The page changed and here is new HTML nodes:

    <subtree>
      ${htmlChanges.subtree}
    </subtree>
    </context>

    <task>
    Now analyze this page fragment and provide a UI map report in markdown format.
    Include only new findings you see in the new HTML nodes.
    List all interactive elements in the new HTML nodes.
    Do not repeat any sections from the previous report.
    If you see similar elements, group them into one item.
    Explain the action ${action} was performed, and what appeared on the page.
    </task>

    ${generalLocatorRuleText}

    ${uiMapTableFormat}

    <output_format>
      <action description>
      <UI elements table>
    </output_format>

    <example_output>
    When opening dropdown at .dropdown by clicking it, a submenu appeared.
    This submenu is for interacting with {item name}.

    Section Container CSS Locator: '.dropdown-menu'

    | Element | ARIA | CSS | XPath |
    |---------|------|-----|-------|
    | 'Folder' | { role: 'menuitem', text: 'Folder' } | 'li:nth-child(1) button' | '//li[1]//button' |
    | 'Suite' | { role: 'menuitem', text: 'Suite' } | 'li:nth-child(2) button' | '//li[2]//button' |
    </example_output>
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
        | Element | ARIA | CSS | XPath | Coordinates |
        | 'Sign In' | { role: 'button', text: 'Sign In' } | 'button.btn-signin' | '//button[@class="btn-signin"]' | (450, 320) |
        | 'Email' | { role: 'textbox', text: 'Email' } | 'input#email' | '//input[@id="email"]' | (300, 200) |
        | 'Settings' | { role: 'link', text: 'Settings' } | 'a.settings-link' | '//a[@class="settings-link"]' | (850, 50) |
        | 'Menu Toggle' | - | '.hamburger-btn' | '//button[contains(@class,"hamburger-btn")]' | (30, 25) |

        Group elements by type (Buttons, Links, Inputs, etc.) within each section.
        CRITICAL: Include Coordinates for EVERY element in the table. Do NOT create a separate Coordinates section.
        </element_format>

        <output_format>

        ## Summary

        Brief overview of the page purpose and main content.

        ## Section Name

        Explanation

        Section Container CSS Locator: '...'

        #### Section UI Map:
        | Element | ARIA | CSS | XPath | Coordinates |
        | 'Element Name' | { role: 'button', text: '...' } | 'css' | '//button[@type="button"]' | (X, Y) |

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

  private getCachedResearchResult(stateHash: string): string {
    const ttl = 60 * 60 * 1000;
    const now = Date.now();
    const timestamp = Researcher.researchCacheTimestamps[stateHash];

    if (timestamp && now - timestamp <= ttl) {
      const cached = Researcher.researchCache[stateHash];
      if (cached) return cached;
    }

    const outputDir = ConfigParser.getInstance().getOutputDir();
    const researchDir = join(outputDir, 'research');
    const researchFile = join(researchDir, `${stateHash}.md`);

    if (!existsSync(researchFile)) return '';

    const stats = statSync(researchFile);
    if (now - stats.mtimeMs > ttl) return '';

    const cached = readFileSync(researchFile, 'utf8');
    if (!cached) return '';

    Researcher.researchCache[stateHash] = cached;
    Researcher.researchCacheTimestamps[stateHash] = now;
    return cached;
  }

  private extractSummary(researchText: string): string {
    const summaryMatch = researchText.match(/## Summary\s*\n+([\s\S]*?)(?=\n##|$)/i);
    if (!summaryMatch) return '';
    const summaryContent = summaryMatch[1].trim();
    const firstLine = summaryContent.split('\n')[0].trim();
    return firstLine.slice(0, 200);
  }

  private async navigateTo(url: string): Promise<void> {
    const action = this.explorer.createAction();
    await action.execute(`I.amOnPage("${url}")`);
    await action.expect(`I.seeInCurrentUrl('${url}')`);
  }

  private async cancelInUi() {
    const action = this.explorer.createAction();
    await action.execute(`I.click('//body')`);
  }

  private addScreenshotPrompt(conversation: Conversation, screenshotAnalysis: string): void {
    conversation.addUserText(dedent`
      <screenshot_analysis>
      ${screenshotAnalysis}
      </screenshot_analysis>

      IMPORTANT: Merge screenshot analysis INTO your UI map tables:
      1. ADD a Coordinates column to ALL UI map tables
      2. For each element, include coordinates (X, Y) from screenshot analysis
      3. Use "-" for elements not visible in screenshot
      4. DO NOT create a separate Coordinates section - coordinates must be IN the tables

      Final table format must be:
      | Element | ARIA | CSS | XPath | Coordinates |

      Also incorporate any visual elements not captured in HTML (icons, images, visual indicators).
    `);
  }

  private getResearcherConfig() {
    return ConfigParser.getInstance().getConfig().ai?.agents?.researcher;
  }

  private matchesStopWord(name: string, stopWords: string[]): boolean {
    const normalized = name.toLowerCase().trim();
    return stopWords.some((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`, 'i').test(normalized);
    });
  }

  private async getExcludingSelector(role: string, name: string, excludeSelectors: string[]): Promise<string | null> {
    if (excludeSelectors.length === 0) return null;

    try {
      const locator = { role, text: name };
      const webElement = await this.explorer.actor.grabWebElement(locator);

      for (const selector of excludeSelectors) {
        const isInside = await webElement.element.evaluate((el: Element, sel: string) => el.closest(sel) !== null, selector);
        if (isInside) return selector;
      }
      return null;
    } catch {
      return null;
    }
  }

  async performInteractiveExploration(state: WebPageState): Promise<string> {
    const config = this.getResearcherConfig();
    const stopWords = config?.stopWords ?? DEFAULT_STOP_WORDS;
    const excludeSelectors = config?.excludeSelectors || [];
    const includeSelectors = config?.includeSelectors || [];
    const maxElements = config?.maxElementsToExplore ?? 10;

    const interactiveNodes = collectInteractiveNodes(state.ariaSnapshot || '');
    const originalUrl = state.url;

    const candidates = interactiveNodes.filter((node) => {
      const role = String(node.role || '').toLowerCase();
      const name = String(node.name || '').trim();

      if (!CLICKABLE_ROLES.has(role)) {
        debugLog(`Skipping "${name}" - role "${role}" not clickable`);
        return false;
      }

      if (!name) {
        debugLog(`Skipping unnamed ${role} element`);
        return false;
      }

      if (name.length > 50) {
        debugLog(`Skipping "${name.slice(0, 30)}..." - name too long`);
        return false;
      }

      if (this.matchesStopWord(name, stopWords)) {
        debugLog(`Skipping "${name}" - matches stop word`);
        return false;
      }

      return true;
    });

    const targets: Array<Record<string, unknown>> = [];
    for (const node of candidates) {
      const role = String(node.role || '');
      const name = String(node.name || '').trim();

      const excludedBy = await this.getExcludingSelector(role, name, excludeSelectors);
      if (excludedBy) {
        debugLog(`Skipping "${name}" - inside excluded container "${excludedBy}"`);
        continue;
      }

      targets.push(node);
      if (targets.length >= maxElements) break;
    }

    debugLog(`${candidates.length} candidates → ${targets.length} targets after filtering`);

    const results: Array<{ element: string; role: string; result: string }> = [];

    for (let i = 0; i < targets.length; i++) {
      const node = targets[i];
      const role = String(node.role || '');
      const name = String(node.name || '').trim();

      tag('substep').log(`[${i + 1}/${targets.length}] Exploring: "${name}" (${role})`);

      const action = this.explorer.createAction();
      const beforeState = await action.capturePageState({});

      try {
        await action.execute(`I.click({ role: '${role}', text: '${name.replace(/'/g, "\\'")}' })`);
        const afterState = await action.capturePageState({});

        const resultDescription = this.detectChangeResult(beforeState, afterState, originalUrl);
        results.push({ element: name, role, result: resultDescription });

        await this.restoreState(afterState, originalUrl);
      } catch (error) {
        debugLog(`Failed to explore ${name}:`, error);
        results.push({ element: name, role, result: 'click failed' });
      }
    }

    if (includeSelectors.length > 0) {
      await this.exploreIncludeSelectors(includeSelectors, results, originalUrl);
    }

    return this.formatResultsTable(results);
  }

  private detectChangeResult(before: ActionResult, after: ActionResult, originalUrl: string): string {
    if (after.url !== before.url) {
      if (!after.url.startsWith(originalUrl.split('?')[0])) {
        return `navigated to ${after.url}`;
      }
      return `URL changed to ${after.url}`;
    }

    const ariaDiff = diffAriaSnapshots(before.ariaSnapshot || '', after.ariaSnapshot || '');
    if (ariaDiff) {
      if (ariaDiff.includes('dialog') || ariaDiff.includes('modal')) {
        return 'opened dialog/modal';
      }
      if (ariaDiff.includes('menu')) {
        return 'opened menu';
      }
      return 'UI changed';
    }

    return 'no visible change';
  }

  private async restoreState(afterState: ActionResult, originalUrl: string): Promise<void> {
    if (afterState.url !== originalUrl) {
      await this.navigateTo(originalUrl);
      return;
    }

    const action = this.explorer.createAction();
    await action.execute('I.pressKey("Escape")');
    const stateAfterEscape = await action.capturePageState({});
    const ariaDiff = diffAriaSnapshots(afterState.ariaSnapshot || '', stateAfterEscape.ariaSnapshot || '');
    if (!ariaDiff) {
      await this.cancelInUi();
    }
  }

  private async exploreIncludeSelectors(includeSelectors: string[], results: Array<{ element: string; role: string; result: string }>, originalUrl: string): Promise<void> {
    for (const containerSelector of includeSelectors) {
      const buttonsSelector = `${containerSelector} button, ${containerSelector} [role="button"], ${containerSelector} a`;

      const elements = await this.explorer.actor.grabWebElements(buttonsSelector);

      for (const webElement of elements) {
        const name = await webElement.getText();
        if (!name?.trim()) continue;

        tag('substep').log(`Exploring (include): "${name.trim()}" in ${containerSelector}`);

        const action = this.explorer.createAction();
        const beforeState = await action.capturePageState({});

        try {
          await action.execute(`I.click("${name.trim()}", "${containerSelector}")`);
          const afterState = await action.capturePageState({});

          const resultDescription = this.detectChangeResult(beforeState, afterState, originalUrl);
          results.push({ element: name.trim(), role: 'button', result: resultDescription });

          await this.restoreState(afterState, originalUrl);
        } catch (error) {
          debugLog(`Failed to explore ${name}:`, error);
        }
      }
    }
  }

  private formatResultsTable(results: Array<{ element: string; role: string; result: string }>): string {
    if (results.length === 0) {
      return 'No interactive elements were explored.';
    }

    const lines = ['| Element | Role | Result |', '|---------|------|--------|'];
    for (const r of results) {
      lines.push(`| ${r.element} | ${r.role} | ${r.result} |`);
    }
    return lines.join('\n');
  }

  auditResearch(state: WebPageState, researchOutput: string): string {
    const ariaNodes = collectInteractiveNodes(state.ariaSnapshot || '');
    const researchLower = researchOutput.toLowerCase();

    const codeFilterIssues: Array<{ element: string; role: string; reason: string; file: string }> = [];
    const promptIssues: Array<{ element: string; role: string }> = [];
    const found: Array<{ element: string; role: string }> = [];

    for (const node of ariaNodes) {
      const role = String(node.role || '');
      const name = String(node.name || '').trim();
      const isUnnamed = !!node.unnamed;

      const inResearch = name ? researchLower.includes(name.toLowerCase()) : false;

      if (inResearch) {
        found.push({ element: name || `unnamed ${role}`, role });
        continue;
      }

      if (isUnnamed) {
        codeFilterIssues.push({
          element: `unnamed ${role}`,
          role,
          reason: 'Unnamed button/link (icon-only element without aria-label)',
          file: 'src/utils/aria.ts:81',
        });
        continue;
      }

      if (!CLICKABLE_ROLES.has(role.toLowerCase())) {
        codeFilterIssues.push({
          element: name,
          role,
          reason: `Role "${role}" not in CLICKABLE_ROLES`,
          file: 'src/ai/researcher.ts:40',
        });
        continue;
      }

      if (this.matchesStopWord(name, DEFAULT_STOP_WORDS)) {
        codeFilterIssues.push({
          element: name,
          role,
          reason: `Name "${name}" matches DEFAULT_STOP_WORDS`,
          file: 'src/ai/researcher.ts:38',
        });
        continue;
      }

      promptIssues.push({ element: name || `unnamed ${role}`, role });
    }

    const lines: string[] = [];
    lines.push('# Research Audit Report');
    lines.push('');
    lines.push(`URL: ${state.url}`);
    lines.push(`Total ARIA interactive elements: ${ariaNodes.length}`);
    lines.push(`Found in research output: ${found.length}`);
    lines.push(`Missing: ${codeFilterIssues.length + promptIssues.length}`);
    lines.push('');

    if (codeFilterIssues.length > 0) {
      lines.push('## CODE FILTER ISSUES (PR material)');
      lines.push('');
      const byReason = new Map<string, typeof codeFilterIssues>();
      for (const issue of codeFilterIssues) {
        const group = byReason.get(issue.reason) || [];
        group.push(issue);
        byReason.set(issue.reason, group);
      }
      for (const [reason, issues] of byReason) {
        lines.push(`### [${issues[0].file}] ${issues.length}x ${reason}`);
        for (const issue of issues) {
          lines.push(`  - ${issue.role} "${issue.element}"`);
        }
        lines.push('');
      }
    }

    if (promptIssues.length > 0) {
      lines.push('## PROMPT ISSUES (PR material)');
      lines.push('');
      lines.push('Elements passed all code filters but AI did not include them:');
      for (const issue of promptIssues) {
        lines.push(`  - ${issue.role} "${issue.element}"`);
      }
      lines.push('');
    }

    if (codeFilterIssues.length === 0 && promptIssues.length === 0) {
      lines.push('All interactive elements found in research output.');
    }

    return lines.join('\n');
  }
}
