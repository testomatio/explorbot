import type { Provider } from './provider.js';
import { ActionResult } from '../action-result.js';
import type { StateManager } from '../state-manager.js';
import { tag, createDebug } from '../utils/logger.js';
import { setActivity } from '../activity.ts';
import { WebPageState } from '../state-manager.js';
import type { Conversation, Message } from './conversation.js';
import dedent from 'dedent';
import type { ExperienceTracker } from '../experience-tracker.ts';
import { createCodeceptJSTools } from './tools.ts';
import { tool } from 'ai';
import { z } from 'zod';

const debugLog = createDebug('explorbot:researcher');

export class Research {
  expandDOMCalled: boolean = false;
}

export class Researcher {
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;
  private research: Research;
  actor: CodeceptJS.I;

  constructor(provider: Provider, stateManager: StateManager) {
    this.provider = provider;
    this.stateManager = stateManager;
    this.experienceTracker = stateManager.getExperienceTracker();
    this.research = new Research();
  }

  setActor(actor: CodeceptJS.I) {
    this.actor = actor;
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

    if (state.researchResult) {
      return state.researchResult;
    }

    const tools = {
      ...createCodeceptJSTools(this.actor),
    };

    tag('info').log(
      `Initiated research for ${state.url} to understand the context...`
    );
    setActivity('🧑‍🔬 Researching...', 'action');
    const actionResult = ActionResult.fromState(state);
    const simplifiedHtml = await actionResult.simplifiedHtml();

    debugLog('Researching web page:', actionResult.url);
    const prompt = this.buildResearchPrompt(actionResult, simplifiedHtml);

    const expandDOMMessage = `
      <task>
      There might be hidden content or collapsible elements which should be expanded. 
      If you see additional inspection is print <EXPAND_DOM> tag in output.
      Print it if you see dropdowns, tabs, accordions, disclosure widgets, hamburger menus, "more/show" toggles, etc.
      It is important to write <EXPAND_DOM> if you see elmeents that needs additional inspection and do not navigate away from the current page.
      </task>
    `;

    const conversation = this.provider.startConversation(
      this.getSystemMessage()
    );
    conversation.addUserText(prompt);
    conversation.addUserText(expandDOMMessage);
    if (actionResult.screenshot) {
      conversation.addUserImage(actionResult.screenshot.toString('base64'));
    }

    const result = await this.provider.invokeConversation(conversation);
    if (!result) throw new Error('Failed to get response from provider');

    const { response } = result;

    const researchResults = [response.text];

    if (response.text.includes('<EXPAND_DOM>')) {
      conversation.addUserText(dedent`
        <task>
        Given the click and type tools expand the DOM elements that are not visible.
        Do not navigate away from the current page.
        After each click, re-check the updated HTML. Repeat until no new expandable content remains.
        </task>
      `);

      const result = await this.provider.invokeConversation(
        conversation,
        tools
      );
    }

    state.researchResult = response.text;

    const responseText = response.text;
    this.experienceTracker.writeExperienceFile(
      `reseach_${actionResult.getStateHash()}`,
      responseText,
      {
        url: actionResult.relativeUrl,
      }
    );
    debugLog('Research response:', responseText);
    tag('multiline').log(responseText);

    return responseText;
  }

  private buildResearchPrompt(
    actionResult: ActionResult,
    html: string
  ): string {
    const knowledgeFiles = this.stateManager.getRelevantKnowledge();

    let knowledge = '';
    if (knowledgeFiles.length > 0) {
      const knowledgeContent = knowledgeFiles
        .map((k) => k.content)
        .filter((k) => !!k)
        .join('\n\n');

      tag('substep').log(
        `Found ${knowledgeFiles.length} relevant knowledge file(s) for: ${actionResult.url}`
      );
      knowledge = `
        <hint>
        Here is relevant knowledge for this page:

        ${knowledgeContent}
        </hint>`;
    }

    return dedent`Analyze this web page and provide a comprehensive research report in markdown format.

    <rules>
    - Analyze the web page and provide a comprehensive research report.
    - Explain the main purpose of the page and what user can achieve from this page.
    - Focus on primary content and the primary navigation.
    - Provider either CSS or XPath locator but not both. Shortest locator is preferred.
    - Research all menus and navigational areas; expand hidden items to reveal full navigation. Ignore purely decorative sidebars and footer-only links.
    - Before writing the report, locate UI controls that reveal hidden content (dropdowns, accordions, disclosure widgets, hamburger menus, "more/show" toggles, tabs, toolbars, filters). Prefer elements with aria-controls/aria-expanded/role="button", data-toggle/data-target, classes like dropdown/menu/submenu/accordion/collapse/toggle/expander, or elements controlling [hidden]/visibility.
    - Use the click tool to toggle each such control once to reveal content. After each click, re-check the updated HTML. Repeat until no new expandable content remains. Avoid clicks that navigate away from the current page.
    </rules>

    <examples>
    Navigation-first expansion targets (examples):
    - "Hamburger menu" buttons: button[aria-label="Menu"], .navbar-toggler, .hamburger, [data-testid*="menu"]
    - Dropdown toggles in navbars: .navbar .dropdown-toggle, [aria-haspopup="menu"], [aria-expanded="false"][aria-controls]
    - Profile/user menus: [data-testid*="avatar"], [aria-controls*="menu"], .user-menu, .account-menu
    - "More"/"All" revealers: a:has-text("More"), button:has-text("All"), [data-toggle="dropdown"], [data-action*="expand"]
    - Tab controls: [role="tab"], .tabs .tab, [aria-selected="false"][role="tab"]
    - Side navigation accordions: .sidebar .accordion-button, [data-target*="collapse"], .menu .toggle, .sidenav .expander

    Tool usage examples (use the click tool):
    - click('.navbar-toggler')
    - click('.navbar .dropdown-toggle')
    - click('More')
    - click('[role="tab"][aria-selected="false"]')
    - click('.sidebar .accordion-button')
    </examples>

    URL: ${actionResult.url || 'Unknown'}
    Title: ${actionResult.title || 'Unknown'}

    HTML Content:
    ${html}

    ${knowledge}

    <output>
    Please provide a structured analysis in markdown format with the following sections:

    ## Summary

    Brief overview of the page purpose and main content.
    Identify the purpose of this page and what user can do on this page.

    ## User Goals

    List what user can achieve from this page.

    ## Functional Areas

    ### Menus & Navigation
    - Menu name: CSS/XPath locator
    - Example: "Main Navigation": "nav.main-menu" or "//nav[@class='main-menu']"

    ### Content
    - Content area name: CSS/XPath locator
    - Example: "Article Header": "h1.article-title" or "//h1[@class='article-title']"

    ### Buttons
    - Button name: CSS/XPath locator
    - Example: "Submit Button": "button[type='submit']" or "//button[@type='submit']"

    ### Forms
    - Form name: CSS/XPath locator
    - Example: "Login Form": "form#login" or "//form[@id='login']"

    ### Expanded Interactions
    - Control clicked: locator — revealed items/areas summary

    </output>

`;
  }
}
