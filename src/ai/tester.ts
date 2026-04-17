import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { detectFocusArea, extractFocusedElement } from '../utils/aria.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import { codeToMarkdown } from '../utils/html.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import { Navigator } from './navigator.ts';
import type { Captain } from './captain.ts';
import type { Pilot } from './pilot.ts';
import { Provider } from './provider.ts';
import { Researcher } from './researcher.ts';
import { actionRule, focusedElementRule, locatorRule, multipleTabsRule, sectionContextRule } from './rules.ts';
import { TaskAgent } from './task-agent.ts';
import { createCodeceptJSTools, createSpecialContextTools } from './tools.ts';

const debugLog = createDebug('explorbot:tester');

const SAMPLE_FILES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../assets/sample-files');
const SAMPLE_FILES: Record<string, string> = {
  'PNG image': 'sample.png',
  'PDF document': 'sample.pdf',
  'Word document (DOCX)': 'sample.docx',
  'Excel spreadsheet (XLSX)': 'sample.xlsx',
  'ZIP archive': 'sample.zip',
  'MP4 video': 'sample.mp4',
  'MP3 audio': 'sample.mp3',
};

export class Tester extends TaskAgent implements Agent {
  protected readonly ACTION_TOOLS = ['click', 'pressKey', 'form'];
  protected readonly SPECIAL_CONTEXT_ACTION_TOOLS = ['exitIframe'];
  emoji = '🧪';
  private explorer: Explorer;
  private provider: Provider;
  private currentConversation: Conversation | null = null;
  private pilot: Pilot | null = null;
  private captain: Captain | null = null;

  MAX_ITERATIONS = 30;
  MAX_EXTENSIONS = 2;
  ASSERTION_TOOLS = ['verify'];
  researcher: Researcher;
  navigator: Navigator;
  agentTools: any;
  executionLogFile: string | null = null;
  private previousUrl: string | null = null;
  private previousStateHash: string | null = null;
  private pageStateHash: string | null = null;
  private pageActionResult: ActionResult | null = null;
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

  setCaptain(captain: Captain): void {
    this.captain = captain;
  }

  private getCurrentState(): ActionResult {
    return ActionResult.fromState(this.explorer.getStateManager().getCurrentState()!);
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
    this.pageStateHash = null;
    this.pageActionResult = null;
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

    if (this.pilot) {
      const plan = await this.pilot.planTest(task, initialState);
      if (plan) {
        conversation.addUserText(`Pilot's test plan:\n${plan}\n\nFollow this plan while executing the test.`);
      }
    }

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
    let extensions = 0;
    let shouldContinue = true;

    while (shouldContinue) {
      shouldContinue = false;

      await loop(
        async ({ stop, pause, iteration, userInput }) => {
          debugLog('iteration', iteration);
          const currentState = this.getCurrentState();

          const tools = {
            ...codeceptjsTools,
            ...(currentState.isInsideIframe ? createSpecialContextTools(this.explorer, 'iframe') : {}),
            ...this.createTestFlowTools(task, currentState, conversation),
            ...this.agentTools,
          };

          debugLog(`Test ${task.scenario} iteration ${iteration}`);

          if (this.explorer.getStateManager().isInDeadLoop()) {
            task.addNote('Dead loop detected. Stopped');
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
          conversation.cleanupTag('experience', '...cleaned experience...', 1);

          if (iteration > 1) {
            const isNewPage = this.previousUrl !== null && this.previousUrl !== currentState.url;
            let nextStep = '';
            nextStep += await this.reinjectContextIfNeeded(iteration, currentState);
            nextStep += await this.prepareInstructionsForNextStep(task);

            if (isNewPage && this.pilot) {
              const guidance = await this.pilot.reviewNewPage(task, currentState);
              if (guidance) nextStep += `\n\n${guidance}`;
            } else if ((iteration % this.progressCheckInterval === 0 || this.consecutiveFailures >= 3 || this.consecutiveEmptyResults >= 2) && this.pilot) {
              const guidance = await this.pilot.analyzeProgress(task, currentState, conversation);
              if (guidance) nextStep += `\n\n${guidance}`;
              this.consecutiveFailures = 0;
            }
            conversation.addUserText(nextStep);
          }

          const result = await this.provider.invokeConversation(conversation, tools, {
            maxToolRoundtrips: 5,
            toolChoice: 'required',
          });

          if (!result) throw new Error('Failed to get response from provider');

          if (result.response?.text && result.toolExecutions?.length === 0) {
            task.addNote(result.response.text.substring(0, 200));
          }

          debugLog('tool executions:', result?.toolExecutions?.map((execution: any) => execution.toolName).join(', '));

          const allToolNames = result?.toolExecutions?.map((execution: any) => execution.toolName) || [];
          const successfulToolNames = result?.toolExecutions?.filter((execution: any) => execution.wasSuccessful)?.map((execution: any) => execution.toolName) || [];
          const actionPerformed = !!allToolNames.find((toolName: string) => this.ACTION_TOOLS.includes(toolName));
          assertionPerformed = !!successfulToolNames.find((toolName: string) => this.ASSERTION_TOOLS.includes(toolName));
          const wasSuccessful = result?.toolExecutions?.every((execution: any) => execution.wasSuccessful);

          this.trackToolExecutions(result?.toolExecutions || []);

          if (this.consecutiveEmptyResults >= 5) {
            task.addNote('AI model is not responding with actions. Stopped');
            stop();
            return;
          }

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
                Assertion "${message}" successfully passed!

                If the scenario goal is achieved, call finish() now to complete the test.
                If there are remaining expected outcomes that require NEW ACTIONS, proceed with those actions.
                Do not call verify() again until you perform a new action that changes the page.

                Expected outcomes to check:
                ${task.expected.map((expectation) => `- ${expectation}`).join('\n')}
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
          onInterrupt: this.captain
            ? async (userInput, context) => {
                if (!userInput) return;
                const result = await this.captain!.processSupervisorInterrupt(userInput, task);
                tag('info').log(`🧑‍✈️ Supervisor: ${result.action} — ${result.message}`);

                const terminalResults: Record<string, (typeof TestResult)[keyof typeof TestResult]> = {
                  stop: TestResult.FAILED,
                  pass: TestResult.PASSED,
                  skip: TestResult.SKIPPED,
                };
                const terminalResult = terminalResults[result.action];
                if (terminalResult) {
                  task.addNote(result.message, terminalResult);
                  task.finish(terminalResult);
                  context.stop();
                  return;
                }
                context.setUserInput(result.message);
              }
            : undefined,
          observability: {
            name: `test: ${task.scenario}`,
            agent: 'tester',
            sessionId: task.sessionName,
            metadata: {
              input: {
                scenario: task.scenario,
                startUrl: task.startUrl,
                expected: task.expected,
              },
            },
          },
          catch: async ({ error, stop }) => {
            tag('error').log(`Test execution error: ${error}`);
            task.addNote(`Execution error: ${error instanceof Error ? error.message : String(error)}`);
            stop();
          },
        }
      );

      if (task.hasFinished) break;

      const finalState = this.getCurrentState();
      const wantsContinue = await this.pilot!.finalReview(task, finalState, conversation);

      if (!wantsContinue || task.hasFinished) break;
      if (extensions >= this.MAX_EXTENSIONS) break;

      extensions++;
      tag('info').log(`Pilot extending test (${extensions}/${this.MAX_EXTENSIONS})`);
      shouldContinue = true;
    }

    const finalUrl = this.explorer.getStateManager().getCurrentState()?.url || currentUrl;
    await this.hooksRunner.runAfterHook('tester', finalUrl);

    await this.getHistorian().saveSession(task, initialState, conversation);
    if (task.plan) {
      this.getHistorian().savePlanToFile(task.plan);
    }
    await this.getQuartermaster().analyzeSession(task, initialState, conversation);

    offStateChange();
    await this.finishTest(task);
    await this.explorer.stopTest(task, {
      startUrl: task.startUrl,
      style: task.style,
      sessionName: task.sessionName,
    });

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

    if (currentState.isInsideIframe) {
      const iframeInfo = currentState.iframeURL || this.explorer.getCurrentIframeInfo() || 'iframe context active';
      context += dedent`
        <iframe_context>
        INSIDE IFRAME: ${iframeInfo}
        You are currently inside an iframe. Use exitIframe() before interacting with elements outside the iframe.
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
      this.pageStateHash = currentStateHash;
      this.pageActionResult = currentState;
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
        ${currentState.getInteractiveARIA()}
        </page_aria>
        ${uiMapSection}

        Use <page_ui_map> to understand the page structure and its main elements.
        However, <page_ui_map> is not always up to date, use <page_aria> and <page_html> to understand the ACTUAL state of the page
        Do not interact with elements that are not listed in <page_aria> and <page_html>
        Refer to information on page sections in <page_ui_map> and use container CSS locators to interact with elements inside sections
      `;
      return context;
    }

    const focusArea = detectFocusArea(currentState.ariaSnapshot);
    if (focusArea.detected && focusArea.name && this.pageStateHash && this.pageActionResult) {
      const overlaySection = await this.researcher.researchOverlay(currentState, this.pageActionResult, this.pageStateHash);
      if (overlaySection) {
        context += dedent`

          <page_ui_map_overlay>
          ${overlaySection}
          </page_ui_map_overlay>
        `;
      }
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
      ${currentState.getInteractiveARIA()}
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

    if (task.isSuccessful) {
      tag('success').log(`Successful test: ${task.scenario}`);
    } else if (task.isSkipped) {
      tag('warning').log(`Skipped test: ${task.scenario}`);
    } else if (task.hasFailed) {
      tag('error').log(`Failed test: ${task.scenario}`);
    } else {
      tag('warning').log(`Test with no result: ${task.scenario}`);
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
    7. Use finish() ONLY when you have successfully completed the scenario goal and verified it
    8. ONLY use stop() if the scenario is fundamentally incompatible with the initial page and other pages you visited
    9. Be methodical and precise in your interactions
    10. Use record({ notes: ["..."] }) to document your findings, observations, and plans during testing.
    </approach>

    <rules>
    - Refer to UI Map from <page_ui_map> to understand the page structure and its main elements
    - Use only elements that exist in the provided ARIA tree or HTML, <page_aria> and <page_html>
    - Use click() for buttons, links, and clickable elements ONLY - do NOT include I.fillField() or I.type() commands in click() tool
    - click() commands array is for FALLBACK LOCATORS of the SAME element, NOT for clicking different elements in sequence. If you need to click two different elements, make two separate click() calls.
    - Use form() for text input (I.fillField, I.type), dropdown selection (I.selectOption), file uploads (I.attachFile), and multi-step form interactions
    - Use pressKey() for pressing special keys (Enter, Escape, Tab, Arrow keys) or key combinations with modifiers (Ctrl+A, Shift+Delete, etc.)
    - Use container CSS locators from <page_ui_map> to interact with elements inside sections
    - Systematically use record({ notes: ["..."] }) to write your findings, planned actions, observations, etc.
    - Call record({ notes: ["..."], status: "success" }) when you see success/info message on a page or when expected outcome is achieved
    - Call record({ notes: ["..."], status: "fail" }) when an expected outcome cannot be achieved or has failed or you see error/alert/warning message on a page
    - NEVER call record(status: "success") if your last verify() or see() call FAILED. A failed check means the outcome is NOT confirmed — use record(status: "fail") instead, or retry with a different approach.
    - Use finish() to complete the test, not record(). record() is for intermediate notes.
    - Call finish(verify) when all goals are achieved — provide an assertion to verify
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
    - When verify() fails, use see() to visually confirm the result — visual confirmation is equally valid evidence
    - For visual state verification (active tabs, selected items, counts, colors), prefer see() over DOM-based verify()
    - When click() fails and element is visually present, use visualClick() as fallback
    - If you land on a "Not Found", 404, or error page that is NOT part of the scenario, call reset() immediately to return to the initial page and try again
    - If you see a server error page (500, 503, etc.), record it with record({ notes: ["Server error on /path"], status: "fail" }) and call reset() to continue testing
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

    ${this.provider.getSystemPromptForAgent('tester', this.explorer.getStateManager().getCurrentState()?.url) || ''}
    `;
  }

  private async buildTestPrompt(task: Test, actionResult: ActionResult): Promise<string> {
    const knowledge = this.getKnowledge(actionResult);
    const pageContext = await this.reinjectContextIfNeeded(1, actionResult);

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

      ${this.buildDeletionScope(task)}

      ${this.buildAvailableFiles()}

      ${knowledge}

      ${pageContext}
    `;
  }

  private getDeletableSessionNames(task: Test): string[] {
    if (!task.plan) return [];
    return task.plan
      .listTests()
      .filter((t) => t.isSuccessful && t.sessionName)
      .map((t) => t.sessionName!);
  }

  private buildAvailableFiles(): string {
    const userFiles = this.explorer.getConfig().files || {};
    const codeceptDir = (global as any).codecept_dir || process.cwd();
    const lines: string[] = [];

    for (const [description, filename] of Object.entries(SAMPLE_FILES)) {
      lines.push(`- ${description}: ${relative(codeceptDir, join(SAMPLE_FILES_DIR, filename))}`);
    }
    for (const [description, filePath] of Object.entries(userFiles)) {
      lines.push(`- ${description}: ${relative(codeceptDir, resolve(filePath))}`);
    }

    return dedent`
      <available_files>
      When a test requires file uploading, use I.attachFile() via form() tool with these files:
      ${lines.join('\n')}
      </available_files>
    `;
  }

  private buildDeletionScope(task: Test): string {
    const deletableItems = this.getDeletableSessionNames(task);
    if (deletableItems.length > 0) {
      return `When deleting items, ONLY delete items whose title contains one of these session names: ${deletableItems.join(', ')}. These were created by previous tests.`;
    }
    const scenarioLower = task.scenario.toLowerCase();
    if (scenarioLower.includes('delete') || scenarioLower.includes('remove')) {
      return 'No items from previous tests are available for deletion. You need to create an item first before deleting it.';
    }
    return '';
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
          if (this.getCurrentState().isInsideIframe) {
            await this.explorer.switchToMainFrame();
          }

          if (this.explorer.getStateManager().getCurrentState()?.url === resetUrl!) {
            return {
              success: false,
              message: 'Reset failed - already on initial page!',
              suggestion: 'Try different approach or use stop() if the scenario is fundamentally incompatible with the page.',
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
          Stop the current test because the scenario is fundamentally incompatible with the page.
          Use this ONLY when the scenario cannot be executed on the current page or application.
          Do NOT use this for failures — use reset() and retry instead.
        `,
        inputSchema: z.object({
          reason: z.string().describe('Explanation why the scenario is incompatible'),
        }),
        execute: async ({ reason }) => {
          task.addNote(`Stop requested: ${reason}`);

          if (this.pilot) {
            const currentState = this.getCurrentState();
            await this.pilot.reviewStop(task, currentState, conversation);
            if (!task.hasFinished) {
              return {
                success: false,
                action: 'stop',
                message: 'Stop rejected; Continue execution',
              };
            }
          } else {
            task.addNote(reason, TestResult.FAILED);
            task.finish(TestResult.FAILED);
          }

          return {
            success: true,
            action: 'stop',
            message: reason,
          };
        },
      }),
      finish: tool({
        description: dedent`
          Finish the current test successfully because all goals are achieved and verified.
          ONLY use this when you have successfully completed the scenario goal.

          Provide a specific assertion to verify the final state.
          The assertion MUST prove that YOUR ACTIONS changed the page state.
          Do NOT verify something that was already true before you started testing.

          Examples of good assertions:
          - "New user 'john@example.com' is visible in the users list"
          - "Success message 'Item created' is displayed"

          Pilot will review and decide the final verdict.
        `,
        inputSchema: z.object({
          verify: z.string().describe('Specific assertion to verify on the page before finishing (e.g., "New item appears in the list")'),
        }),
        execute: async ({ verify }) => {
          task.addNote(`Finish requested: ${verify}`);

          if (this.pilot) {
            const currentState = this.getCurrentState();
            await this.pilot.reviewFinish(task, currentState, conversation);
            if (!task.hasFinished) {
              return {
                success: false,
                action: 'finish',
                message: 'Finishing rejected; Continue execution',
              };
            }
          } else {
            task.addNote('Test finished successfully', TestResult.PASSED);
            task.finish(TestResult.PASSED);
          }

          return {
            success: true,
            action: 'finish',
            message: verify,
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

          const screenshotFile = this.explorer.getStateManager().getCurrentState()?.screenshotFile;

          for (const noteText of input.notes) {
            task.addNote(noteText, mappedStatus, screenshotFile);

            if (input.status === 'success') {
              tag('success').log(`✔ ${noteText}`);
            } else if (input.status === 'fail') {
              tag('warning').log(`✘ ${noteText}`);
            }
          }

          if (input.status !== null && task.isComplete()) {
            if (this.pilot) {
              const currentState = this.getCurrentState();
              await this.pilot.reviewCompletion(task, currentState, conversation);
            } else {
              const hasPassed = task.hasAchievedAny();
              task.finish(hasPassed ? TestResult.PASSED : TestResult.FAILED);
            }
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
