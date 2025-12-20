import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { join } from 'node:path';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import { ConfigParser } from '../config.ts';
import type Explorer from '../explorer.ts';
import type { StateTransition, WebPageState } from '../state-manager.ts';
import type { Note, Test } from '../test-plan.ts';
import { codeToMarkdown, minifyHtml } from '../utils/html.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import { Provider } from './provider.ts';
import { Researcher } from './researcher.ts';
import { protectionRule } from './rules.ts';
import { createCodeceptJSTools } from './tools.ts';
import type { Conversation } from './conversation.ts';

const debugLog = createDebug('explorbot:tester');

export class Tester implements Agent {
  emoji = '🧪';
  private explorer: Explorer;
  private provider: Provider;

  MAX_ITERATIONS = 30;
  ACTION_TOOLS = ['click', 'type', 'clickXY', 'form'];
  ASSERTION_TOOLS = ['verify'];
  researcher: Researcher;
  agentTools: any;
  executionLogFile: string | null = null;

  constructor(explorer: Explorer, provider: Provider, researcher: Researcher, agentTools?: any) {
    this.explorer = explorer;
    this.provider = provider;
    this.researcher = researcher;
    this.agentTools = agentTools;
  }

  async test(task: Test): Promise<{ success: boolean }> {
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) throw new Error('No state found');

    tag('info').log(`Testing scenario: ${task.scenario}`);
    setActivity(`🧪 Testing: ${task.scenario}`, 'action');

    const initialState = ActionResult.fromState(state);

    const conversation = this.provider.startConversation(this.getSystemMessage(), 'tester');

    const outputDir = ConfigParser.getInstance().getOutputDir();
    this.executionLogFile = join(outputDir, `tester_${task.sessionName}.md`);
    // Note: Markdown saving functionality removed from Conversation class

    const initialPrompt = await this.buildTestPrompt(task, initialState);
    conversation.addUserText(initialPrompt);
    // Note: autoTrimTag and hasTag functionality removed from Conversation class
    if (false) {
      // Disabled since hasTag was removed
      conversation.addUserText(dedent`
            When dealing with elements from <expanded_ui_map> ensure they are visible.
            Call the same codeblock to make them visible.
            <ui_map> and <expanded_ui_map> are relevant only for initial page or similar pages.
          `);
    }

    debugLog('Starting test execution with tools');

    task.start();
    await this.explorer.startTest(task);

    if (task.startUrl !== initialState.url) {
      debugLog(`Navigating to ${task.startUrl}`);
      await this.explorer.visit(task.startUrl!);
    }

    const offStateChange = this.explorer.getStateManager().onStateChange((event: StateTransition) => {
      if (event.toState?.url === event.fromState?.url) return;
      task.addNote(`Navigated to ${event.toState?.url}`, 'passed');
      task.states.push(event.toState);
    });

    const codeceptjsTools = createCodeceptJSTools(this.explorer.createAction(), (note) => task.addNote(note));
    let actionPerformed = true;
    let assertionPerformed = false;
    const toolCallsLog: any[] = [];
    await loop(
      async ({ stop, pause, iteration }) => {
        debugLog('iteration', iteration);
        const currentState = ActionResult.fromState(this.explorer.getStateManager().getCurrentState()!);

        const tools = Object.fromEntries(
          Object.entries({
            ...codeceptjsTools,
            ...this.createTestFlowTools(task, currentState, conversation),
            ...this.agentTools,
          }).filter(([tool]) => {
            if (!this.provider.hasVision() && tool === 'clickXY') return false;
            return true;
          })
        );

        debugLog(`Test ${task.scenario} iteration ${iteration}`);

        await this.explorer.switchToMainFrame();

        if (this.explorer.getStateManager().isInDeadLoop()) {
          task.addNote('Dead loop detected. Stopped', 'failed');
          stop();
          return;
        }

        conversation.cleanupTag('page_aria', '...cleaned aria snapshot...', 2);
        conversation.cleanupTag('page_html', '...cleaned HTML snapshot...', 1);

        if (iteration > 1 && actionPerformed) {
          let nextStep = '';
          nextStep += await this.prepareInstructionsForNextStep(task);
          nextStep += await this.prepareContextForNextStep(currentState);
          if (iteration % 5 === 0) {
            nextStep += await this.analyzeProgress(task, currentState, toolCallsLog);
          }
          conversation.addUserText(nextStep);
        }

        const result = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'required',
        });

        if (!result) throw new Error('Failed to get response from provider');

        debugLog('tool executions:', result?.toolExecutions?.map((execution: any) => execution.toolName).join(', '));

        const toolNames = result?.toolExecutions?.filter((execution: any) => execution.wasSuccessful)?.map((execution: any) => execution.toolName) || [];
        actionPerformed = !!toolNames.find((toolName: string) => this.ACTION_TOOLS.includes(toolName));
        assertionPerformed = !!toolNames.find((toolName: string) => this.ASSERTION_TOOLS.includes(toolName));
        const wasSuccessful = result?.toolExecutions?.every((execution: any) => execution.wasSuccessful);

        if (actionPerformed) {
          toolCallsLog.push(...(result?.toolExecutions || []));
        }

        if (actionPerformed && wasSuccessful) {
          conversation.addUserText(await this.promptLogStep(task));
          await this.provider.invokeConversation(conversation, tools, { toolChoice: 'required' });
        }

        if (assertionPerformed && wasSuccessful) {
          const message = result?.toolExecutions?.find((execution: any) => execution.toolName === 'verify')?.output?.message || '';
          task.addNote(`Assertion passed: ${message}`, 'passed');
          conversation.addUserText(dedent`
                Assertion succesfully passed: ${message}

                Do not perform assertion again, proceed with testing and call actions to achieve the scenario goal or expected outcomes.
              `);
        }

        if (task.hasFinished) {
          stop();
          return;
        }

        if (iteration >= this.MAX_ITERATIONS) {
          task.addNote('Max iterations reached. Stopped');
          stop();
          return;
        }
      },
      {
        maxAttempts: this.MAX_ITERATIONS,
        observability: {
          agent: 'tester',
          sessionId: task.sessionName,
        },
        catch: async ({ error, stop }) => {
          tag('error').log(`Test execution error: ${error}`);
          // debugLog(error);
          stop();
        },
      }
    );

    await this.finalReview(task);
    offStateChange();
    await this.finishTest(task);
    this.explorer.stopTest(task);

    return {
      success: task.isSuccessful,
      ...task,
    };
  }

  private async prepareContextForNextStep(currentState: ActionResult): Promise<string> {
    const stateManager = this.explorer.getStateManager();
    const previousState = stateManager.getPreviousState();
    const isSameUrl = previousState?.url === currentState.url;

    if (!isSameUrl || !previousState) {
      debugLog(`Page state has changed. Researching ${currentState.url}`);
      const newResearch = await this.researcher.research(currentState);
      return dedent`
        The page state has changed. Here is the new page

        <page>
          CURRENT URL: ${currentState.url}

          PAGE STATE:
          <page_summary>
          ${codeToMarkdown(currentState.toAiContext())}
          </page_summary>

          <page_ui_map>
          ${newResearch}
          </page_ui_map>
        </page>

        Use accessibility tree data from <page_aria> to understand page structure.
        Use HTML from <page_html> to understand page structure.
      `;
    }

    const diff = await currentState.diff(ActionResult.fromState(previousState));
    await diff.calculate();
    debugLog(`Page has changed. Diffing ${currentState.url}`, diff.ariaChanged);

    if (!diff.hasChanges()) {
      return dedent`

         Page did not change from previous state. ${currentState.url}
        
        Current Page State:
        
        <page_summary>
        ${codeToMarkdown(currentState.toAiContext())}
        </page_summary>

        <page_html>
        ${codeToMarkdown(await minifyHtml(await currentState.combinedHtml()))}
        </page_html>
      `;
    }

    if (diff.ariaChanged) {
      return dedent`
        The page has changed.

        Accessibility tree changes:
        <aria_changes>
        ${diff.ariaChanged}
        </aria_changes>

        Current Page State:
        <page_summary>
        ${currentState.toAiContext()}
        </page_summary>

        <task>
        If this change is expected and is relevant to scenario goal, use verify() tool to ensure the action was successful.
        Then continue testing and perform next actions.
        </task>
      `;
    }

    return dedent`
      The page has changed but accessibility tree shows no significant changes.

      Current Page State:
      <page_summary>
      ${codeToMarkdown(currentState.toAiContext())}
      </page_summary>

      <page_html>
      ${codeToMarkdown(await minifyHtml(diff.htmlSubtree))}
      </page_html>
    `;
  }

  private async prepareInstructionsForNextStep(task: Test): Promise<string> {
    let outcomeStatus = dedent`
      <task>
        Continue testing to achieve the scenario goal or expected outcomes.
      </task>
  
      <rules>
      Use tools ${this.ACTION_TOOLS.join(', ')} to interact with the page.
      Do not do unsuccesful clicks again.
      Do not run same tool calls with same parameters again.
      </rules>
    `;

    if (task.getPrintableNotes()) {
      outcomeStatus = dedent`
        Your current log:
        <notes>
        ${task.notesToString()}
        </notes>
      `;
    }

    const remaining = task.getRemainingExpectations();
    if (remaining.length > 0) {
      outcomeStatus += `\nExpected steps to check: ${remaining.join(', ')}`;
    }

    return outcomeStatus;
  }

  private async promptLogStep(task: Test): Promise<string> {
    let logPrompt = dedent`
      <task>
        Add a note explaining what you achieved with previous action.
        Use tools to interact with the page to achieve the scenario goal or expected outcomes.
        Call record tool to explain the last action
        Format: record([<action performed>, <what has changed>, <what you expect to do next>]) 
      </task>
    `;

    if (task.getPrintableNotes()) {
      logPrompt = dedent`
        Your interaction log notes:
        <notes>
        ${task.getPrintableNotes()}
        </notes>

        <rules>
        Use your previous interaction notes to guide your next actions.
        Do not perform the same checks.
        </rules>
      `;
    }

    const remaining = task.getRemainingExpectations();
    if (remaining.length > 0) {
      logPrompt += `\nExpected steps to check: ${remaining.join(', ')}`;
    }

    return logPrompt;
  }

  private finishTest(task: Test): void {
    task.finish();
    tag('info').log(`Finished: ${task.scenario}`);

    tag('multiline').log(task.getPrintableNotes());
    if (task.isSuccessful) {
      tag('success').log(`Test ${task.scenario} successful`);
    } else if (task.hasFailed) {
      tag('error').log(`Test ${task.scenario} failed`);
    } else {
      tag('warning').log(`Test ${task.scenario} completed`);
    }
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

    <approach>
    1. Provide explanation for your next action in your response
    2. Analyze the current page state and identify elements needed for the scenario
    3. Plan the sequence of actions required to achieve the scenario goal or expected outcomes
    4. Execute actions step by step using the available tools
    5. After each action, check if any expected outcomes have been achieved or failed
    5.1 If you see page changed interact with that page to achieve a result
    5.2 Always look for the current URL you are on and use only elements that exist in the current page
    5.3 If you see the page is irrelevant to current scenario, call reset() tool to return to the initial page
    6. If expected outcome was verified call record({ notes: ["..."], status: "success" }) tool
    6.1 If expected outcome was already checked, to not check it again
    7. If expected outcome was not achieved call record({ notes: ["..."], status: "fail" }) tool
    7.1 If you have noticed an error message, call record({ notes: ["error message"], status: "fail" })
    7.2 If behavior is unexpected, and you assume it is an application bug, call record({ notes: ["explanation"], status: "fail" })
    7.3 If there are error or failure message (identify them by class names or text) on a page call record({ notes: ["error message"], status: "fail" })
    8. Continue trying to achieve expected results
    8.1 Some expectations can be wrong so it's ok to skip them and continue testing
    9. Use reset() if you navigate too far from the desired state
    10. Use finish() when all goals are achieved and verified
    11. ONLY use stop() if the scenario is fundamentally incompatible with the initial page and other pages you visited
    12. Be methodical and precise in your interactions
    </approach>

    <rules>
    - Check for success messages to verify if expected outcomes are achieved
    - Check for error messages to understand if there are issues
    - Verify if data was correctly saved and changes are reflected on the page
    - By default, you receive accessibility tree data which shows interactive elements and page structure
    - Understand current context by following <page_summary>, <page_aria>, and <page_ui_map>
    - Use the page your are on to achieve expected results
    - Use reset() to navigate back to the initial page if needed
    - When you see form with inputs, use form() tool to fill its values it
    - Before submitting form, check all inputs were filled in correctly using see() tool
    - When you interact with form with inputs, ensure that you click corresponding button to save its data.

    </rules>

    <free_thinking_rule>
    You primary focus to achieve the SCENARIO GOAL
    Expected results were pre-planned and may be wrong or not achievable
    As much as possible use record({ notes: ["..."] }) to document your findings, observations, and plans during testing.
    If you see that scenario goal can be achieved in unexpected way, call record({ notes: ["..."] }) and continue
    You may navigate to different pages to achieve expected results.
    You may interact with different pages to achieve expected results.
    While page is relevant to scenario it is ok to use its elements or try to navigate from it.
    If behavior is unexpected, and irrelevant to scenario, but you assume it is an application bug, call record({ notes: ["explanation"], status: "fail" }).
    If you have succesfully achieved some unexpected outcome, call record({ notes: ["exact outcome text"], status: "success" })
    </free_thinking_rule>
    `;
  }

  private async analyzeProgress(task: Test, actionResult: ActionResult, toolCallsLog: any[]): Promise<string> {
    const notes = task.getPrintableNotes() || 'No notes recorded yet.';
    const schema = z.object({
      assessment: z.string().describe('Short review of current progress toward the main scenario goal'),
      suggestion: z.string().describe('Specific next action recommendation'),
    });

    const model = this.provider.getModelForAgent('tester');
    const response = await this.provider.generateObject(
      [
        {
          role: 'system',
          content: dedent`
            You are senior QA Tester analyst which analyzes ongoing testing session
          `,
        },
        {
          role: 'user',
          content: dedent`
            SCENARIO GOAL: ${task.scenario}
            CURRENT URL: ${actionResult.url}

            <task>
            Analyze if the current actions align with the main scenario goal and propose next steps.
            Check if the current actions are aligned with the main scenario goal.
            If there are unsuccessful steps, suggest a different approach to achieve the main scenario goal.
            Provide a short comprehensive assessment of the current progress.
            Provide suggestions for next steps.
            </task>

            <rules>
            - Check if the current actions are aligned with the main scenario goal.
            - If there are failures accessing elements, suggest to use see() tool to analyze the page.
            - If goal was already achieved and verified suggest finishing the test with finish() tool.
            - If no progress is made, suggest to use reset() tool to navigate back to the initial page.
            - If test has no progress for too long, suggest to use stop() tool to stop the test.
            </rules>

            <current_state>
            ${await actionResult.toAiContext()}
            </current_state>

            <notes>
            ${notes}
            </notes>

            <called_tools>
            ${toolCallsLog.map((tool) => `- ${JSON.stringify(tool)}`).join('\n')}
            </called_tools>

            Provide a short assessment, suggest the next best action, and indicate if reset() is recommended.
          `,
        },
      ],
      schema,
      model
    );

    const result = response?.object;
    if (!result) return '';

    const recommendation = result.recommendReset ? 'AI suggests considering reset() before proceeding.' : '';
    const report = dedent`
      Progress checkpoint after ${toolCallsLog.length} tool calls:
      ${result.assessment}
      Next suggestion: ${result.suggestion}
      ${recommendation}
    `;

    task.addNote(result.assessment);
    return report;
  }

  private async finalReview(task: Test): Promise<void> {
    const notes = task.notesToString() || 'No notes recorded.';
    const schema = z.object({
      summary: z.string().describe('Concise overview of the test findings'),
      scenarioAchieved: z.boolean().describe('Indicates if the scenario goal appears satisfied'),
      recommendation: z.string().optional().describe('Follow-up suggestion if needed'),
    });

    const model = this.provider.getModelForAgent('tester');
    const response = await this.provider.generateObject(
      [
        {
          role: 'system',
          content: dedent`
            You evaluate exploratory test notes.
            Summarize findings and decide whether the main scenario goal is fulfilled.
          `,
        },
        {
          role: 'user',
          content: dedent`
            Scenario: ${task.scenario}

            <notes>
            ${notes}
            </notes>

            <steps>
            ${Object.values(task.steps)
              .map((s) => `- ${s}`)
              .join('\n')}
            </steps>

            Based on the notes check if the scenario goal was actually accomplished.
            Write a brief one line summary (one line only) to summarize the test findings.
          `,
        },
      ],
      schema,
      model
    );

    const result = response?.object;
    if (!result) return;

    task.summary = result.summary;
    if (result.scenarioAchieved) {
      task.addNote(result.summary, 'passed');
    } else {
      task.addNote(result.summary);
    }

    if (result.recommendation) {
      task.addNote(result.recommendation);
    }
  }

  private getKnowledge(actionResult: ActionResult): string {
    const knowledgeFiles = this.explorer.getKnowledgeTracker().getRelevantKnowledge(actionResult);

    if (knowledgeFiles.length > 0) {
      const knowledgeContent = knowledgeFiles
        .map((k) => k.content)
        .filter((k) => !!k)
        .join('\n\n');

      tag('substep').log(`Found ${knowledgeFiles.length} relevant knowledge file(s)`);
      return dedent`
        <hint>
        Here is relevant knowledge for this page:

        ${knowledgeContent}
        </hint>
      `;
    }

    return '';
  }

  private async buildTestPrompt(task: Test, actionResult: ActionResult): Promise<string> {
    const knowledge = this.getKnowledge(actionResult);

    const research = await this.researcher.research(actionResult);

    const html = await actionResult.combinedHtml();

    return dedent`
      <task>
      Execute the following testing scenario using the available tools (click, type, reset, record, finish, and stop).

      SCENARIO GOAL: ${task.scenario}

      EXPECTED RESULTS:
      Check expected results one by one.
      But some of them can be wrong so it's ok to skip them and continue testing.

      <expected_results>
      ${task.expected.map((e) => `- ${e}`).join('\n')}
      </expected_results>

      Your goal is to perform actions on the web page and verify the expected outcomes.
      - Call record({ notes: ["exact outcome text"] }) each time you perform action towards the step goal
      - Call record({ notes: ["exact outcome text"], status: "success" }) each time you verify an expected outcome
      - Call record({ notes: ["exact outcome text"], status: "fail" }) each time an expected outcome cannot be achieved
      - You can check multiple outcomes - call record() for each one verified
      - The test succeeds if at least one outcome is achieved
      - Call finish() when all goals are achieved and verified
      - Only call stop() if the scenario is completely irrelevant to this page
      - Each tool call will return the updated page state

      IMPORTANT: Provide explanation for each action you take in your response text before calling tools.
      </task>

      <initial_page>
      INITIAL URL: ${actionResult.url}

      <initial_page_summary>
      ${codeToMarkdown(actionResult.toAiContext())}
      </initial_page_summary>

      <initial_page_knowledge>
      THIS IS IMPORTANT INFORMATION FROM SENIOR QA ON THIS PAGE
      ${knowledge}
      </initial_page_knowledge>

      <initial_page_ui_map>
      ${research}
      </initial_page_ui_map>

      </initial_page>

      <rules>
      - Use only elements that exist in the provided accessibility tree or HTML
      - Use click() for buttons, links, and clickable elements
      - Use type() for text input (with optional locator parameter)
      - Use form() for forms with multiple inputs
      - when creating or editing items via form() or type() and you have no restrictions on string values, prefer including ${task.sessionName} in the value
      - Systematically use record({ notes: ["..."] }) to write your findings, planned actions, observations, etc.
      - Use reset() to navigate back to ${actionResult.url} if needed. Do not call it if you are already on the initial page.
      - Call record({ notes: ["..."], status: "success" }) when you see success/info message on a page or when expected outcome is achieved
      - Call record({ notes: ["..."], status: "fail" }) when an expected outcome cannot be achieved or has failed or you see error/alert/warning message on a page
      - Call finish() when all goals are achieved and verified
      - ONLY call stop() if the scenario itself is completely irrelevant to this page and no expectations can be achieved
      - Be precise with locators (CSS or XPath)
      - Each click/type call returns the new page state automatically
      </rules>
    `;
  }

  private createTestFlowTools(task: Test, currentState: ActionResult, conversation: Conversation) {
    const resetUrl = task.startUrl;
    const visitedUrls = task.getVisitedUrls();
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
        execute: async ({ reason }) => {
          if (this.explorer.getStateManager().getCurrentState()?.url === resetUrl!) {
            return {
              success: false,
              message: 'Reset failed - already on initial page!',
              suggestion: 'Try different approach or use stop() tool if you think the scenario is fundamentally incompatible with the page.',
              action: 'reset',
            };
          }
          const explanation = reason ? `${reason} (RESET)` : 'Resetting to initial page';
          const targetUrl = resetUrl!;
          task.addNote(explanation);
          const resetAction = this.explorer.createAction();
          const success = await resetAction.attempt((I) => I.amOnPage(targetUrl), explanation);

          if (success) {
            return {
              success: true,
              action: 'reset',
              message: `Navigated back to ${targetUrl}`,
              explanation,
            };
          }

          const result: any = {
            success: false,
            action: 'reset',
            message: `Failed to navigate back to ${targetUrl}`,
            suggestion: 'Try navigating manually or use stop() if the scenario can no longer continue.',
            explanation,
          };

          if (resetAction.lastError) {
            result.error = resetAction.lastError.toString();
          }

          return result;
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

          task.addNote(message, 'failed');
          task.finish();

          return {
            success: true,
            action: 'stop',
            message: `Test stopped - scenario is irrelevant: ${reason}`,
          };
        },
      }),
      finish: tool({
        description: dedent`
          Finish the current test successfully because all goals are achieved and verified.
          ONLY use this when you have successfully completed the scenario goal and verified that
          all expected outcomes have been achieved.

          Use this when:
          - The main scenario goal has been successfully achieved
          - All expected outcomes have been verified and recorded
          - You have confirmed that the test objectives are complete

          DO NOT use this if:
          - Only some outcomes were achieved (continue testing to achieve remaining ones)
          - You're unsure if goals are met (use record() to verify first)
          - You haven't verified the outcomes yet
        `,
        inputSchema: z.object({}),
        execute: async () => {
          tag('success').log(`Test finished successfully`);
          task.addNote('Test finished successfully', 'passed');
          task.finish();

          return {
            success: true,
            action: 'finish',
            message: `Test finished successfully`,
          };
        },
      }),
      record: tool({
        description: dedent`
          Record test results, outcomes, or notes during testing.
          
          Notes must be SHORT - no longer than 10 words each.
          Be explicit: which action was done, which element interactied with
          
          Recommended format (3 notes):
          - "describe what action performed"
          - "describe what has changed"
          - "what you expect to do next"

          Use status="success" when:
          - One of the expected results has been successfully achieved
          - You see a success/info message on a page
          
          Use status="fail" when:
          - Expected result cannot be achieved or has failed
          - You see an error/alert/warning message on a page
          - You unsuccessfully tried multiple iterations and failed
          - If the expected result was expected to fail, use status="success" instead
          
          
          Example:
          - record({ notes: ["clicked login button", "login form appeared", "fill credentials"], status: "success" })
        `,
        inputSchema: z.object({
          notes: z.array(z.string()).describe('Array of notes to add. Each note must be short (max 15 words). Recommended format: "> ACT: ...", "> ASSERT: ...", "> PLAN: ..."'),
          status: z.enum(['fail', 'success']).optional().describe('Status: "success" for achieved outcomes, "fail" for failed outcomes, null for general notes'),
        }),
        execute: async (input) => {
          let mappedStatus: 'passed' | 'failed' | null = null;
          if (input.status === 'success') {
            mappedStatus = 'passed';
          } else if (input.status === 'fail') {
            mappedStatus = 'failed';
          }

          for (const noteText of input.notes) {
            task.addNote(noteText, mappedStatus);

            if (input.status === 'success') {
              tag('success').log(`✔ ${noteText}`);
            } else if (input.status === 'fail') {
              tag('warning').log(`✘ ${noteText}`);
            }
          }

          if (input.status !== null && task.isComplete()) {
            task.finish();
          }

          const remainingExpectations = task.getRemainingExpectations();
          // const suggestion = input.status !== null && remainingExpectations.length > 0 ? `Continue testing to check the remaining expected outcomes: ${remainingExpectations.join(', ')}` : 'Continue with your testing strategy based on these findings.';

          return {
            success: true,
            action: 'record',
            status: input.status,
            message: `Added ${input.notes.length} note(s)`,
            suggestion: 'Continue testing. Do not call record() tool again until you perform next actions',
          };
        },
      }),
    };
  }
}
