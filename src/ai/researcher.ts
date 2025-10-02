import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import Action from '../action.ts';
import { setActivity } from '../activity.ts';
import { ConfigParser } from '../config.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { StateManager } from '../state-manager.js';
import { WebPageState } from '../state-manager.js';
import { extractCodeBlocks } from '../utils/code-extractor.ts';
import { type HtmlDiffResult, htmlDiff } from '../utils/html-diff.ts';
import { createDebug, tag } from '../utils/logger.js';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.js';
import type { Conversation } from './conversation.js';
import type { Provider } from './provider.js';
import { locatorRule as generalLocatorRuleText, multipleLocatorRule } from './rules.js';

const debugLog = createDebug('explorbot:researcher');

export class Researcher implements Agent {
  emoji = '🔍';
  private static researchCache: Record<string, string> = {};
  private explorer: Explorer;
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;

  constructor(explorer: Explorer, provider: Provider) {
    this.explorer = explorer;
    this.provider = provider;
    this.stateManager = explorer.getStateManager();
    this.experienceTracker = this.stateManager.getExperienceTracker();
  }

  static getCachedResearch(state: WebPageState): string {
    if (!state.hash) return '';
    return Researcher.researchCache[state.hash];
  }

  getSystemMessage(): string {
    return dedent`
    <role>
    You are senior QA focused on exploritary testig of web application.
    </role>
    `;
  }

  async research(): Promise<string> {
    const state = this.stateManager.getCurrentState();
    if (!state) throw new Error('No state found');

    const actionResult = ActionResult.fromState(state);
    const stateHash = state.hash || actionResult.getStateHash();

    if (stateHash && Researcher.researchCache[stateHash]) {
      tag('step').log('Previous research result found');
      state.researchResult ||= Researcher.researchCache[stateHash];
      return Researcher.researchCache[stateHash];
    }

    const experienceFileName = 'research_' + actionResult.getStateHash();
    if (this.experienceTracker.hasRecentExperience(experienceFileName)) {
      tag('step').log('Using research from the experience file');
      const cached = this.experienceTracker.readExperienceFile(experienceFileName)?.content || '';
      if (stateHash) Researcher.researchCache[stateHash] = cached;
      state.researchResult = cached;
      return cached;
    }

    tag('info').log(`Researching ${state.url} to understand the context...`);
    setActivity(`${this.emoji} Researching...`, 'action');
    const stateHtml = await actionResult.combinedHtml();

    debugLog('Researching web page:', actionResult.url);
    const prompt = this.buildResearchPrompt(actionResult, stateHtml);

    const conversation = this.provider.startConversation(this.getSystemMessage());
    conversation.addUserText(prompt);
    // if (actionResult.screenshot) {
    //   conversation.addUserImage(actionResult.screenshot.toString('base64'));
    // }

    const result = await this.provider.invokeConversation(conversation);
    if (!result) throw new Error('Failed to get response from provider');

    const { response } = result;

    let researchText = response.text;

    const htmlConfig = ConfigParser.getInstance().getConfig().html;
    let previousHtml = state.html ?? '';

    debugLog('Starting DOM expansion loop to find hidden elements');

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
            await action.execute(codeBlock);

            const currentState = action.getActionResult();
            if (!currentState) {
              debugLog('No current state found, continuing to next action');
              return;
            }

            if (!currentState.isMatchedBy({ url: state.url + '*' })) {
              researchText += `\n\nWhen ${codeBlock} original page changed to ${currentState.url}`;
              debugLog('We moved away from the original page, returning to ${state.url}');
              await this.navigateTo(state.url);
              return;
            }

            const htmlChanges = htmlDiff(previousHtml, currentState.html ?? '', htmlConfig);
            if (htmlChanges.added.length === 0) {
              debugLog('No new HTML nodes added');
              researchText += `\n\nWhen ${codeBlock} page did not change`;
              return;
            }

            tag('step').log(`DOM changed, analyzing new HTML nodes...`);

            conversation.addUserText(this.buildSubtreePrompt(codeBlock, htmlChanges));
            const htmlFragmentResult = await this.provider.invokeConversation(conversation);

            researchText += dedent`\n\n---
            <expanded_ui_map>

              When executed <code>${codeBlock}</code>:
              ${htmlFragmentResult?.response?.text}
            </expanded_ui_map>`;

            // debugLog('Closing modal/popup/dropdown/etc.');
            await this.navigateTo(state.url);
            stop();
          },
          {
            maxAttempts: codeBlocks.length,
            catch: async (error) => {
              debugLog(error);
            },
          }
        );
      },
      {
        maxAttempts: ConfigParser.getInstance().getConfig().action?.retries || 3,
        catch: async ({ error, stop }) => {
          debugLog(error);
          stop();
        },
      }
    );

    state.researchResult = researchText;
    if (stateHash) Researcher.researchCache[stateHash] = researchText;

    this.experienceTracker.writeExperienceFile(experienceFileName, researchText, {
      url: actionResult.relativeUrl,
    });
    tag('multiline').log(researchText);
    tag('success').log(`Research compelete! ${researchText.length} characters`);

    return researchText;
  }

  private buildResearchPrompt(actionResult: ActionResult, html: string): string {
    const knowledgeFiles = this.stateManager.getRelevantKnowledge();

    let knowledge = '';
    if (knowledgeFiles.length > 0) {
      const knowledgeContent = knowledgeFiles
        .map((k) => k.content)
        .filter((k) => !!k)
        .join('\n\n');

      tag('substep').log(`Found ${knowledgeFiles.length} relevant knowledge file(s) for: ${actionResult.url}`);
      knowledge = `
        <hint>
        Here is relevant knowledge for this page:

        ${knowledgeContent}
        </hint>`;
    }

    return dedent`Analyze this web page and provide a comprehensive research report in markdown format.
    <task>
    Examine the provided page and understand its main purpose from the user perspective.
    Identify the main user actions of this page.
    Identify the main content of the page.
    Identify the main navigation of the page.
    Provide a comprehensive UI map report in markdown format.
    </task>

    <rules>
    - Analyze the web page and provide a UI map report.
    - Explain the main purpose of the page and what user can achieve from this page.
    - Focus on primary user actions of this page
    - Provider either CSS or XPath locator but not both. Shortest locator is preferred.
    - Research all menus and navigational areas;
    - Focus on interactive elements: forms, buttons, links, clickable elements, etc.
    - Structure the report by sections.
    - Focus on UI elements, not on static content.
    - Ignore purely decorative sidebars and footer-only links.
    </rules>


    URL: ${actionResult.url || 'Unknown'}
    Title: ${actionResult.title || 'Unknown'}

    <context>
    HTML Content:
    ${html}

    </context>

    ${knowledge}

    <output>

    <output_rules>
    Please provide a structured analysis in markdown format with the following sections:
    UI map must be in LLM friendly format: [element name]: [CSS/XPath locator]
    Do not use tables, use lists instead.
    If a section is not present, do not include it in the output.
    Below is suggested output format
    If proposed section is not relevant, do not include it in the output.
    When listing elements, mark their visibility - visible, hidden, collapsed, etc.

    If some sections are not present, do not include them in the output.
    Proposed sections must be relevant to the page.

    Proposed devision is on main/navigation areas however, you can add other areas if you identify them.
    List all interactive elements on page and put them into appropriate sections.
    Group similar interactive elements (like dynamic lists or content) into one item
    </output_rules>

    <output_format>

    ## Summary

    Brief overview of the page purpose and main content.
    Identify the purpose of this page and what user can do on this page.

    ## Main Area

    [UI elements that are part of the main content of the page]

    ### Buttons
    - Button name: CSS/XPath locator
    - Example: "Submit Button": "button[type='submit']" or "//button[@type='submit']"    

    ### Forms
    - Form name: CSS/XPath locator
    - Example: "Login Form": "form#login" or "//form[@id='login']"

    ### Tabs (if any)
    - List of tabs titles and their CSS/XPath locator

    ### Content (if any)
    - Content area name: CSS/XPath locator
    - Example: "Article Header": "h1.article-title" or "//h1[@class='article-title']"    

    ### Accordions (if any)
    - List of accordions titles and their CSS/XPath locator

    ### Dropdowns (if any)
    - List of dropdowns titles and their CSS/XPath locator    

    ## Navigation Area

    ### Menus
    - Menu name: CSS/XPath locator
    - Example: "Main Navigation": "nav.main-menu" or "//nav[@class='main-menu']"

    ...

    </output_format>
    </output>

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

    <output_format>
      <action description>
      <UI elements>
    </output_format>

    <example_output>
    When openinig dropdown at .dropdown by clicking it a submenu appeared:
    This submenue is for interacting with {item name}.

    This submenu contains following items:

    - [item name]: [CSS/XPath locator]
    - [item name]: [CSS/XPath locator]
    </example_output>
      `;
  }

  async textContent(): Promise<string> {
    const state = this.stateManager.getCurrentState();
    if (!state) throw new Error('No state found');

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

      Here is HTML:

      ${html}
    `;

    const result = await this.provider.chat([{ role: 'user', content: prompt }]);

    return result.text;
  }

  private async navigateTo(url: string): Promise<void> {
    const action = this.explorer.createAction();
    await action.execute(`I.amOnPage("${url}")`);
    await action.expect(`I.seeInCurrentUrl('${url}')`);
  }
}
