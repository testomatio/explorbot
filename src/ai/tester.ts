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
import { minifyHtml } from '../utils/html.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { loop } from '../utils/loop.ts';
import type { Agent } from './agent.ts';
import { Provider } from './provider.ts';
import { Researcher } from './researcher.ts';
import { protectionRule } from './rules.ts';
import { clearToolCallHistory, createCodeceptJSTools } from './tools.ts';
import type { Conversation } from './conversation.ts';

const debugLog = createDebug('explorbot:tester');

export class Tester implements Agent {
  emoji = '🧪';
  private explorer: Explorer;
  private provider: Provider;

  MAX_ITERATIONS = 20;
  researcher: any;

  constructor(explorer: Explorer, provider: Provider) {
    this.explorer = explorer;
    this.provider = provider;
    this.researcher = new Researcher(explorer, provider);
  }

  async test(task: Test): Promise<{ success: boolean }> {
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) throw new Error('No state found');

    tag('info').log(`Testing scenario: ${task.scenario}`);
    setActivity(`🧪 Testing: ${task.scenario}`, 'action');

    const initialState = ActionResult.fromState(state);

    const conversation = this.provider.startConversation(this.getSystemMessage(), 'tester');
    const initialPrompt = await this.buildTestPrompt(task, initialState);
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

    clearToolCallHistory();
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

    let stateId: number | undefined = 0;
    const codeceptjsTools = createCodeceptJSTools(this.explorer.createAction());
    await loop(
      async ({ stop, iteration }) => {
        debugLog('iteration', iteration);
        const tools = Object.fromEntries(
          Object.entries({
            ...codeceptjsTools,
            ...this.createTestFlowTools(task),
          }).filter(([tool]) => {
            if (!this.provider.hasVision() && tool === 'clickXY') return false;
            return true;
          })
        );

        const currentState = ActionResult.fromState(this.explorer.getStateManager().getCurrentState()!);

        debugLog(`Test ${task.scenario} iteration ${iteration}`);

        // move out from iframe if we have it
        await this.explorer.switchToMainFrame();

        if (this.explorer.getStateManager().isInDeadLoop()) {
          task.addNote('Dead loop detected. Stopped', 'failed');
          stop();
          return;
        }

        // to keep conversation compact we remove old HTMLs
        conversation.cleanupTag('page_html', '...cleaned HTML...', 2);

        let outcomeStatus = '';
        if (task.getPrintableNotes()) {
          outcomeStatus = dedent`
            Your interaction log notes:
            <notes>
            ${task.getPrintableNotes()}
            </notes>
            Use your previous interaction notes to guide your next actions.
            Do not perform the same checks.
            Do not do unsuccesful clicks again.
          `;
        }

        const remaining = task.getRemainingExpectations();
        if (remaining.length > 0) {
          outcomeStatus += `\nExpected steps to check: ${remaining.join(', ')}`;
        }

        const knowledge = this.getKnowledge(currentState);
        const stateHasChanged = currentState.id !== stateId;

        if (iteration > 1) {
          if (!stateHasChanged) {
            debugLog('  state not changed');
          }

          const previousState = this.explorer.getStateManager().getPreviousState();
          debugLog('  state has changed');
          const retryPrompt = dedent`
            Continue testing to check the expected results.

            ${outcomeStatus}

            ${remaining.length > 0 ? `Expected steps to check:\nTry to check them and list your findings\n\n<remaining_expectations>\n${remaining.join('\n- ')}\n</remaining_expectations>` : ''}

            ${knowledge}
          `;

          const isSameUrl = previousState?.url === currentState.url;

          switch (true) {
            case !isSameUrl || !previousState:
              debugLog(`Page state has changed. Researching ${currentState.url}`);
              const newResearch = await this.researcher.research(currentState);
              conversation.addUserText(dedent`
                The page state has changed. Here is the change page

                <page>
                  INITIAL URL: ${initialState.url}
                  CURRENT URL: ${currentState.url}

                  PAGE STATE:
                  <page_summary>
                  ${currentState.toAiContext()}
                  </page_summary>
                  <page_html>
                  ${await currentState.combinedHtml()}
                  </page_html>

                  <page_ui_map>
                  ${newResearch}
                  </page_ui_map>
                </page>

                When calling click() and type() tools use only HTML provided in <page_html> context.
                When calling clickXY follow coordinates from <page_html>.
              `);
              break;
            case isSameUrl:
              const diff = await currentState.diff(ActionResult.fromState(previousState));
              await diff.calculate();
              debugLog(`Page has changed. Diffing ${currentState.url}`, diff.ariaChanged, diff.htmlSubtree);
              conversation.addUserText(dedent`
                The page has changed. 

                Aria snapshots diff:

                <aria>
                ${diff.ariaChanged}
                </aria>


                ${
                  diff.ariaRemoved
                    ? `
                  Removed elements:
                  <removed_aria_elements>
                    ${diff.ariaRemoved}
                  </removed_aria_elements>
                  `
                    : ''
                }

                New Elements:
                <page_new_html>
                ${await minifyHtml(diff.htmlSubtree)}
                </page_html>

                Current Page State is:

                <page_summary>
                ${currentState.toAiContext()}
                </page_summary>
              `);
              break;

            case isSameUrl && !diff.hasChanges():
              conversation.addUserText('Page did not change from previous state.');
              break;
            default:
              conversation.addUserText(retryPrompt);
          }
        }

        const progressReport = await this.analyzeProgress(iteration, task, currentState);
        if (progressReport) {
          conversation.addUserText(progressReport);
        }

        stateId = currentState.id;

        const result = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: 5,
          toolChoice: 'required',
        });

        debugLog(result?.toolExecutions);

        if (task.hasFinished) {
          stop();
          return;
        }

        if (!result) throw new Error('Failed to get response from provider');

        if (iteration >= this.MAX_ITERATIONS) {
          task.addNote('Max iterations reached. Stopped');
          stop();
          return;
        }
      },
      {
        maxAttempts: this.MAX_ITERATIONS,
        catch: async ({ error, stop }) => {
          tag('error').log(`Test execution error: ${error}`);
          debugLog(error);
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
    6. If expected outcome was verified call success(outcome="...") tool
    6.1 If expected outcome was already checked, to not check it again
    7. If expected outcome was not achieved call fail(outcome="...") tool
    7.1 If you have noticed an error message, call fail() with the error message
    7.2 If behavior is unexpected, and you assume it is an application bug, call fail() with explanation
    7.3 If there are error or failure message (identify them by class names or text) on a page call fail() with the error message
    8. Continue trying to achieve expected results
    8.1 Some expectations can be wrong so it's ok to skip them and continue testing
    9. Use reset() if you navigate too far from the desired state
    10. ONLY use stop() if the scenario is fundamentally incompatible with the initial page and other pages you visited
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
    - Understand current context by folloding <page_summary> and <page_ui_map>
    - Use the page your are on to achive expected results
    - Use reset() to navigate back to the initial page if needed
    - When you see form with inputs, use form() tool to interact with it
    - When you interact with form with inputs, ensure that you click corresponding button to save its data.

    ${protectionRule}
    </rules>

    <free_thinking_rule>
    You primary focus to achieve the SCENARIO GOAL
    Expected results were pre-planned and may be wrong or not achievable
    As much as possible use note() to document your findings, observations, and plans during testing.
    If you see that scenario goal can be achieved in unexpected way, call note() and continue
    You may navigate to different pages to achieve expected results.
    You may interact with different pages to achieve expected results.
    While page is relevant to scenario it is ok to use its elements or try to navigate from it.
    If behavior is unexpected, and irrelevant to scenario, but you assume it is an application bug, call fail() with explanation.
    If you have succesfully achieved some unexpected outcome, call success() with the exact outcome text
    </free_thinking_rule>
    `;
  }

  private async analyzeProgress(iteration: number, task: Test, actionResult: ActionResult): Promise<string> {
    if (iteration % 5 !== 0) return '';

    const notes = task.getPrintableNotes() || 'No notes recorded yet.';
    const html = await minifyHtml(await actionResult.combinedHtml());
    const schema = z.object({
      assessment: z.string().describe('Short review of current progress toward the main scenario goal'),
      suggestion: z.string().describe('Specific next action recommendation'),
      recommendReset: z.boolean().optional().describe('Whether calling reset() is advised before continuing'),
    });

    const model = this.provider.getModelForAgent('tester');
    const response = await this.provider.generateObject(
      [
        {
          role: 'system',
          content: dedent`
            You are reviewing ongoing exploratory testing.
            Analyze if the current actions align with the main scenario goal and propose the most useful next step.
          `,
        },
        {
          role: 'user',
          content: dedent`
            SCENARIO GOAL: ${task.scenario}
            CURRENT URL: ${actionResult.url}

            <current_state>
            ${await actionResult.toAiContext()}
            </current_state>

            <current_html>
            ${html}
            </current_html>

            <notes>
            ${notes}
            </notes>

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
      Progress checkpoint after ${iteration} steps:
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
            ${task.steps.map((s) => `- ${s}`).join('\n')}
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
      task.addNote(result.summary, 'passed', true);
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

      IMPORTANT: Provide explanation for each action you take in your response text before calling tools.
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
      - Use type() for text input (with optional locator parameter)
      - Use form() for forms with multiple inputs
      - when creating or editing items via form() or type() and you have no restrictions on string values, prefer use combination of pet names+latin words
      - Systematically use note() to write your findings, planned actions, observations, etc.
      - Use reset() to navigate back to ${actionResult.url} if needed. Do not call it if you are already on the initial page.
      - Call success() when you see success/info message on a page or when expected outcome is achieved
      - Call fail() when an expected outcome cannot be achieved or has failed or you see error/alert/warning message on a page
      - ONLY call stop() if the scenario itself is completely irrelevant to this page and no expectations can be achieved
      - Be precise with locators (CSS or XPath)
      - Each click/type call returns the new page state automatically
      </rules>
    `;
  }

  private createTestFlowTools(task: Test) {
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
          const explanation = reason || 'Resetting to initial page';
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
      // navigate: tool({
      //   description: dedent`
      //     Navigate to a page that was already visited during this test.
      //     If you think you are on the wrong page call this tool to navigate to the correct page.
      //     Only use URLs that are already in the navigation history of this scenario.

      //     Available URLs: ${visitedUrls.join(', ')}
      //   `,
      //   inputSchema: z.object({
      //     url: z.string().describe('Previously visited URL to revisit'),
      //   }),
      //   execute: async ({ url }) => {
      //     console.log('visitedUrls', visitedUrls);
      //     return;
      //     if (!visitedUrls.includes(url)) {
      //       return {
      //         success: false,
      //         action: 'navigate',
      //         message: `You can navigate only to already visited URLs: ${visitedUrls.join(', ')}`,
      //         suggestion: `Use only previously visited URLs: ${visitedUrls.join(', ')}`,
      //       };
      //     }

      //     await this.explorer.visit(url);
      //     task.addNote(`Navigated to ${url}`, 'passed');
      //     return {
      //       success: true,
      //       action: 'navigate',
      //       message: `Navigated to ${url}`,
      //     };
      //   },
      // }),
      screenshot: tool({
        description: dedent`
          Capture the current page as a screenshot and analyze it when an expected element is missing.
          Use it to get UI coordinates from researcher output and follow up with clickXY if necessary.
        `,
        inputSchema: z.object({
          lookFor: z.string().describe('Element or information you want to locate on the screenshot.'),
        }),
        execute: async ({ lookFor }) => {
          const timestamp = Date.now();
          const fileName = `look-for-${timestamp}.png`;
          const explanation = `Capture screenshot to investigate ${lookFor}`;
          const stateManager = this.explorer.getStateManager();
          const baseState = stateManager.getCurrentState();
          let screenshotFile = baseState?.screenshotFile;

          if (!screenshotFile) {
            const screenshotAction = this.explorer.createAction();
            const captured = await screenshotAction.attempt((I) => I.saveScreenshot(fileName), explanation);

            if (!captured) {
              const failure: Record<string, any> = {
                success: false,
                action: 'screenshot',
                lookFor,
                message: 'Failed to capture screenshot.',
                suggestion: 'Ensure the page is fully loaded and try again.',
              };

              if (screenshotAction.lastError) {
                failure.error = screenshotAction.lastError.toString();
              }

              return failure;
            }

            screenshotFile = fileName;
          }

          const stateForAnalysis: WebPageState = {
            ...(baseState ?? { url: '/', fullUrl: '/', title: '' }),
            screenshotFile,
          };

          let analysis: string | null = null;
          let coordinatesHint: string | undefined;
          let coordinates: { x: number; y: number } | undefined;

          try {
            analysis = await this.researcher.imageContent(stateForAnalysis, lookFor);

            if (analysis) {
              const relevantLine = analysis
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .find((line) => line.toLowerCase().includes(lookFor.toLowerCase()) || /\d+X,\s*\d+Y/i.test(line));

              if (relevantLine) {
                coordinatesHint = relevantLine;
                const match = relevantLine.match(/(\d+)X,\s*(\d+)Y/i);
                if (match) {
                  coordinates = { x: Number(match[1]), y: Number(match[2]) };
                }
              }
            }
          } catch (error) {
            debugLog('Screenshot analysis failed', error);
            const failure: Record<string, any> = {
              success: false,
              action: 'screenshot',
              lookFor,
              message: 'Failed to analyze screenshot.',
              suggestion: 'Ensure the page is loaded or tab is focused, then retry or use a different approach.',
            };

            if (error instanceof Error) {
              failure.error = error.message;
            } else if (typeof error === 'string') {
              failure.error = error;
            }

            return failure;
          }

          const outputDir = ConfigParser.getInstance().getOutputDir();
          const screenshotPath = join(outputDir, screenshotFile);

          let suggestion = 'Inspect the analysis to derive locators or coordinates, then proceed with clickXY if needed.';
          if (coordinates) {
            suggestion = `Use clickXY with x=${coordinates.x} and y=${coordinates.y} if interaction is required.`;
          } else if (coordinatesHint) {
            suggestion = `Use clickXY with the coordinates mentioned here: ${coordinatesHint}.`;
          }

          return {
            success: true,
            action: 'screenshot',
            lookFor,
            message: `Screenshot captured for ${lookFor}.`,
            screenshotFile,
            screenshotPath,
            analysis: analysis || undefined,
            coordinatesHint,
            coordinates,
            suggestion,
          };
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
            message: `Test stopped - scenario is irrelevant: ${reason}`,
          };
        },
      }),
      success: tool({
        description: dedent`
          Call this tool if one of the expected result has been successfully achieved.
          Also call it if you see a success/info message on a page.
        `,
        inputSchema: z.object({
          outcome: z.string().describe('The exact expected outcome text that was achieved'),
        }),
        execute: async ({ outcome }) => {
          tag('success').log(`✔ ${outcome}`);
          task.addNote(outcome, 'passed', true);

          if (task.isComplete()) {
            task.finish();
          }

          return {
            success: true,
            action: 'success',
            suggestion: `Continue testing to check the remaining expected outcomes. ${task.getRemainingExpectations().join(', ')}`,
          };
        },
      }),
      fail: tool({
        description: dedent`
          Call this tool if expected result cannot be achieved or has failed.
          Also call it if you see an error/alert/warning message on a page.
          Call it you unsuccesfully tried multiple iterations and failed.

          If the expected result was expected to fail call success() instead of fail().
        `,
        inputSchema: z.object({
          outcome: z.string().describe('The exact expected outcome text that failed'),
        }),
        execute: async ({ outcome }) => {
          tag('warning').log(`✘ ${outcome}`);
          task.addNote(outcome, 'failed', true);

          if (task.isComplete()) {
            task.finish();
          }

          return {
            success: true,
            action: 'fail',
            suggestion: `Continue testing to check the remaining expected outcomes:${task.getRemainingExpectations().join(', ')}`,
          };
        },
      }),
      note: tool({
        description: dedent`
          Add one or more notes about your findings, observations, or plans during testing.
          Use this to document what you've discovered on the page or what you plan to do next.
          It is highly encouraged to add notes for each action you take.
          It should be one simple sentence.
          If you need to add more than one note, use array of notes.

          Examples:
          Single note: note("identified form that can create project")
          Multiple notes: note(["identified form that can create project", "identified button that should create project"])
          Planning notes: note(["plan to fill form with values x, y", "plan to click on project title"])
          
          Use this for documenting:
          - UI elements you've found (buttons, forms, inputs, etc.)
          - Your testing strategy and next steps
          - Observations about page behavior
          - Locators or selectors you've identified
        `,
        inputSchema: z.object({
          notes: z
            .union([z.string().describe('A single note to add'), z.array(z.string()).describe('Array of notes to add at once')])
            .describe('Note(s) to add - can be a single string or array of strings'),
        }),
        execute: async ({ notes }) => {
          const notesArray = Array.isArray(notes) ? notes : [notes];

          for (const noteText of notesArray) {
            task.addNote(noteText);
          }

          return {
            success: true,
            action: 'note',
            message: `Added ${notesArray.length} note(s)`,
            suggestion: 'Continue with your testing strategy based on these findings.',
          };
        },
      }),
    };
  }
}
