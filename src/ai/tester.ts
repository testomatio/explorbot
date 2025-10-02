import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import type Explorer from '../explorer.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Note, Test } from './planner.ts';
import { Provider } from './provider.ts';
import { clearToolCallHistory, createCodeceptJSTools, toolAction } from './tools.ts';
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
    Your task is to execute testing scenario by interacting with web pages using available tools.
    </role>

    <task>
    You will be provided with scenario goal which should be achieved.
    Expected results will help you to achieve the scenario goal.
    Focus on achieving the main scenario goal
    Check expected results as an optional secondary goal, as they can be wrong or not achievable
    </task>

    <free_thinking_rule>
    Sometimes application can behave differently from expected.
    You must analyze differences between current and previous pages to understand if they match user flow and the actual behavior.
    If you notice sucessful message from application, log them with success() tool.
    If you notice failed message from application, log them with fail() tool.
    If you see that scenario goal can be achieved in unexpected way, continue testing call success() tool.
    If you notice any other message, log them with success() or fail() tool.
    If behavior is unexpected, and you assume it is an application bug, call fail() with explanation.
    If you notice error from application, call fail() with the error message.
    </free_thinking_rule>

    <approach>
    1. Provide reasoning for your next action in your response
    2. Analyze the current page state and identify elements needed for the scenario
    3. Plan the sequence of actions required to achieve the scenario goal or expected outcomes
    4. Execute actions step by step using the available tools
    5. After each action, check if any expected outcomes have been achieved or failed
    6. If expected outcome was verified call success(outcome="...") tool
    6.1 If expected outcome was already checked, to not check it again
    7. If expected outcome was not achieved call fail(outcome="...") tool
    7.1 If you have noticed an error message, call fail() with the error message
    7.2 If behavior is unexpected, and you assume it is an application bug, call fail() with explanation
    7.3 If there are error or failure message (identify them by class names or text) on a page call fail() with the error message
    8. Continue trying to achieve expected results
    8.1 Some expectations can be wrong so it's ok to skip them and continue testing
    9. Use reset() if you navigate too far from the desired state
    10. ONLY use stop() if the scenario is fundamentally incompatible with the page
    11. Be methodical and precise in your interactions
    </approach>

    <rules>
    - Check for success messages to verify if expected outcomes are achieved
    - Check for error messages to understand if there are issues
    - Verify if data was correctly saved and changes are reflected on the page
    - Always check current HTML of the page after your action
    - Call success() with the exact expected outcome text when verified as passed
    - Call fail() with the exact expected outcome text when it cannot be achieved or has failed
    - You can call success() or fail() multiple times for different outcomes
    - Always remember of INITIAL PAGE and use it as a reference point
    - Use reset() to navigate back to the initial page if needed
    - If your tool calling failed and your url is not the initial page, use reset() to navigate back to the initial page
    </rules>    
    `;
  }

  createTestFlowTools(task: Test, resetUrl: string) {
    return {
      reset: tool({
        description: dedent`
          Reset the testing flow by navigating back to the original page. 
          Use this when navigated too far from the desired state and 
          there's no clear path to achieve the expected result. This restarts the 
          testing flow from a known good state.
        `,
        inputSchema: z.object({
          reason: z.string().optional().describe('Explanation why you need to navigate'),
        }),
        execute: async () => {
          if (this.explorer.getStateManager().getCurrentState()?.url === resetUrl) {
            return {
              success: false,
              message: 'Reset failed - already on initial page!',
              suggestion: 'Try different approach or use stop() tool if you think the scenario is fundamentally incompatible with the page.',
              action: 'reset',
            };
          }
          task.addNote('Resetting to initial page');
          return await toolAction(this.explorer.createAction(), (I) => I.amOnPage(resetUrl), 'reset', {})();
        },
      }),
      stop: tool({
        description: dedent`
          Stop the current test because the scenario is completely irrelevant to the current page.
          ONLY use this when you determine that NONE of the expected outcomes can possibly be achieved
          because the page does not support the scenario at all.

          DO NOT use this if:
          - You're having trouble finding the right elements (try different locators instead)
          - Some outcomes were achieved but not all (the test will be marked successful anyway)
          - You need to reset and try again (use reset() instead)

          Use this ONLY when the scenario is fundamentally incompatible with the page.
        `,
        inputSchema: z.object({
          reason: z.string().describe('Explanation of why the scenario is irrelevant to this page'),
        }),
        execute: async ({ reason }) => {
          const message = `Test stopped - scenario is irrelevant: ${reason}`;
          tag('warning').log(`❌ ${message}`);

          task.addNote(message, 'failed', true);
          task.finish();

          return {
            success: true,
            action: 'stop',
            message: 'Test stopped - scenario is irrelevant: ' + reason,
          };
        },
      }),
      success: tool({
        description: dedent`
          Call this tool if one of the expected result has been successfully achieved.
          You can call this multiple times if multiple expected result are successfully achieved.
        `,
        inputSchema: z.object({
          outcome: z.string().describe('The exact expected outcome text that was achieved'),
        }),
        execute: async ({ outcome }) => {
          tag('success').log(`✔ ${outcome}`);
          task.addNote(outcome, 'passed', true);

          task.updateStatus();
          if (task.isComplete()) {
            task.finish();
          }

          return {
            success: true,
            action: 'success',
            suggestion: 'Continue testing to check the remaining expected outcomes. ' + task.getRemainingExpectations().join(', '),
          };
        },
      }),
      fail: tool({
        description: dedent`
          Call this tool if one of the expected result cannot be achieved or has failed.
          You can call this multiple times if multiple expected result have failed.
        `,
        inputSchema: z.object({
          outcome: z.string().describe('The exact expected outcome text that failed'),
        }),
        execute: async ({ outcome }) => {
          tag('warning').log(`✘ ${outcome}`);
          task.addNote(outcome, 'failed', true);

          task.updateStatus();
          if (task.isComplete()) {
            task.finish();
          }

          return {
            success: true,
            action: 'fail',
            suggestion: 'Continue testing to check the remaining expected outcomes:' + task.getRemainingExpectations().join(', '),
          };
        },
      }),
    };
  }

  async test(task: Test, url?: string): Promise<{ success: boolean }> {
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) throw new Error('No state found');

    if (!url) url = task.startUrl;
    if (url && state.url !== url) {
      await this.explorer.visit(url);
    }

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
    conversation.autoTrimTag('initlal_page', 100_000);
    if (conversation.hasTag('expanded_ui_map')) {
      conversation.addUserText(dedent`
        When dealing with elements from <expanded_ui_map> ensure they are visible. 
        Call the same codeblock to make them visible.
        <ui_map> and <expanded_ui_map> are relevant only for initial page or similar pages.
      `);
    }

    debugLog('Starting test execution with tools');

    let lastResponse = '';

    clearToolCallHistory();
    task.start();

    this.explorer.trackSteps(true);
    await loop(
      async ({ stop, iteration }) => {
        debugLog(`Test ${task.scenario} iteration ${iteration}`);

        if (iteration > 1) {
          const newState = this.explorer.getStateManager().getCurrentState()!;
          const newActionResult = ActionResult.fromState(newState);

          if (this.explorer.getStateManager().isInDeadLoop()) {
            task.addNote('Dead loop detected. Stopped', 'failed');
            stop();
            return;
          }

          // to keep conversation compact we remove old HTMLs
          conversation.cleanupTag('page_html', '...cleaned HTML...', 2);

          const remaining = task.getRemainingExpectations();
          const achieved = task.getCheckedExpectations();

          let outcomeStatus = '';
          if (achieved.length > 0) {
            outcomeStatus = `\AAlready checked: ${achieved.join(', ')}. DO NOT TEST THIS AGAIN`;
          }
          if (remaining.length > 0) {
            outcomeStatus += `\nExpected steps to check: ${remaining.join(', ')}`;
          }

          const retryPrompt = dedent`
            Continue testing to check the expected results.

            ${outcomeStatus}

            ${achieved.length > 0 ? `Already checked expectations. DO NOT CHECK THEM AGAIN:\n<checked_expectations>\n${achieved.join('\n- ')}\n</checked_expectations>` : ''}

            ${remaining.length > 0 ? `Expected steps to check:\nTry to check them and list your findings\n\n<remaining_expectations>\n${remaining.join('\n- ')}\n</remaining_expectations>` : ''}

            Provide your reasoning for the next action in your response.
          `;

          if (actionResult.isSameUrl({ url: newState.url })) {
            const diff = htmlDiff(actionResult.html, newState.html ?? '', ConfigParser.getInstance().getConfig().html);
            if (diff.added.length > 0) {
              conversation.addUserText(dedent`
                ${retryPrompt}
                The page has changed. The following elements have been added:
                <page_html>
                ${await minifyHtml(diff.subtree)}
                </page_html>
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
              The page state has changed. Here is the change page

              <page>
                <page_summary>
                ${await newActionResult.toAiContext()}
                </page_summary>
                <page_html>
                ${await newActionResult.combinedHtml()}
                </page_html>
              </page>

              When calling click() and type() tools use only HTML provided in <page_html> context.
              If you don't see element you need to interact with -> call reset() to navigate back.
            `);
          }
        }

        const result = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'required',
        });

        if (task.hasFinished) {
          stop();
          return;
        }

        if (!result) throw new Error('Failed to get response from provider');

        lastResponse = result.response.text;

        if (lastResponse) {
          task.addNote(lastResponse);
        }

        if (iteration >= this.MAX_ITERATIONS) {
          task.addNote('Max iterations reached. Stopped');
          stop();
          return;
        }
      },
      {
        maxAttempts: this.MAX_ITERATIONS,
        catch: async ({ error, stop }) => {
          task.status = 'failed';
          tag('error').log(`Test execution error: ${error}`);
          debugLog(error);
          stop();
        },
      }
    );

    this.explorer.trackSteps(false);
    this.finishTest(task);

    return {
      success: task.isSuccessful,
      ...task,
    };
  }

  private async buildTestPrompt(task: Test, actionResult: ActionResult): Promise<string> {
    const knowledgeFiles = this.explorer.getKnowledgeTracker().getRelevantKnowledge(actionResult);

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

    const research = await new Researcher(this.explorer, this.provider).research();

    const html = await actionResult.combinedHtml();

    return dedent`
      <task>
      Execute the following testing scenario using the available tools (click, type, reset, success, fail, and stop).

      SCENARIO GOAL: ${task.scenario}

      EXPECTED RESULTS:
      Check expected results one by one.
      But some of them can be wrong so it's ok to skip them and continue testing.

      <expected_results>
      ${task.expected.map((e) => `- ${e}`).join('\n')}
      </expected_results>

      Your goal is to perform actions on the web page and verify the expected outcomes.
      - Call success(outcome="exact outcome text") each time you verify an expected outcome
      - Call fail(outcome="exact outcome text") each time an expected outcome cannot be achieved
      - You can check multiple outcomes - call success() or fail() for each one verified
      - The test succeeds if at least one outcome is achieved
      - Only call stop() if the scenario is completely irrelevant to this page
      - Each tool call will return the updated page state

      IMPORTANT: Provide reasoning for each action you take in your response text before calling tools.
      </task>

      <initial_page>
      INITIAL URL: ${actionResult.url}

      <initial_page_summary>
      ${actionResult.toAiContext()}
      </initial_page_summary>

      <initial_page_knowledge>
      THIS IS IMPORTANT INFORMATION FROM SENIOR QA ON THIS PAGE
      ${knowledge}
      </initial_page_knowledge>

      <initial_page_ui_map>
      ${research}
      </initial_page_ui_map>

      <initial_page_html>
      ${html}
      </initial_page_html>
      </initial_page>


      <rules>
      - Use only elements that exist in the provided HTML
      - Use click() for buttons, links, and clickable elements
      - Use force: true for click() if the element exists in HTML but is not clickable
      - Use type() for text input (with optional locator parameter)
      - Use reset() to navigate back to the original page if needed
      - Call success(outcome="exact text") when you verify an expected outcome as passed
      - Call fail(outcome="exact text") when an expected outcome cannot be achieved or has failed
      - ONLY call stop() if the scenario is completely irrelevant to this page and no expectations can be achieved
      - Be precise with locators (CSS or XPath)
      - Each tool returns the new page state automatically
      - Always provide reasoning in your response text before calling tools
      </rules>
    `;
  }

  private finishTest(task: Test): void {
    task.finish();
    tag('info').log(`${this.emoji} Finished testing: ${task.scenario}`);
    task.getCheckedNotes().forEach((note: Note) => {
      let icon = '?';
      if (note.status === 'passed') icon = '✔';
      if (note.status === 'failed') icon = '✘';
      tag('substep').log(`${icon} ${note.message}`);
    });
  }
}
