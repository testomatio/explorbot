import type { Provider } from './provider.js';
import { ActionResult } from '../action-result.js';
import type { StateManager } from '../state-manager.js';
import { tag, createDebug } from '../utils/logger.js';
import { setActivity } from '../activity.js';
import { WebPageState } from '../state-manager.js';
import { Conversation, Message } from './conversation.js';
import dedent from 'dedent';
import { ExperienceTracker } from '../experience-tracker.ts';

const debugLog = createDebug('explorbot:researcher');

export interface Task {
  scenario: string;
  status: 'pending' | 'completed' | 'failed';
  conversation: Conversation;
}

export class Researcher {
  private provider: Provider;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;

  constructor(provider: Provider, stateManager: StateManager) {
    this.provider = provider;
    this.stateManager = stateManager;
    this.experienceTracker = stateManager.getExperienceTracker();
  }

  getSystemMessage(): Message {
    const text = dedent`
    <role>
    You are senior QA focused on exploritary testig of web application.
    </role>
    `;
    return { role: 'system', content: [{ type: 'text', text }] };
  }

  async research(): Promise<Conversation> {
    const state = this.stateManager.getCurrentState();
    if (!state) throw new Error('No state found');

    const actionResult = ActionResult.fromState(state);
    const simplifiedHtml = await actionResult.simplifiedHtml();

    setActivity('🧑‍🔬 Researching...', 'action');
    debugLog('Researching web page:', actionResult.url);
    const prompt = this.buildResearchPrompt(actionResult, simplifiedHtml);

    const conversation = await this.provider.startConversation([
      this.getSystemMessage(),
      {
        role: 'user',
        content: [{
            type: 'text',
            text: prompt,
          },
          ...(actionResult.screenshot
            ? [
                {
                  type: 'image' as const,
                  image: actionResult.screenshot.toString('base64'),
                },
              ]
            : []),
        ],
      },
    ]);

    const responseText = conversation.getLastMessage();
    this.experienceTracker.writeExperienceFile(`reseach_${actionResult.getStateHash()}`, responseText, {
      url: actionResult.relativeUrl
    });
    debugLog('Research response:', responseText);
    tag('multiline').log('📡 Research:\n\n', responseText);

    return conversation;
  }

  async plan(conversation: Conversation): Promise<Task[]> {
    const state = this.stateManager.getCurrentState();
    debugLog('Planning:', state?.url);
    if (!state) throw new Error('No state found');

    const prompt = this.buildPlanningPrompt(state);

    setActivity('👨‍💻 Planning...', 'action');

    conversation.addUserText(prompt);

    debugLog('Sending planning prompt to AI provider');

    const response = await this.provider.followUp(conversation.id);
    if (!response) throw new Error('Failed to get planning response');
    
    const responseText = response.getLastMessage();
    debugLog('Planning response:', responseText);
    
    let tasks = this.parseTasks(responseText, conversation);
    
    if (tasks.length === 0) {
      conversation.addUserText(`Your response was not in the expected markdown list format. Please provide ONLY a markdown list of testing scenarios, one per line, starting with * or -.`);
      
      const newResponse = await this.provider.followUp(conversation.id);
      if (!newResponse) throw new Error('Failed to get correction response');
      
      const newResponseText = newResponse.getLastMessage();
      tasks = this.parseTasks(newResponseText, conversation);
    }

    tag('info').log('📋 Testing Plan');
    tasks.forEach((task) => {
      tag('info').log('☐', task.scenario);
    });

    return tasks;
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

    return dedent`Analyze this web page and provide a comprehensive research report.

    <rules>
        - Analyze the web page and provide a comprehensive research report.
        - Provider either CSS or XPath locator but not both. Shortest locator is preferred.
        - Focus in main content of the page, not in the menu, sidebar or footer.

    </rules>

    URL: ${actionResult.url || 'Unknown'}
    Title: ${actionResult.title || 'Unknown'}

    HTML Content:
    ${html}

    ${knowledge}

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

`;
  }

  private buildPlanningPrompt(state: WebPageState): string {
    return `
    <task>
    Based on the previous research, suggest 5-10 exploratory testing scenarios to test on this page.
    Start with positive scenarios and then move to negative scenarios.
    Focus on main content of the page, not in the menu, sidebar or footer.
    </task>

    <context>
    URL: ${state.url || 'Unknown'}
    Title: ${state.title || 'Unknown'}

    HTML:
    ${state.html}
    </context>

    <rules>
    Result must be a markdown list with bullet points.
    Each scenario should be a single sentence describing what to test.
    Each scenario should be on a new line starting with * or -.
    Do not include any other text in the response.
    </rules>

    <output_example>
    * Test user login functionality with valid credentials
    * Test user login functionality with invalid credentials
    * Test form validation for required fields
    * Test responsive design on different screen sizes
    * Test accessibility features and keyboard navigation
    </output_example>

    <output>
    * test 1
    * test 2
    * test 3
    * ...
    </output>
`;
  }

  private parseTasks(responseText: string, conversation: Conversation): Task[] {
    const lines = dedent(responseText).split('\n');
    const tasks: Task[] = [];

    for (const line of lines) {
      if (!line.match(/^[\*\-]\s+/)) continue;

        const scenario = line.replace(/^[\*\-]\s+/, '').trim();
        if (scenario) {
          tasks.push({
            scenario,
            status: 'pending',
            conversation: conversation.clone()
          });
        }
    }

    return tasks;
  }
}
