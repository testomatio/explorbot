import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type Explorer from '../explorer.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Task } from './planner.ts';
import { Provider } from './provider.ts';
import { createCodeceptJSTools, toolAction } from './tools.ts';
import { Researcher } from './researcher.ts';
import { htmlDiff } from '../utils/html-diff.ts';
import { ConfigParser } from '../config.ts';
import { minifyHtml } from '../utils/html.ts';

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

  createTestFlowTools(task: Task, resetUrl: string) {
    return {
      reset: tool({
        description: dedent`
          Reset the testing flow by navigating back to the original page. 
          Use this when navigated too far from the desired state and 
          there's no clear path to achieve the expected result. This restarts the 
          testing flow from a known good state.
        `,
        inputSchema: z.object({}),
        execute: async () => {
          tag('substep').log(`🔄 Reset Tool: reset()`);
          task.logs.push('Resetting to initial page');
          return await toolAction(this.explorer.createAction(), (I) => I.amOnPage(resetUrl), 'reset', {})();
        },
      }),
      stop: tool({
        description: dedent`
          Stop the current test and give up on achieving the expected outcome.
          Use this when the expected outcome cannot be achieved with the available
          Call this function if you are on the initial page and there's no clear path to achieve the expected outcome.
          If you are on a different page, use reset() to navigate back to the initial page and try again.
          If you already tried reset and it didn't help, give up and call this function to stop the test.
        `,
        inputSchema: z.object({
          reason: z.string().optional(),
        }),
        execute: async ({ reason }) => {
          reason = reason || 'Expected outcome cannot be achieved';
          const message = `Test stopped - expected outcome cannot be achieved: ${reason}`;
          tag('warning').log(`❌ ${message}`);

          task.status = 'failed';
          task.logs.push(message);

          return {
            success: true,
            action: 'stop',
            message: 'Test stopped - expected outcome cannot be achieved',
            stopped: true,
          };
        },
      }),
      success: tool({
        description: dedent`
          Mark the test as successful when the expected outcome has been achieved.
          Use this when you have successfully completed the testing scenario and 
          the expected outcome is visible on the page or confirmed through the actions taken.
        `,
        inputSchema: z.object({
          reason: z.string().optional(),
        }),
        execute: async ({ reason }) => {
          reason = reason || 'Expected outcome has been achieved';
          const message = `Test completed successfully: ${reason}`;
          tag('success').log(`✅ ${message}`);

          task.status = 'success';
          task.logs.push(message);

          return {
            success: true,
            action: 'success',
            message,
            completed: true,
          };
        },
      }),
    };
  }

  async test(task: Task): Promise<{ success: boolean; message: string }> {
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) throw new Error('No state found');

    tag('info').log(`Testing scenario: ${task.scenario}`);
    setActivity(`🧪 Testing: ${task.scenario}`, 'action');

    const actionResult = ActionResult.fromState(state);
    const tools = {
      ...createCodeceptJSTools(this.explorer.createAction()),
      ...this.createTestFlowTools(task, state.url),
    };

    const conversation = this.provider.startConversation(this.getSystemMessage());
    const initialPrompt = await this.buildTestPrompt(task, actionResult);
    conversation.addUserText(initialPrompt);

    debugLog('Starting test execution with tools');

    let success = false;
    let lastResponse = '';

    task.status = 'in_progress';
    task.logs.push('Test started');

    await loop(
      async ({ stop, iteration }) => {
        debugLog(`Test ${task.scenario} iteration ${iteration}`);

        if (iteration > 1) {
          const newState = this.explorer.getStateManager().getCurrentState()!;
          const newActionResult = ActionResult.fromState(newState);
          const retryPrompt = dedent`
            Continue testing if the expected outcome has not been achieved yet.
            Expected outcome: ${task.expectedOutcome}

            Current iteration: ${iteration}/${this.MAX_ITERATIONS}
          `;

          if (actionResult.isSameUrl({ url: newState.url })) {
            const diff = htmlDiff(actionResult.html, newState.html ?? '', ConfigParser.getInstance().getConfig().html);
            if (diff.added.length > 0) {
              conversation.addUserText(dedent`
                ${retryPrompt}
                The page has changed. The following elements have been added:
                <html>
                ${await minifyHtml(diff.subtree)}
                </html>
              `);
            } else {
              conversation.addUserText(dedent`
                ${retryPrompt}
                The page was not changed. No new elements were added
              `);
            }
          } else {
            conversation.addUserText(dedent`
              ${retryPrompt}
              The page state has changed. Here is the HTML of a new page:

              ${await newActionResult.toAiContext()}

              <html>
              ${await newActionResult.combinedHtml()}
              </html>
            `);
          }
        }

        const result = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'required',
        });

        if (task.status === 'success' || task.status === 'failed') {
          tag('info').log(`${this.emoji} Test completed: ${task.status}`);
          stop();
          return;
        }

        if (!result) throw new Error('Failed to get response from provider');

        lastResponse = result.response.text;

        if (iteration >= this.MAX_ITERATIONS) {
          const message = `${this.emoji} Max iterations reached without achieving outcome`;
          tag('warning').log(message);
          task.status = 'failed';
          task.logs.push(message);
          stop();
          return;
        }

        tag('substep').log(`${task.expectedOutcome} is not yet achieved, continuing...`);
      },
      {
        maxAttempts: this.MAX_ITERATIONS,
        catch: async (error) => {
          task.status = 'failed';
          tag('error').log(`Test execution error: ${error}`);
          debugLog(error);
        },
      }
    );

    return {
      success,
      ...task,
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

    knowledge += `\n\n${await new Researcher(this.explorer, this.provider).research()}`;

    const html = await actionResult.combinedHtml();

    return dedent`
      <task>
      Execute the following testing scenario using the available tools (click, type, reset, success, and stop).

      Scenario: ${task.scenario}
      Expected Outcome: ${task.expectedOutcome}
      Priority: ${task.priority}

      Your goal is to perform actions on the web page until the expected outcome is achieved.
      Use the click(), type(), reset(), success(), and stop() tools to interact with the page.
      Each tool call will return the updated page state.
      Always refer to HTML content of a page. Do not propose to use locators that are not in the HTML.
      When you achieve the expected outcome, call success() to complete the test.
      If you cannot achieve the expected outcome, call stop() to give up.
      </task>

      <approach>
      1. Analyze the current page state and identify elements needed for the scenario
      1.1. If no such elements are found, use stop() to give up.
      2. Plan the sequence of actions required
      3. Execute actions step by step using the available tools
      4. After each action, evaluate if the expected outcome has been achieved
      5. If achieved, call success() to complete the test
      6. If not achieved, continue with the next logical action
      7. Use reset() if you navigate too far from the desired state
      8. Use stop() if the expected outcome cannot be achieved
      9. Be methodical and precise in your interactions
      </approach>

      <rules>
      - check for successful messages to understand if the expected outcome has been achieved
      - check for error messages to understand if there was an issue achieving the expected outcome
      - check if data was correctly saved and this change is reflected on the page
      - always check current HTML of the page after your action to use locators that are in the HTML
      </rules>

      <current_page>
      URL: ${actionResult.url}
      Title: ${actionResult.title}

      ${html}
      
      </current_page>

      ${knowledge}

      <rules>
      - Use only elements that exist in the provided HTML
      - Use click() for buttons, links, and clickable elements
      - Use force: true for click() if the element exists in HTML but is not clickable
      - Use type() for text input (with optional locator parameter)
      - Use reset() to navigate back to the original page if needed
      - Use success() when you achieve the expected outcome
      - Use stop() to give up if the expected outcome cannot be achieved
      - Focus on achieving the expected outcome: ${task.expectedOutcome}
      - Be precise with locators (CSS or XPath)
      - Each tool returns the new page state automatically
      </rules>
    `;
  }
}
