import dedent from 'dedent';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type Explorer from '../explorer.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Task } from './planner.ts';
import { Provider } from './provider.ts';
import { createCodeceptJSTools } from './tools.ts';

const debugLog = createDebug('explorbot:tester');

export class Tester implements Agent {
  emoji = '🧪';
  private explorer: Explorer;
  private provider: Provider;

  MAX_ITERATIONS = 15;

  constructor(explorer: Explorer, provider: Provider) {
    this.explorer = explorer;
    this.provider = provider;
  }

  getSystemMessage(): string {
    return dedent`
    <role>
    You are a senior test automation engineer with expertise in CodeceptJS and exploratory testing.
    Your task is to execute testing scenarios by interacting with web pages using available tools.
    </role>
    `;
  }

  async test(task: Task): Promise<{ success: boolean; message: string }> {
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) throw new Error('No state found');

    tag('info').log(`Testing scenario: ${task.scenario}`);
    setActivity(`🧪 Testing: ${task.scenario}`, 'action');

    const actionResult = ActionResult.fromState(state);
    const tools = createCodeceptJSTools(this.explorer.actor);

    const conversation = this.provider.startConversation(this.getSystemMessage());
    const initialPrompt = await this.buildTestPrompt(task, actionResult);
    conversation.addUserText(initialPrompt);

    debugLog('Starting test execution with tools');

    let success = false;
    let lastResponse = '';

    await loop(
      async ({ stop, iteration }) => {
        debugLog(`Test iteration ${iteration}`);

        if (iteration > 1) {
          conversation.addUserText(dedent`
            Continue testing if the expected outcome has not been achieved yet.
            Expected outcome: ${task.expectedOutcome}

            Current iteration: ${iteration}/${this.MAX_ITERATIONS}
          `);
        }

        const result = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'required',
        });

        if (!result) throw new Error('Failed to get response from provider');

        lastResponse = result.response.text;

        const currentState = this.explorer.getStateManager().getCurrentState();
        if (!currentState) throw new Error('No state found after tool execution');
        const currentActionResult = ActionResult.fromState(currentState);

        const outcomeCheck = await this.checkExpectedOutcome(task.expectedOutcome, currentActionResult, lastResponse);

        if (outcomeCheck.achieved) {
          tag('success').log(`✅ Expected outcome achieved: ${task.expectedOutcome}`);
          success = true;
          stop();
          return;
        }

        if (iteration >= this.MAX_ITERATIONS) {
          tag('warning').log(`⚠️ Max iterations reached without achieving outcome`);
          stop();
          return;
        }

        tag('substep').log(`Outcome not yet achieved, continuing...`);
      },
      {
        maxAttempts: this.MAX_ITERATIONS,
        catch: async (error) => {
          tag('error').log(`Test execution error: ${error}`);
          debugLog(error);
        },
      }
    );

    return {
      success,
      message: success ? `Scenario completed: ${task.scenario}` : `Scenario incomplete after ${this.MAX_ITERATIONS} iterations`,
    };
  }

  private async buildTestPrompt(task: Task, actionResult: ActionResult): Promise<string> {
    const knowledgeFiles = this.explorer.getStateManager().getRelevantKnowledge();

    let knowledge = '';
    if (knowledgeFiles.length > 0) {
      const knowledgeContent = knowledgeFiles
        .map((k) => k.content)
        .filter((k) => !!k)
        .join('\n\n');

      tag('substep').log(`Found ${knowledgeFiles.length} relevant knowledge file(s)`);
      knowledge = dedent`
        <hint>
        Here is relevant knowledge for this page:

        ${knowledgeContent}
        </hint>
      `;
    }

    const researchResult = this.explorer.getStateManager().getCurrentState()?.researchResult || '';

    return dedent`
      <task>
      Execute the following testing scenario using the available tools (click and type).

      Scenario: ${task.scenario}
      Expected Outcome: ${task.expectedOutcome}
      Priority: ${task.priority}

      Your goal is to perform actions on the web page until the expected outcome is achieved.
      Use the click() and type() tools to interact with the page.
      Each tool call will return the updated page state.
      Continue making tool calls until you achieve the expected outcome.
      </task>

      <approach>
      1. Analyze the current page state and identify elements needed for the scenario
      2. Plan the sequence of actions required
      3. Execute actions step by step using the available tools
      4. After each action, evaluate if the expected outcome has been achieved
      5. If not achieved, continue with the next logical action
      6. Be methodical and precise in your interactions
      </approach>

      <rules>
      - check for successful messages to understand if the expected outcome has been achieved
      - check for error messages to understand if there was an issue achieving the expected outcome
      - check if data was correctly saved and this change is reflected on the page
      </rules>

      <current_page>
      URL: ${actionResult.url}
      Title: ${actionResult.title}

      ${researchResult ? `Research Context:\n${researchResult}\n` : ''}

      HTML:
      ${await actionResult.simplifiedHtml()}
      </current_page>

      ${knowledge}

      <rules>
      - Use only elements that exist in the provided HTML
      - Use click() for buttons, links, and clickable elements
      - Use type() for text input (with optional locator parameter)
      - Focus on achieving the expected outcome: ${task.expectedOutcome}
      - Be precise with locators (CSS or XPath)
      - Each tool returns the new page state automatically
      </rules>
    `;
  }

  private async checkExpectedOutcome(expectedOutcome: string, actionResult: ActionResult, aiResponse: string): Promise<{ achieved: boolean; reason: string }> {
    const prompt = dedent`
      <task>
      Determine if the expected outcome has been achieved based on the current page state and AI actions.
      </task>

      Expected Outcome: ${expectedOutcome}

      <current_state>
      URL: ${actionResult.url}
      Title: ${actionResult.title}
      AI Response: ${aiResponse}

      HTML:
      ${await actionResult.simplifiedHtml()}
      </current_state>

      <output>
      Respond with "YES" if the expected outcome has been achieved, or "NO" if it has not.
      Then provide a brief reason (one sentence).

      Format:
      YES/NO: <reason>
      </output>
    `;

    const response = await this.provider.chat([{ role: 'user', content: prompt }], { maxRetries: 1 });

    const text = response.text.trim();
    const achieved = text.toUpperCase().startsWith('YES');
    const reason = text.includes(':') ? text.split(':')[1].trim() : text;

    debugLog('Outcome check:', { achieved, reason });

    return { achieved, reason };
  }
}
