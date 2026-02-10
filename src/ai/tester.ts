import { join } from 'node:path';
import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { setActivity } from '../activity.ts';
import { ConfigParser } from '../config.ts';
import type { ExperienceTracker } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import type { StateTransition, WebPageState } from '../state-manager.ts';
import { Stats } from '../stats.ts';
import { type Note, type Test, TestResult, type TestResultType } from '../test-plan.ts';
import { extractFocusedElement } from '../utils/aria.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { codeToMarkdown } from '../utils/html.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import { Navigator } from './navigator.ts';
import type { Pilot } from './pilot.ts';
import { Provider } from './provider.ts';
import { Researcher } from './researcher.ts';
import { actionRule, focusedElementRule, locatorRule, multipleTabsRule, protectionRule, sectionContextRule } from './rules.ts';
import { TaskAgent } from './task-agent.ts';
import { createCodeceptJSTools } from './tools.ts';

const debugLog = createDebug('explorbot:tester');

export class Tester extends TaskAgent implements Agent {
  protected readonly ACTION_TOOLS = ['click', 'type', 'select', 'pressKey', 'form'];
  emoji = '🧪';
  private explorer: Explorer;
  private provider: Provider;
  private currentConversation: Conversation | null = null;
  private pilot: Pilot | null = null;

  MAX_ITERATIONS = 30;
  ASSERTION_TOOLS = ['verify'];
  researcher: Researcher;
  navigator: Navigator;
  agentTools: any;
  executionLogFile: string | null = null;
  private previousUrl: string | null = null;
  private previousStateHash: string | null = null;
  private hooksRunner: HooksRunner;

  constructor(explorer: Explorer, provider: Provider, researcher: Researcher, navigator: Navigator, agentTools?: any) {
    super();
    this.explorer = explorer;
    this.provider = provider;
    this.researcher = researcher;
    this.navigator = navigator;
    this.agentTools = agentTools;
    this.hooksRunner = new HooksRunner(explorer, explorer.getConfig());
  }

  protected getNavigator(): Navigator {
    return this.navigator;
  }

  protected getExperienceTracker(): ExperienceTracker {
    return this.explorer.getStateManager().getExperienceTracker();
  }

  protected getKnowledgeTracker() {
    return this.explorer.getKnowledgeTracker();
  }

  protected getProvider(): Provider {
    return this.provider;
  }

  setPilot(pilot: Pilot): void {
    this.pilot = pilot;
  }

  private get progressCheckInterval(): number {
    return (this.explorer.getConfig().ai?.agents?.tester as any)?.progressCheckInterval ?? 5;
  }

  getConversation(): Conversation | null {
    return this.currentConversation;
  }

  async test(task: Test): Promise<{ success: boolean }> {
    Stats.tests++;
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) throw new Error('No state found');

    tag('info').log(`Testing scenario: ${task.scenario}`);
    setActivity(`🧪 Testing: ${task.scenario}`, 'action');

    this.previousUrl = null;
    this.previousStateHash = null;
    this.explorer.getStateManager().clearHistory();
    this.resetFailureCount();
    this.pilot?.reset();

    const initialState = ActionResult.fromState(state);

    const conversation = this.provider.startConversation(this.getSystemMessage(), 'tester');
    this.currentConversation = conversation;

    const outputDir = ConfigParser.getInstance().getOutputDir();
    this.executionLogFile = join(outputDir, `tester_${task.sessionName}.md`);
    // Note: Markdown saving functionality removed from Conversation class

    const initialPrompt = await this.buildTestPrompt(task, initialState);
    conversation.addUserText(initialPrompt);

    debugLog('Starting test execution with tools');

    task.start();
    await this.explorer.startTest(task);

    debugLog(`Navigating to ${task.startUrl}`);
    await this.explorer.visit(task.startUrl!);

    const currentUrl = this.explorer.getStateManager().getCurrentState()?.url || task.startUrl || '';
    await this.hooksRunner.runBeforeHook('tester', currentUrl);

    const offStateChange = this.explorer.getStateManager().onStateChange((event: StateTransition) => {
      if (event.toState?.url === event.fromState?.url) return;
      task.addNote(`Navigated to ${event.toState?.url}`, TestResult.PASSED);
      task.states.push(event.toState);
    });

    const codeceptjsTools = createCodeceptJSTools(this.explorer, task);
    let assertionPerformed = false;
    await loop(
      async ({ stop, pause, iteration, userInput }) => {
        debugLog('iteration', iteration);
        const currentState = ActionResult.fromState(this.explorer.getStateManager().getCurrentState()!);

        const tools = {
          ...codeceptjsTools,
          ...this.createTestFlowTools(task, currentState, conversation),
          ...this.agentTools,
        };

        debugLog(`Test ${task.scenario} iteration ${iteration}`);

        if (this.explorer.getStateManager().isInDeadLoop()) {
          task.addNote('Dead loop detected. Stopped', TestResult.FAILED);
          stop();
          return;
        }

        if (userInput) {
          conversation.addUserText(dedent`
            <page>
            CURRENT URL: ${currentState.url}
            CURRENT TITLE: ${currentState.title}
            </page>

            <user_redirect>
            ${userInput}
            </user_redirect>

            The user has interrupted and wants to change direction. Follow the new instruction.
          `);
        }

        conversation.cleanupTag('page_aria', '...cleaned aria snapshot...', 2);
        conversation.cleanupTag('page_html', '...cleaned HTML snapshot...', 1);

        if (iteration > 1) {
          let nextStep = '';
          nextStep += await this.reinjectContextIfNeeded(iteration, currentState);
          nextStep += await this.prepareInstructionsForNextStep(task);

          if (iteration % this.progressCheckInterval === 0 && this.pilot) {
            const guidance = await this.pilot.analyzeProgress(task, currentState, conversation);
            if (guidance) nextStep += `\n\n${guidance}`;
          }
          conversation.addUserText(nextStep);
        }

        const result = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'required',
        });

        if (!result) throw new Error('Failed to get response from provider');

        debugLog('tool executions:', result?.toolExecutions?.map((execution: any) => execution.toolName).join(', '));

        const allToolNames = result?.toolExecutions?.map((execution: any) => execution.toolName) || [];
        const successfulToolNames = result?.toolExecutions?.filter((execution: any) => execution.wasSuccessful)?.map((execution: any) => execution.toolName) || [];
        const actionPerformed = !!allToolNames.find((toolName: string) => this.ACTION_TOOLS.includes(toolName));
        assertionPerformed = !!successfulToolNames.find((toolName: string) => this.ASSERTION_TOOLS.includes(toolName));
        const wasSuccessful = result?.toolExecutions?.every((execution: any) => execution.wasSuccessful);

        this.trackToolExecutions(result?.toolExecutions || []);

        if (actionPerformed && !wasSuccessful) {
          result?.toolExecutions
            ?.filter((execution: any) => !execution.wasSuccessful && execution.input?.explanation)
            .forEach((execution: any) => {
              task.addNote(`Failed to ${execution.input.explanation} (${execution.toolName})`, TestResult.FAILED);
            });
        }

        if (assertionPerformed) {
          const message = result?.toolExecutions?.find((execution: any) => execution.toolName === 'verify')?.output?.message || '';
          task.addNote(message, wasSuccessful ? TestResult.PASSED : TestResult.FAILED);
          if (wasSuccessful) {
            conversation.addUserText(dedent`
                Assertion "${message}" succesfully passed!

                Proceed with next steps and call actions to achieve the scenario goal or expected outcomes.

                Expected outcomes to check:
                ${task.expected.map((expectation) => `- ${expectation}`).join('\n')}
                Do not perform the same assertion again
            `);
          }
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
        interruptPrompt: 'Test interrupted. Enter new instruction (or "stop" to cancel):',
        observability: {
          agent: 'tester',
          sessionId: task.sessionName,
        },
        catch: async ({ error, stop }) => {
          tag('error').log(`Test execution error: ${error}`);
          stop();
        },
      }
    );

    const finalUrl = this.explorer.getStateManager().getCurrentState()?.url || currentUrl;
    await this.hooksRunner.runAfterHook('tester', finalUrl);

    await this.finalReview(task);
    await this.getHistorian().saveSession(task, initialState, conversation);
    if (task.plan) {
      this.getHistorian().savePlanToFile(task.plan);
    }
    await this.getQuartermaster().analyzeSession(task, initialState, conversation);

    offStateChange();
    await this.finishTest(task);
    await this.explorer.stopTest(task);

    return {
      success: task.isSuccessful,
      ...task,
    };
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

  private async reinjectContextIfNeeded(iteration: number, currentState: ActionResult): Promise<string> {
    const currentUrl = currentState.url;
    const currentStateHash = currentState.hash;

    const isNewUrl = this.previousUrl !== currentUrl;
    const isStateChanged = !isNewUrl && this.previousStateHash !== currentStateHash;

    this.previousUrl = currentUrl;
    this.previousStateHash = currentStateHash;

    let context = '';

    const focusedElement = extractFocusedElement(currentState.ariaSnapshot);
    if (focusedElement) {
      const isTextInput = ['textbox', 'combobox', 'searchbox'].includes(focusedElement.role);
      context += dedent`
        <current_focus>
        FOCUSED: ${focusedElement.role} "${focusedElement.name}"${focusedElement.value ? ` (current value: "${focusedElement.value}")` : ''}
        ${isTextInput ? focusedElementRule : ''}
        </current_focus>
      `;
    } else {
      context += dedent`
        <no_focus>
        No element is focused
        </no_focus>
      `;
    }

    if (await this.explorer.isInsideIframe()) {
      const iframeInfo = this.explorer.getCurrentIframeInfo();
      context += dedent`
        <iframe_context>
        INSIDE IFRAME: ${iframeInfo}
        You are currently inside an iframe. Call I.switchTo() (without arguments) to exit before interacting with elements outside the iframe.
        </iframe_context>
      `;
    }

    if (this.explorer.hasOtherTabs()) {
      const otherTabs = this.explorer.getOtherTabsInfo();
      context += multipleTabsRule(otherTabs);
      this.explorer.clearOtherTabsInfo();
    }

    if (isNewUrl) {
      const research = await this.researcher.research(currentState);
      let uiMapSection = '';
      if (research) {
        uiMapSection = dedent`

          Page UI Map
          The complete UI map of a page (can be oudated)
          <page_ui_map>
          ${research}
          </page_ui_map>
        `;
      }

      context += dedent`
        Context:

        <page>
        CURRENT URL: ${currentState.url}
        CURRENT TITLE: ${currentState.title}
        </page>

        <page_aria>
        ${currentState.ariaSnapshot}
        </page_aria>
        ${uiMapSection}

        Use <page_ui_map> to understand the page structure and its main elements.
        However, <page_ui_map> is not always up to date, use <page_aria> and <page_html> to understand the ACTUAL state of the page
        Do not interact with elements that are not listed in <page_aria> and <page_html>
        Refer to information on page sections in <page_ui_map> and use container CSS locators to interact with elements inside sections
      `;
      return context;
    }

    // if (isStateChanged) {
    //   const combinedHtml = await currentState.combinedHtml();
    //   context += dedent`
    //     Context (state changed):

    //     <page>
    //     CURRENT URL: ${currentState.url}
    //     CURRENT TITLE: ${currentState.title}
    //     </page>

    //     <page_html>
    //     ${combinedHtml}
    //     </page_html>

    //     <page_aria>
    //     ${currentState.ariaSnapshot}
    //     </page_aria>
    //   `;
    //   return context;
    // }

    if (context) return context;

    if (iteration % 5) return '';

    return dedent`
      Context:

      <page>
      CURRENT URL: ${currentState.url}
      CURRENT TITLE: ${currentState.title}
      </page>

      <page_aria>
      ${currentState.ariaSnapshot}
      </page_aria>
    `;
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
    if (!task.hasFinished) {
      task.finish(TestResult.FAILED);
    }
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
    6. Some expectations can be wrong so it's ok to skip them and continue testing
    7. Use finish() when all goals are achieved and verified
    8. ONLY use stop() if the scenario is fundamentally incompatible with the initial page and other pages you visited
    9. Be methodical and precise in your interactions
    10. Use record({ notes: ["..."] }) to document your findings, observations, and plans during testing.
    </approach>

    <rules>
    - Refer to UI Map from <page_ui_map> to understand the page structure and its main elements
    - Use only elements that exist in the provided ARIA tree or HTML, <page_aria> and <page_html>
    - Use click() for buttons, links, and clickable elements ONLY - do NOT include I.type() commands in click() tool
    - Use type() for text input (with optional locator parameter) - call separately if you need to click after typing
    - Use pressKey() for pressing special keys (Enter, Escape, Tab, Arrow keys) or key combinations with modifiers (Ctrl+A, Shift+Delete, etc.)
    - Use form() for forms with multiple inputs or when you need to combine type + click in one operation
    - Use container CSS locators from <page_ui_map> to interact with elements inside sections
    - Systematically use record({ notes: ["..."] }) to write your findings, planned actions, observations, etc.
    - Call record({ notes: ["..."], status: "success" }) when you see success/info message on a page or when expected outcome is achieved
    - Call record({ notes: ["..."], status: "fail" }) when an expected outcome cannot be achieved or has failed or you see error/alert/warning message on a page
    - Call finish() when all goals are achieved and verified
    - ONLY call stop() if the scenario itself is completely irrelevant to this page and no expectations can be achieved
    - Use reset() to navigate back to the initial page if needed. Do not call it if you are already on the initial page
    - Be precise with locators (CSS or XPath)
    - Each click/type call returns the new page state automatically
    - Check for success messages from tool calls to verify if expected outcomes are achieved
    - Check for error messages to understand if there are issues
    - Verify if data was correctly saved and changes are reflected on the page
    - By default, you receive accessibility tree data which shows interactive elements and page structure
    - Understand current context by following <page_html>, <page_aria>, and <page_ui_map>
    - Before submitting form, check all inputs were filled in correctly using see() tool
    - When you interact with form with inputs, ensure that you click corresponding button to save its data
    - Follow <locator_priority> rules when selecting locators for all tools
    - Before retrying your actions check maybe they already achived expected results. Use see() tool for that
    - When filling complex form with lot of actions performed, use see() to look which fields were filled and which are not
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

    ${locatorRule}

    ${actionRule}

    ${sectionContextRule}

    ${this.provider.getSystemPromptForAgent('tester') || ''}
    `;
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
              .map((s) => `- ${s.text}`)
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
      task.addNote(result.summary, TestResult.PASSED);
      task.finish(TestResult.PASSED);
    } else {
      task.addNote(result.summary);
    }

    if (result.recommendation) {
      task.addNote(result.recommendation);
    }
  }

  private async buildTestPrompt(task: Test, actionResult: ActionResult): Promise<string> {
    const knowledge = this.getKnowledge(actionResult);

    return dedent`
      <task>
      SCENARIO GOAL: ${task.scenario}

      EXPECTED RESULTS:
      Check expected results one by one.
      But some of them can be wrong so it's ok to skip them and continue testing.

      <expected_results>
      ${task.expected.map((e) => `- ${e}`).join('\n')}
      </expected_results>

      Your goal is to perform actions on the web page and verify the expected outcomes.
      Try to achieve as many goals as possible.
      If goal is not achievable, log that and skip to next one.
      Do not hallucinate that goal was achieved when it was not.
      When creating or editing items via form() or type() you should include ${task.sessionName} in the value (if it is not restricted by the application logic)
      Initial page URL: ${actionResult.url}

      ${knowledge}
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
          const success = await resetAction.attempt(`I.amOnPage(${JSON.stringify(targetUrl)})`, explanation);

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

          task.addNote(message, TestResult.FAILED);
          task.finish(TestResult.FAILED);

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
          ONLY use this when you have successfully completed the scenario goal.

          IMPORTANT: You MUST provide a specific assertion to verify the final state.
          The assertion should describe what data or state change should be visible on the page.

          Examples of good assertions:
          - "New user 'john@example.com' is visible in the users list"
          - "Success message 'Item created' is displayed"
          - "The form shows saved values: name='Test', email='test@test.com'"
          - "Cart shows 2 items with total $50.00"

          DO NOT use this if:
          - You haven't verified the outcomes yet
          - You're unsure what to verify
        `,
        inputSchema: z.object({
          verify: z.string().describe('Specific assertion to verify on the page before finishing (e.g., "New item appears in the list", "Success message is displayed")'),
        }),
        execute: async ({ verify }) => {
          const state = this.explorer.getStateManager().getCurrentState();
          if (!state) {
            return {
              success: false,
              action: 'finish',
              message: 'No page state available for verification',
            };
          }

          const actionResult = ActionResult.fromState(state);
          const result = await this.navigator.verifyState(verify, actionResult);

          if (!result.verified) {
            task.addNote(`Verification failed: ${verify}`, TestResult.FAILED);
            return {
              success: false,
              action: 'finish',
              message: `Verification failed: ${verify}`,
              suggestion: 'Check if the expected state is actually present on the page. Use see() to analyze current state.',
            };
          }

          tag('success').log(`Test finished - verified: ${verify}`);
          task.addNote(`Verified: ${verify}`, TestResult.PASSED);
          task.addNote('Test finished successfully', TestResult.PASSED);
          task.finish(TestResult.PASSED);

          return {
            success: true,
            action: 'finish',
            message: `Test finished successfully. Verified: ${verify}`,
          };
        },
      }),
      record: tool({
        description: dedent`
          Record test results, outcomes, or notes during testing.
          
          DO NOT CALL THIS TOOL TWICE IN A ROW.
          Use it only after each action or assertion performed.
          
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
          let mappedStatus: TestResultType = null;
          if (input.status === 'success') {
            mappedStatus = TestResult.PASSED;
          } else if (input.status === 'fail') {
            mappedStatus = TestResult.FAILED;
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
            const hasPassed = task.hasAchievedAny();
            task.finish(hasPassed ? TestResult.PASSED : TestResult.FAILED);
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
