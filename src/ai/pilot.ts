import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import { type ExperienceTracker, renderExperienceToc } from '../experience-tracker.ts';
import type Explorer from '../explorer.ts';
import { type Test, TestResult } from '../test-plan.ts';
import { collectInteractiveNodes, detectFocusArea, extractFocusedElement } from '../utils/aria.ts';
import { ErrorPageError } from '../utils/error-page.ts';
import { createDebug, tag } from '../utils/logger.ts';

const debugLog = createDebug('explorbot:pilot');
import { truncateJson } from '../utils/strings.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import type { Fisherman } from './fisherman.ts';
import type { Navigator } from './navigator.ts';
import type { Provider } from './provider.ts';
import type { Researcher } from './researcher.ts';
import { isInteractive } from './task-agent.ts';

const CHECK_TOOLS = ['verify', 'see', 'research', 'context'];
const META_TOOLS = ['record', 'reset', 'stop', 'finish'];

export class Pilot implements Agent {
  emoji = '🧭';
  private provider: Provider;
  private agentTools: any;
  private conversation: Conversation | null = null;
  private researcher: Researcher;
  private explorer: Explorer;
  private fisherman: Fisherman | null = null;
  private experienceTracker: ExperienceTracker | null;

  constructor(provider: Provider, agentTools: any, researcher: Researcher, explorer: Explorer, experienceTracker?: ExperienceTracker) {
    this.provider = provider;
    this.agentTools = agentTools;
    this.researcher = researcher;
    this.explorer = explorer;
    this.experienceTracker = experienceTracker || null;
  }

  setFisherman(fisherman: Fisherman): void {
    this.fisherman = fisherman;
  }

  private get stepsToReview(): number {
    return (ConfigParser.getInstance().getConfig().ai?.agents as any)?.pilot?.stepsToReview ?? 5;
  }

  reset(): void {
    this.conversation = null;
  }

  getLastAnalysis(): string | null {
    if (!this.conversation) return null;
    return this.conversation.getLastMessage() || null;
  }

  async reviewStop(task: Test, currentState: ActionResult, testerConversation: Conversation, navigator?: Navigator): Promise<boolean> {
    return this.reviewDecision('stop', task, currentState, testerConversation, navigator);
  }

  async reviewFinish(task: Test, currentState: ActionResult, testerConversation: Conversation, navigator?: Navigator): Promise<boolean> {
    return this.reviewDecision('finish', task, currentState, testerConversation, navigator);
  }

  async reviewCompletion(task: Test, currentState: ActionResult, testerConversation: Conversation, navigator?: Navigator): Promise<boolean> {
    const verdictType = task.hasAchievedAny() ? 'finish' : 'stop';
    return this.reviewDecision(verdictType, task, currentState, testerConversation, navigator);
  }

  async finalReview(task: Test, currentState: ActionResult, testerConversation: Conversation, navigator?: Navigator): Promise<boolean> {
    if (task.hasFinished) return false;
    return this.reviewCompletion(task, currentState, testerConversation, navigator);
  }

  async reviewReset(task: Test, currentState: ActionResult, reason: string, testerConversation: Conversation): Promise<boolean> {
    return this.reviewResetDecision(task, currentState, reason, testerConversation);
  }

  private async reviewDecision(type: 'finish' | 'stop', task: Test, currentState: ActionResult, testerConversation: Conversation, navigator?: Navigator): Promise<boolean> {
    if (task.hasFinished) return false;
    tag('substep').log(`Pilot reviewing ${type} verdict...`);

    const sessionLog = this.formatSessionLog(testerConversation);
    const stateContext = this.buildStateContext(currentState);
    const notes = task.notesToString() || 'No notes recorded.';

    let visualAnalysis = '';
    if (this.provider.hasVision()) {
      try {
        const action = this.explorer.createAction();
        const screenshotState = await action.caputrePageWithScreenshot();
        if (screenshotState.screenshot) {
          visualAnalysis = (await this.researcher.answerQuestionAboutScreenshot(screenshotState, `Describe current page state relevant to: ${task.scenario}`)) || '';
        }
      } catch {
        // vision not available, continue without
      }
    }

    const schema = z.object({
      decision: z.enum(['pass', 'fail', 'continue', 'skipped']).describe('pass = test succeeded, fail = test failed, continue = tester should keep going, skipped = scenario is irrelevant OR systematic execution failures prevented testing'),
      reason: z.string().describe('What happened and why (1-2 sentences). Do NOT repeat the decision status (e.g. "scenario goal achieved/not achieved") — just explain the evidence. For continue: explain why rejected and suggest alternatives.'),
      guidance: z.string().nullable().describe('Required for "continue": specific actionable instruction for the tester — what exactly to verify, retry differently, or complete next. Be concrete.'),
      requestVerification: z
        .string()
        .nullable()
        .describe(
          'REQUIRED whenever decision is "pass" — provide a specific assertion that proves the scenario goal on the current page (e.g., "New test suite \\"Foo\\" is visible in the suites list"). The system runs it and bakes the resulting assertion into the generated test file; without it the test file has no verifiable expect(). Also use when evidence is insufficient before deciding pass/fail. Leave null for "continue", "fail", or "skipped".'
        ),
    });

    const userContent = dedent`
      Tester wants to ${type} the test.

      <state>
      ${stateContext}
      </state>

      ${visualAnalysis ? `<visual_analysis>\n${visualAnalysis}\n</visual_analysis>` : ''}

      ${this.formatExpectations(task)}

      <notes>
      ${notes}
      </notes>

      <session_log>
      ${sessionLog || 'No actions recorded'}
      </session_log>

      Decide:
      - "pass" ONLY if the SCENARIO GOAL is fully accomplished (not just milestones)
      - "fail" if the scenario was attempted but failed
      - "skipped" if the scenario is irrelevant/inapplicable OR systematic execution failures prevented testing (e.g., repeated LLM errors, navigation crashes, tool failures unrelated to the scenario)
      - "continue" if tester hasn't completed the scenario goal yet — even if milestones were checked
      - If evidence is mixed, but final state indicates goal completion, choose "pass"
      - If evidence is mixed and final state is unclear, prefer "continue" over "fail"

      When deciding "pass", you MUST also set requestVerification to a CodeceptJS assertion that
      proves the scenario goal on the current page. Choose the strongest single evidence (a unique
      element/text that exists ONLY because the scenario succeeded). The assertion is executed and
      then converted into the spec file's expect() — without it the generated test has nothing to
      assert and is worthless.
    `;

    const messages = [
      {
        role: 'system' as const,
        content: this.buildVerdictSystemPrompt(type, task),
      },
      { role: 'user' as const, content: userContent },
    ];

    try {
      const response = await this.provider.generateObject(messages, schema, this.provider.getAgenticModel('pilot'), {
        agentName: 'pilot',
        experimental_telemetry: { functionId: 'pilot.reviewVerdict' },
      });

      const result = response?.object;
      if (!result) {
        task.finish(TestResult.FAILED);
        return false;
      }

      if (result.requestVerification && navigator) {
        tag('substep').log(`Pilot requesting verification: ${result.requestVerification}`);
        try {
          const verifyResult = await navigator.verifyState(result.requestVerification, currentState);
          if (verifyResult.verified) {
            if (verifyResult.assertionSteps?.length) {
              this.explorer.getPlaywrightRecorder().recordVerification(verifyResult.assertionSteps);
            }
            tag('substep').log(`Pilot verified: ${result.requestVerification}`);
          } else {
            tag('substep').log(`Pilot verification failed: ${result.requestVerification}`);
            if (result.decision === 'pass') {
              const flipMessage = `Verification "${result.requestVerification}" did not match the page. Adjust approach and re-verify before finishing.`;
              result.decision = 'continue';
              result.reason = flipMessage;
              result.guidance = result.guidance ?? flipMessage;
            }
          }
        } catch (verifyErr: any) {
          tag('warning').log(`Pilot verification errored: ${verifyErr.message}`);
        }
      }

      tag('info').log(`Pilot: ${result.decision} — ${result.reason}`);
      task.summary = result.reason;

      if (result.decision === 'pass') {
        task.addNote(`Pilot: ${result.reason}`, TestResult.PASSED);
        task.finish(TestResult.PASSED);
        return false;
      }

      if (result.decision === 'fail') {
        task.addNote(`Pilot: ${result.reason}`, TestResult.FAILED);
        task.finish(TestResult.FAILED);
        return false;
      }

      if (result.decision === 'skipped') {
        task.addNote(`Pilot: skipped — ${result.reason}`, TestResult.SKIPPED);
        task.finish(TestResult.SKIPPED);
        return false;
      }

      task.addNote(`Pilot: continue — ${result.reason}`);
      const guidanceText = result.guidance ? `\n\nWhat to do next: ${result.guidance}` : '';
      testerConversation.addUserText(`Pilot: ${result.reason}${guidanceText}`);
      return true;
    } catch (error: any) {
      tag('warning').log(`Pilot verdict failed: ${error.message}`);
      task.finish(TestResult.FAILED);
      return false;
    }
  }

  private async reviewResetDecision(task: Test, currentState: ActionResult, reason: string, testerConversation: Conversation): Promise<boolean> {
    if (task.hasFinished) return false;
    tag('substep').log(`Pilot reviewing reset (count=${task.resetCount})...`);

    const sessionLog = this.formatSessionLog(testerConversation);
    const stateContext = this.buildStateContext(currentState);
    const notes = task.notesToString() || 'No notes recorded.';

    const schema = z.object({
      decision: z.enum(['allow', 'fail', 'continue', 'skipped']).describe('allow = reset proceeds, fail = test failed (stop looping), continue = veto reset, tester should act on current page instead, skipped = scenario is irrelevant or cannot be executed'),
      reason: z.string().describe('What evidence justifies this decision (1-2 sentences). Do not restate the decision.'),
      guidance: z.string().nullable().describe('Required for "continue": concrete instruction for what the tester should do instead of resetting (e.g. which tool to call, what to verify).'),
    });

    const userContent = dedent`
      Tester requested reset. Previous reset count: ${task.resetCount - 1}.

      Reason given by tester: ${reason || '(none)'}

      <state>
      ${stateContext}
      </state>

      ${this.formatExpectations(task)}

      <notes>
      ${notes}
      </notes>

      <session_log>
      ${sessionLog || 'No actions recorded'}
      </session_log>

      Decide:
      - "allow" — the reset is legitimate (navigation dead-end, wrong page, irrecoverable error on current page).
      - "continue" — veto the reset; something on the current page can still be used to progress or verify. Provide guidance.
      - "fail" — reset-looping: tester has already reset and the underlying obstacle will not change. Stop the test as failed.
      - "skipped" — the scenario is inapplicable to this application or cannot be executed here.
    `;

    const messages = [
      {
        role: 'system' as const,
        content: this.buildResetSystemPrompt(task),
      },
      { role: 'user' as const, content: userContent },
    ];

    try {
      const response = await this.provider.generateObject(messages, schema, this.provider.getAgenticModel('pilot'), {
        agentName: 'pilot',
        experimental_telemetry: { functionId: 'pilot.reviewReset' },
      });

      const result = response?.object;
      if (!result) {
        return true;
      }

      tag('info').log(`Pilot reset verdict: ${result.decision} — ${result.reason}`);

      if (result.decision === 'allow') {
        tag('substep').log(`Pilot allowed reset: ${result.reason}`);
        return true;
      }

      if (result.decision === 'fail') {
        task.addNote(`Pilot: reset refused — ${result.reason}`, TestResult.FAILED);
        task.finish(TestResult.FAILED);
        return false;
      }

      if (result.decision === 'skipped') {
        task.addNote(`Pilot: skipped — ${result.reason}`, TestResult.SKIPPED);
        task.finish(TestResult.SKIPPED);
        return false;
      }

      tag('substep').log(`Pilot vetoed reset: ${result.reason}`);
      const guidanceText = result.guidance ? `\n\nWhat to do instead: ${result.guidance}` : '';
      testerConversation.addUserText(`Pilot vetoed reset: ${result.reason}${guidanceText}`);
      return false;
    } catch (error: any) {
      tag('warning').log(`Pilot reset review failed: ${error.message}`);
      return true;
    }
  }

  private buildResetSystemPrompt(task: Test): string {
    return dedent`
      You are Pilot — the supervisor that decides whether a reset is legitimate.
      Tester wants to reset (navigate back to the start URL and discard progress).

      SCENARIO: ${task.scenario}

      Reset is DESTRUCTIVE. It abandons all work done in this iteration. In stateful apps, any
      side effects (records created, forms submitted) persist on the server — resetting does not
      undo them. Unnecessary resets create duplicate data and loop forever.

      LEGITIMATE RESET (decide "allow"):
      - The current page is unrelated to the scenario and no path leads back.
      - Navigation is stuck in an error state with no recoverable action.
      - The tester arrived on a page that cannot host the scenario at all.

      ILLEGITIMATE RESET (decide "continue"):
      - The previous action already succeeded (URL changed to a success/detail page, record visible,
        confirmation shown) and tester wants to redo it because an assertion did not match.
        The work is done — verify, record, or finish instead of restarting.
      - A single expectation / milestone does not match app reality but the scenario goal may still
        have been achieved. Do not redo — instruct the tester to verify the actual outcome.
      - Tester wants to "try again with different input" after a form was submitted. Submitting
        again creates a duplicate; guide toward editing the existing record or accepting the state.

      RESET-LOOP (decide "fail"):
      - resetCount >= 2 and the previous resets did not change the underlying situation.
      - The same flow has been attempted twice with the same failure mode.
      - Repeating the reset cannot produce new information.

      SCENARIO INAPPLICABLE (decide "skipped"):
      - The feature the scenario targets does not exist on this app, or prerequisites cannot be met.

      PRIORITY:
      1) Evidence of successful side effects in session_log (URL transition, new record visible).
         If present, almost never allow the reset — the work is done.
      2) resetCount. Each prior reset raises the bar for allowing another.
      3) Tester's stated reason. Weigh it against the observed evidence, do not trust it blindly.

      GUIDANCE FIELD (required when decision is "continue"):
      Give a specific next action on the current page: which tool to call, what to verify, or how to
      record the outcome. Do not suggest repeating actions that already succeeded.

      EXPECTED RESULTS (milestones, not the goal):
      ${task.expected.map((e) => `- ${e}`).join('\n')}
    `;
  }

  private buildVerdictSystemPrompt(type: string, task: Test): string {
    return dedent`
      You are Pilot — the final decision maker for test pass/fail.
      Tester has requested to ${type} the test. Review the evidence and decide.

      SCENARIO: ${task.scenario}

      The SCENARIO is the primary goal. The test can only pass if the scenario goal is fully accomplished.
      PRIORITY ORDER (strict):
      1) Final observable state proving the scenario goal
      2) Verification evidence (if provided)
      3) Intermediate action/step outcomes
      If final state evidence proves the scenario goal, PASS even when some intermediate actions failed.
      Do not fail only because a specific click failed, no toast appeared, or navigation was different than expected.
      Intermediate failures are diagnostic, not decisive, when end state confirms success.
      Expected results are helpful milestones but they DO NOT override the scenario goal.
      NEVER fail a test because an expected result (milestone) was not met when the scenario goal itself IS accomplished.
      The SCENARIO TITLE defines what must happen. If the title says "Create X and verify it appears" and X was created and appears — that's a PASS, even if some milestone about icons/status/styling was not met.
      If the scenario says "Create X", then X must be created — opening a form or navigating to /new URL is NOT enough. There must be evidence that the item now exists: visible on page, redirected to the item's page, or a success/confirmation message appeared.
      If the scenario says "Delete X", then X must be deleted — clicking delete button is not enough. There must be evidence the item is gone.
      If the scenario says "Edit X", then changes must be saved — opening an edit form is NOT enough.
      For edit/update/rename scenarios, persisted updated value visible in list/detail view is valid save evidence, even without toast and even if page redirected away from edit view.
      DO NOT trust Tester's self-assessment in notes (like "scenario goal achieved"). Verify against actual actions and state.
      EVIDENCE SOURCES: verify(), see(), visual_analysis, and action results in session_log are all evidence. They may disagree — analyze all of them together to reach your decision. No single source automatically overrides the others. Visual analysis from screenshots is strong evidence for UI state (active tabs, visible items, counts, colors). Tester's self-assessment in record() notes is the least reliable — always cross-check against actual evidence.
      SESSION LOG shows ALL actions grouped by URL. If the scenario requires changing data (edit/create/delete) but all form/click actions FAILED, the test cannot pass — even if a verify() found matching content that existed before the test.

      VERIFICATION RULE: Only the LAST few actions before finish/stop count as verification evidence.
      - If verify() or see() is among the last actions → use its result as evidence.
      - If no verification was done → prefer "continue" with guidance telling tester what to verify.
      - If verify assertion describes a state that was ALREADY TRUE before the test started, the verification proves nothing — reject with "continue".

      GUIDANCE FIELD: When decision is "continue", you MUST provide "guidance" — a specific actionable instruction:
      - If evidence is insufficient: tell tester to verify with see()/verify(), specify WHAT to check
      - If approach was wrong: tell tester to try a different method, suggest which one
      - If remaining steps exist: tell tester which steps to complete next
      Be concrete. Example: "Use see() to check if the description text appears in the Description tab panel" not "verify the result".
      Do NOT tell tester to redo the same actions that already succeeded.

      NEGATIVE TESTS: Some scenarios test that something CANNOT or SHOULD NOT happen.
      Patterns: "without a name", "with invalid data", "empty field", "wrong password", "unauthorized", "duplicate".
      For negative tests, success means the system PREVENTED the action — error messages, validation, disabled buttons.
      Example: "Create X without a name" PASSES if X was NOT created and validation appeared.

      SKIPPED TESTS: Choose "skipped" in two cases:
      1) Scenario is irrelevant: feature doesn't exist on the page, required UI elements are completely absent, scenario prerequisites cannot be met.
      2) Systematic execution failures: repeated LLM/API errors, navigation crashes, tool failures unrelated to the scenario itself. These are infrastructure problems, not test failures.
      Do NOT use "skipped" when the feature exists but the test just failed to interact with it — that's "fail" or "continue".

      ${this.buildDeletionScope(task)}

      REASON FORMAT: The "reason" field goes into the test report. Do NOT start with "The scenario goal was/was not achieved" or similar status phrases — the decision field already conveys that. Instead, state what happened: what was verified, what failed, or what evidence was found.

      EXPECTED RESULTS (milestones, not the goal):
      ${task.expected.map((e) => `- ${e}`).join('\n')}
    `;
  }

  async planTest(task: Test, currentState: ActionResult): Promise<string> {
    tag('substep').log('Pilot planning test...');
    debugLog(`planTest: ${task.scenario}, fisherman: ${this.fisherman ? 'available' : 'none'}`);

    const pageSummary = await this.researcher.summary(currentState, {
      allowNewResearch: false,
    });
    const agenticModel = this.provider.getAgenticModel('pilot');
    this.conversation = this.provider.startConversation(this.getSystemPrompt(task, currentState, pageSummary), 'pilot', agenticModel);

    const stateContext = this.buildStateContext(currentState);

    return this.sendToPilot(
      dedent`
        <state>
        ${stateContext}
        </state>

        ${pageSummary ? `<page_summary>\n${pageSummary}\n</page_summary>` : ''}

        Plan the test execution for this scenario.

        FIRST: Decide if precondition() is needed.

        Call precondition() WHEN:
        - The scenario edits/deletes/modifies an item, and you want a DISPOSABLE item to act on safely
        - The scenario needs specific data clearly NOT on the current page (e.g., items with specific statuses for filtering)

        SKIP precondition() WHEN:
        - The scenario is "Create X" — the test itself creates the item
        - The current page already shows the item the test will act on (check <state> and <page_summary>)
        - The scenario tests navigation, UI behavior, or viewing — no data mutation needed

        If needed, call precondition() now. If not, proceed directly to planning.

        THEN: Based on the page elements and current state, outline:
        1. Which elements to interact with and in what order
        2. What to verify at each step
        3. Potential issues to watch for

        Before planning navigation to another page, assume the current page may already contain
        the elements needed for the scenario. The page summary does not list every element.
        Prefer interacting with the current page over navigating away.

        If you load a recipe via learn_experience, do NOT rewrite its code in your plan — the
        raw recipe is forwarded to Tester automatically. Reference it by step ("apply recipe
        steps 1–3, then…") and call out anywhere your scenario diverges from it.

        Be concise and specific. Tester will follow your plan.
      `,
      'pilot.planTest',
      { tools: true, planningOnly: true, maxToolRoundtrips: 3, task }
    );
  }

  async reviewNewPage(task: Test, currentState: ActionResult): Promise<string> {
    if (!this.conversation) return '';

    tag('substep').log('Pilot reviewing new page...');

    const pageSummary = await this.researcher.summary(currentState, {
      allowNewResearch: false,
    });
    if (!pageSummary) return '';

    const stateContext = this.buildStateContext(currentState);

    this.conversation.cleanupTag('page_summary', '...trimmed...', 1);

    return this.sendToPilot(
      dedent`
        Navigated to new page.
        START URL: ${task.startUrl}

        <state>
        ${stateContext}
        </state>

        <page_summary>
        ${pageSummary}
        </page_summary>

        ${this.formatExpectations(task)}

        First: evaluate whether this navigation makes sense for the scenario goal. If the page is unrelated, instruct Tester to back() or reset(). Then plan next steps.
      `,
      'pilot.reviewNewPage'
    );
  }

  async analyzeProgress(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<string> {
    tag('substep').log('Pilot analyzing progress...');

    if (!this.conversation) {
      const pageSummary = await this.researcher.summary(currentState, {
        allowNewResearch: false,
      });
      const agenticModel = this.provider.getAgenticModel('pilot');
      this.conversation = this.provider.startConversation(this.getSystemPrompt(task, currentState, pageSummary), 'pilot', agenticModel);
    }

    const toolCalls = testerConversation.getToolExecutions().slice(-this.stepsToReview);
    const actionsContext = this.formatActions(toolCalls);
    const stateContext = this.buildStateContext(currentState);

    this.conversation.cleanupTag('recent_actions', '...trimmed...', 2);

    const hasFailures = toolCalls.length === 0 || toolCalls.some((t) => !t.wasSuccessful);

    const text = await this.sendToPilot(
      dedent`
        START URL: ${task.startUrl}

        <state>
        ${stateContext}
        </state>

        ${this.formatExpectations(task)}

        <recent_actions>
        ${actionsContext || 'None'}
        </recent_actions>

        What should Tester do next?
      `,
      'pilot.analyze',
      { tools: hasFailures, maxToolRoundtrips: hasFailures ? 2 : 0, task }
    );

    const contextToAttach = await this.fetchRequestedContext(text, currentState);

    if (contextToAttach) {
      return `${text}\n\n${contextToAttach}`;
    }

    return text;
  }

  private formatExpectations(task: Test): string {
    const checked = task.getCheckedExpectations();
    const remaining = task.getRemainingExpectations();
    return `CHECKED: ${checked.length > 0 ? checked.join(', ') : 'none'}\nREMAINING: ${remaining.length > 0 ? remaining.join(', ') : 'none'}`;
  }

  private async sendToPilot(userText: string, functionId: string, opts: { tools?: boolean; planningOnly?: boolean; maxToolRoundtrips?: number; task?: Test } = {}): Promise<string> {
    debugLog(`sendToPilot: ${functionId}, tools: ${!!opts.tools}, roundtrips: ${opts.maxToolRoundtrips ?? 0}`);

    let finalUserText = userText;
    if (opts.tools) {
      const tocBlock = this.getExperienceToc();
      if (tocBlock) {
        finalUserText = `${tocBlock}\n\n${userText}`;
      }
    }
    this.conversation!.addUserText(finalUserText);
    let tools: any;
    if (opts.tools) {
      tools = opts.planningOnly ? this.pickPlanningTools() : this.agentTools;
    }

    if (opts.tools && opts.task) {
      tools = { ...tools, ...this.buildPreconditionTool(opts.task) };
    }

    const result = await this.provider.invokeConversation(this.conversation!, tools, {
      maxToolRoundtrips: opts.maxToolRoundtrips ?? 0,
      agentName: 'pilot',
      experimental_telemetry: { functionId },
    });
    const text = result?.response?.text || '';
    const learned = (result?.toolExecutions || []).filter((e: any) => e.toolName === 'learn_experience' && e.output?.content).map((e: any) => e.output.content);
    if (learned.length === 0) return text;
    return dedent`
      ${text}

      <applied_experience>
      Recipes from prior successful runs that Pilot judged relevant. Locators worked then; the page may have changed since.
      Treat code blocks below as a starting hypothesis. If a locator misses, fall back to ARIA/UI-map.

      ${learned.join('\n\n')}
      </applied_experience>
    `;
  }

  private getExperienceToc(): string {
    if (!this.experienceTracker) return '';
    const state = this.explorer.getStateManager().getCurrentState();
    if (!state) return '';
    const actionResult = ActionResult.fromState(state);
    const toc = this.experienceTracker.getExperienceTableOfContents(actionResult);
    return renderExperienceToc(toc);
  }

  private pickPlanningTools() {
    const { see, context, verify, research, getVisitedStates, xpathCheck, learn_experience } = this.agentTools ?? {};
    const planning: Record<string, unknown> = {};
    if (see) planning.see = see;
    if (context) planning.context = context;
    if (verify) planning.verify = verify;
    if (research) planning.research = research;
    if (getVisitedStates) planning.getVisitedStates = getVisitedStates;
    if (xpathCheck) planning.xpathCheck = xpathCheck;
    if (learn_experience) planning.learn_experience = learn_experience;
    return planning;
  }

  private buildPreconditionTool(task: Test) {
    return {
      precondition: tool({
        description: 'Create fresh disposable data that the test will act on (edit, delete, filter). Describe WHAT to create, not what exists. Do NOT request users. Examples: "1 post", "1 comment", "1 label named Bug".',
        inputSchema: z.object({
          description: z.string().describe('What data is needed, e.g. "1 post and 2 comments in it"'),
        }),
        execute: async ({ description }) => {
          task.addNote(`Precondition: ${description}`);
          tag('info').log(`Precondition: ${description}`);
          debugLog(`precondition: ${description}, fisherman: ${this.fisherman?.isAvailable() ? 'available' : 'none'}`);

          if (!this.fisherman || !this.fisherman.isAvailable()) {
            return { noted: true, prepared: false, reason: 'Fisherman not available' };
          }

          const result = await this.fisherman.prepareData(description, task.startUrl, task.sessionName);

          if (!result.success || result.created.length === 0) {
            if (result.summary) tag('warning').log(`Precondition failed: ${result.summary}`);
            return { noted: true, prepared: false, reason: result.summary };
          }

          const items = result.created.map((c) => {
            const parts = [c.type];
            if (c.title) parts.push(`"${c.title}"`);
            if (c.id) parts.push(`(id: ${c.id})`);
            return parts.join(' ');
          });
          const stepText = `Precondition: created ${items.join(', ')}`;
          task.addStep(stepText);
          tag('success').log(stepText);

          return { noted: true, prepared: true, created: result.created };
        },
      }),
    };
  }

  private buildStateContext(state: ActionResult): string {
    const lines: string[] = [];

    lines.push(`url: ${state.url}`);
    lines.push(`title: ${state.title || 'unknown'}`);

    const focused = extractFocusedElement(state.ariaSnapshot);
    if (focused) {
      const valuePart = focused.value ? ` (value: "${focused.value}")` : '';
      lines.push(`focused: ${focused.role} "${focused.name}"${valuePart}`);
    }

    lines.push(`h1: ${state.h1 || ''}`);
    lines.push(`h2: ${state.h2 || ''}`);
    lines.push(`h3: ${state.h3 || ''}`);
    lines.push(`h4: ${state.h4 || ''}`);

    const focusArea = detectFocusArea(state.ariaSnapshot);
    if (focusArea.detected) {
      lines.push(`modal: ${focusArea.name || focusArea.type}`);
    } else {
      lines.push('modal: none');
    }

    if (this.explorer.hasOtherTabs()) {
      const tabs = this.explorer.getOtherTabsInfo();
      lines.push(`other tabs: ${tabs.length} (${tabs.map((t) => `${t.url} - ${t.title}`).join(', ')})`);
    } else {
      lines.push('other tabs: none');
    }

    const verifications = Object.entries(state.verifications ?? {});
    if (verifications.length > 0) {
      const verifyLines = verifications.map(([a, v]) => `${v ? 'PASS' : 'FAIL'}: ${a}`);
      lines.push(`verifications: ${verifyLines.join(', ')}`);
    }

    const consoleErrors = (state.browserLogs ?? []).filter((l: any) => (l.type || l.level) === 'error');
    if (consoleErrors.length > 0) {
      const sample = consoleErrors
        .slice(0, 3)
        .map((e: any) => e.text || e.message || String(e))
        .join(' | ');
      lines.push(`console errors: ${consoleErrors.length} (${sample})`);
    } else {
      lines.push('console errors: none');
    }

    const failedRequests = this.explorer.getRequestStore()?.getFailedRequests() ?? [];
    if (failedRequests.length > 0) {
      const sample = failedRequests
        .slice(-5)
        .map((r) => `${r.method} ${r.path} → ${r.status}`)
        .join(', ');
      lines.push(`network errors: ${sample}`);
    } else {
      lines.push('network errors: none');
    }

    const interactiveNodes = collectInteractiveNodes(state.ariaSnapshot);
    const disabledButtons = interactiveNodes.filter((n) => n.role === 'button' && n.disabled === true && n.name).map((n) => n.name);
    lines.push(`disabled buttons: ${disabledButtons.length > 0 ? disabledButtons.join(', ') : 'none'}`);

    const formFields = interactiveNodes.filter((n) => n.role === 'textbox' || n.role === 'combobox' || n.role === 'select' || n.role === 'searchbox' || n.role === 'spinbutton');
    if (formFields.length > 0) {
      const fieldDescriptions = formFields.map((f) => {
        let desc = `${f.role} "${f.name || ''}"`;
        if (f.required) desc += ' [required]';
        return desc;
      });
      lines.push(`active form: ${fieldDescriptions.join(', ')}`);
    }

    return lines.join('\n');
  }

  private async fetchRequestedContext(text: string, currentState: ActionResult): Promise<string> {
    const parts: string[] = [];

    if (text.includes('ATTACH_HTML')) {
      const html = await currentState.simplifiedHtml();
      parts.push(dedent`
        <page_html>
        ${html}
        </page_html>
      `);
    }

    if (text.includes('ATTACH_ARIA')) {
      parts.push(dedent`
        <page_aria>
        ${currentState.getInteractiveARIA()}
        </page_aria>
      `);
    }

    if (text.includes('ATTACH_SUMMARY')) {
      const summary = await this.researcher.summary(currentState);
      if (summary) {
        parts.push(dedent`
          <page_summary>
          ${summary}
          </page_summary>
        `);
      }
    }

    if (text.includes('ATTACH_UI_MAP')) {
      let uiMap = '';
      try {
        uiMap = await this.researcher.research(currentState);
      } catch (err) {
        if (!(err instanceof ErrorPageError)) throw err;
        tag('warning').log(`Pilot UI map skipped: ${err.message}`);
      }
      if (uiMap) {
        parts.push(dedent`
          <page_ui_map>
          ${uiMap}
          </page_ui_map>
        `);
      }
    }

    return parts.join('\n\n');
  }

  private formatSessionLog(testerConversation: Conversation): string {
    const executions = testerConversation.getToolExecutions().filter((t) => !META_TOOLS.includes(t.toolName));
    const stateHistory = this.explorer.getStateManager().getStateHistory();

    const initialUrl = stateHistory[0]?.toState?.url || '';
    let currentUrl = initialUrl;

    const groups = new Map<string, { title?: string; h1?: string; h3?: string; lines: string[] }>();

    const ensureGroup = (url: string) => {
      if (!groups.has(url)) {
        const matchingState = stateHistory.find((t) => t.toState.url === url)?.toState;
        groups.set(url, {
          title: matchingState?.title,
          h1: matchingState?.h1,
          h3: matchingState?.h3,
          lines: [],
        });
      }
    };

    ensureGroup(currentUrl);

    for (const exec of executions) {
      if (!CHECK_TOOLS.includes(exec.toolName) && exec.output?.url && exec.output.url !== currentUrl) {
        currentUrl = exec.output.url;
        ensureGroup(currentUrl);
      }

      const description = exec.input?.explanation || exec.input?.assertion || exec.input?.request || truncateJson(exec.input);
      const status = exec.wasSuccessful ? 'OK' : 'FAILED';
      let line = `${exec.toolName} '${description}' -> ${status}`;

      if (exec.toolName === 'verify') {
        if (!exec.wasSuccessful && exec.output?.alreadyVerified) {
          line = `${exec.toolName} '${description}' -> BLOCKED (already verified on this state)`;
        } else if (exec.output?.code) {
          line += `\n    code: ${exec.output.code}`;
        }
      }

      const analysisText = exec.output?.analysis;
      const resultMessage = analysisText ? (analysisText.length > 500 ? `${analysisText.slice(0, 500)}...` : analysisText) : exec.output?.message || exec.output?.result;
      if (resultMessage && (CHECK_TOOLS.includes(exec.toolName) || !exec.wasSuccessful)) {
        line += `\n    result: ${resultMessage}`;
      }

      groups.get(currentUrl)!.lines.push(line);
    }

    const parts: string[] = [];
    for (const [url, group] of groups) {
      const header = [url];
      if (group.title) header.push(`  title: ${group.title}`);
      if (group.h1) header.push(`  h1: ${group.h1}`);
      if (group.h3) header.push(`  h3: ${group.h3}`);
      header.push('');
      const lines = group.lines.map((l) => `  ${l}`);
      parts.push([...header, ...lines].join('\n'));
    }

    return parts.join('\n\n');
  }

  private formatActions(toolCalls: any[]): string {
    return toolCalls
      .map((t) => {
        const status = t.wasSuccessful ? 'SUCCESS' : 'FAILED';
        const kind = CHECK_TOOLS.includes(t.toolName) ? 'CHECK' : 'ACTION';
        const description = t.input?.explanation || t.input?.request || truncateJson(t.input);
        const analysisText = t.output?.analysis;
        const resultMessage = analysisText ? (analysisText.length > 500 ? `${analysisText.slice(0, 500)}...` : analysisText) : t.output?.message || '';
        const errorDetail = t.output?.attempts?.find((a: any) => a.error)?.error;

        let line = `[${status}] ${kind} ${t.toolName}: ${description}`;

        const executedCode = t.output?.code;
        if (executedCode && t.toolName === 'click') {
          line += `\n   executed: ${executedCode}`;
        }

        const targeted = t.output?.targetedHtml;
        if (targeted) {
          line += `\n   element: ${targeted}`;
        }

        if (resultMessage) line += `\n   result: ${resultMessage}`;
        if (errorDetail && errorDetail !== resultMessage) line += `\n   error: ${errorDetail}`;

        const attempts = t.output?.attempts;
        if (attempts && attempts.length > 1 && t.wasSuccessful) {
          const failedBefore = attempts.filter((a: any) => !a.success);
          if (failedBefore.length > 0) {
            line += `\n   skipped: ${failedBefore.map((a: any) => a.command).join(', ')}`;
          }
        }

        const ariaDiff = t.output?.pageDiff?.ariaChanges;
        if (ariaDiff) line += `\n   ${ariaDiff}`;

        return line;
      })
      .join('\n\n');
  }

  private buildDeletionScope(task: Test): string {
    const deletableItems = task.plan
      ? task.plan
          .listTests()
          .filter((t) => t.isSuccessful && t.sessionName)
          .map((t) => t.sessionName!)
      : [];
    const scenarioLower = task.scenario.toLowerCase();
    if (deletableItems.length > 0) {
      return `For deletion scenarios, items can only be deleted if their title contains: ${deletableItems.join(', ')}`;
    }
    if (scenarioLower.includes('delete') || scenarioLower.includes('remove')) {
      return 'No items available for deletion — test should create an item first';
    }
    return '';
  }

  private getSystemPrompt(task: Test, initialState: ActionResult, pageSummary: string): string {
    const interactive = isInteractive();
    const stepsText = task.plannedSteps.length > 0 ? task.plannedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'No planned steps';

    return dedent`
      You are Pilot - a supervisor that detects problems and intervenes only when needed.

      SCENARIO: ${task.scenario}
      START URL: ${initialState.url}
      PAGE: ${initialState.title || ''} | ${initialState.h1 || ''}

      EXPECTED RESULTS:
      ${task.expected.map((e) => `- ${e}`).join('\n')}

      PLANNED STEPS:
      ${stepsText}

      ${pageSummary ? `PAGE SUMMARY:\n${pageSummary}` : ''}

      Your job:
      1. Plan test execution by reviewing page elements and scenario requirements
      2. When Tester navigates to a new page, review available elements and plan next steps
      3. Detect when Tester is stuck: repeated failures, loops, or wrong direction
      4. Track which expectations have been checked and which remain
      5. When problems are detected, suggest concrete alternative approaches
      6. When everything is going well, give brief encouragement and let Tester continue
      7. Before suggesting navigation to another page, assume the current page may already have what the scenario needs. The page summary is incomplete — not every element is listed. Prefer exploring the current page first.

      Already-achieved state detection:
      - When planning or reviewing, check if the scenario goal is ALREADY met in the current state (page_summary, ariaDiff, or state context).
      - If the goal appears already achieved at start: adapt the scenario — suggest different input values or data to make the test meaningful.
      - If the goal was achieved by a previous action (SUCCESS in recent_actions with confirming ariaDiff): instruct Tester to verify() the result and finish(). Do NOT repeat the same action.
      - If Tester keeps re-opening the same panel and re-submitting the same data — STOP. The action was already completed.

      Action-goal alignment — classify every recent successful action:
      - GOAL-ADVANCING: creates, edits, removes, submits, or verifies the scenario's subject data (the object the scenario actually changes).
      - VIEW-ONLY: toggles layout, filters, tabs, segment controls, sort orders, collapse/expand — changes which data is shown without modifying it.
      - A single VIEW-ONLY action is legitimate when needed to reveal a target element for the next GOAL-ADVANCING action.
      - A run of two or more consecutive successful VIEW-ONLY actions with no interleaved GOAL-ADVANCING action is thrashing — Tester is exploring UI instead of executing the scenario. Redirect Tester to the specific mutation or verification the scenario requires.
      - VIEW-ONLY actions also tend to produce large page diffs with many htmlParts; if you see that pattern repeatedly in recent_actions, treat it as evidence of thrashing.

      Navigation awareness — always compare current page url to START URL:
      - subpage navigation (deeper path from START URL) — OK, scenario may need sub-pages
      - outer-page navigation (parent/sibling path from START URL) — SUSPICIOUS. The scenario target is on the START page. Do NOT rationalize leaving it. Instruct Tester to back() or reset().
      - outer-site navigation (different domain) — WRONG. Instruct Tester to reset() immediately.

      IMPORTANT — Tool usage policy:
      - DO NOT use tools (see, context) when Tester is making progress and no failures are recorded
      - Tester already has full ARIA and HTML context — do not duplicate that work
      - ONLY use see/context tools when Tester has failed 2+ times on the same element or action
      - Use xpathCheck proactively when Tester fails to find an element even ONCE (element not found error)
      - If Tester's ARIA locator used wrong role (e.g. "textbox" instead of "combobox"), use xpathCheck to identify the correct element
      - After finding the element via xpathCheck, include the discovered locator in your NEXT instruction
      ${interactive ? '- Use askUser() only as last resort when automated recovery has failed' : ''}

      Diagnosing failures — use <state> context:
      - Button click failed AND that button is in "disabled buttons" → button is disabled, not missing. Check "active form" for unfilled [required] fields. Instruct Tester to fill required fields first.
      - Form submit failed → check "active form" for fields that may need values. Instruct Tester to fill them before retrying submit.
      - "modal: none" but Tester tries to interact with a modal → modal was closed or never opened. Instruct Tester to re-trigger the modal.
      - Actions succeed but ariaDiff is empty → action may have worked without visible DOM changes. Check result message before assuming failure.
      - Multiple elements matched (MultipleElementsFound) → use xpathCheck() to inspect the matched elements and determine which one is correct. Then instruct Tester with a precise locator or suggest visualClick() to click the right element by visual appearance.
      - Tester navigated to a page unrelated to the scenario (e.g., settings instead of feature page) → use getVisitedStates() to check which pages were visited, then suggest back() to return to a relevant page, or reset() if multiple wrong navigations occurred. Do NOT try navigating back via breadcrumbs or links — SPA frameworks make manual back-navigation unreliable.
      - If diagnosis is unclear, ariaDiff is empty, and your previous advice didn't help → suggest Tester use see() to visually inspect the page. But ONLY as a last resort after other diagnostics failed.
      - Click succeeded but ariaDiff shows elements unrelated to tester's intention (e.g., clicked "Edit" but dropdown appeared) → wrong button or unexpected behavior. Instruct Tester to Escape and try a different approach.
      - form(I.type()) succeeded → I.type() sends keys to whatever is focused, no guarantee it's the right field. Instruct Tester to verify with see() that text appeared in the correct field. If targetedHtml shows a button/link, text went to wrong element — click the correct field first and retry.
      - ariaDiff shows 5+ elements removed/added after clicking content → page entered a different mode (editor, panel, modal). Instruct Tester to call context() to see current state before guessing selectors.
      - Dropdown/select opened but contains NO options, or a list/table is empty when items were expected → data doesn't exist yet. Call precondition() to create the missing items (labels, categories, etc.), then instruct Tester to retry.
      - Tester tries to select/filter/assign something but the option list is empty or expected value is not present → missing auxiliary data. Call precondition() to create it.

      Detecting logically wrong successes — review "executed", "element", and "skipped" fields:
      - Click SUCCESS but "executed" command differs from "explanation" intent → wrong element was clicked. The intended element wasn't found and a different one was clicked instead.
      - Click SUCCESS with "skipped" commands listed → earlier attempts failed, fell through to a different locator. Check if the successful locator actually targets the intended element.
      - form(I.type()) SUCCESS but "element" shows a button/link instead of input → text went to wrong element. Instruct Tester to click the correct input first.
      - Action SUCCESS but ariaDiff shows changes unrelated to the stated goal → action hit the wrong target. Instruct Tester to undo (Escape/back) and retry with precise locator.
      - If Tester's explanation mentions TWO distinct actions in ONE tool call → flag this. Each distinct action should be a separate tool call. Instruct Tester to split into individual steps.

      Complex component patterns — when Tester fails to interact with dropdowns/selects:
      - Search-and-select dropdowns require a SEQUENCE: click/focus the trigger input, type to filter, then click an option from the dropdown list. Instruct Tester to split this into separate tool calls.
      - If Tester clicks a generic dropdown trigger and ariaDiff shows unrelated options → wrong dropdown was triggered. Instruct Tester to use a more specific selector with container context.
      - If Tester types into an input but no dropdown appears → they may need to click the trigger element first. Suggest using context() to check the current DOM state.

      Tester ignoring visible elements:
      - If <state> shows "active form" fields but Tester is clicking elements not found in ARIA, or trying buttons that don't exist → Tester is ignoring interactive elements that are actually on the page. Instruct Tester to focus on the elements listed in "active form" — these are the real interactive controls on the current page. The UI map may be outdated.

      When Tester IS stuck finding an element, use xpathCheck() with COMBINED XPaths:
      - NEVER guess one exact text. UI labels differ from scenario wording.
      - Combine multiple guesses into ONE XPath using "or" operator.
      - Include: synonyms, partial text, aria-label, title, role, icon classes.
      - Example: looking for a "create project" button:
        //*[(contains(., "Create project") or contains(., "New project") or contains(., "Add project") or contains(@aria-label, "project")) or (contains(., "project") and (contains(@class, "add") or contains(@class, "plus") or contains(@class, "create") or .//*[contains(@class, "plus") or contains(@class, "add") or contains(@class, "icon-add")]))][@role="button" or @role="link" or self::button or self::a]
      - Key: combine text synonyms + icon classes on children (.//*[contains(@class,...)]) + aria attributes
      - If no results, broaden: drop the role filter, or search by role only, then check results for relevant text.
      - After finding candidates, narrow down and include discovered XPath in NEXT instruction.

      If you need more page context, mention ATTACH_HTML, ATTACH_ARIA, or ATTACH_UI_MAP — but only when recent actions show failures.


      Available Tester tools:
      - click(locator) — click elements
      - pressKey(key) — keyboard keys
      - form(code) — execute multiple commands (fillField, type, selectOption, attachFile)
      - see(request) — visual screenshot analysis
      - verify(assertion) — AI-powered DOM assertion (uses I.see, I.seeElement, I.seeInField, I.dontSee)
      - context() — fresh HTML/ARIA snapshot
      - research() — get UI map
      - xpathCheck(xpath) — find elements by XPath
      - visualClick(element) — coordinate-based click
      - back() — return to previous page
      - getVisitedStates() — list all visited pages (deduped by URL)
      - reset() — return to initial page
      - stop(reason) — abort test
      - finish(verify) — complete test successfully
      - record(notes) — document findings

      YOUR tools (Pilot-only):
      - precondition(description) — create FRESH test data via API that the test will act on. Do NOT request users.

      PRECONDITIONS — when and what to create:
      Preconditions create NEW disposable items that the test will modify, delete, or interact with.

      Ask yourself: "What object will this test change/delete/use? Create THAT."

      When to call precondition():
      - Scenario edits/deletes/modifies an item → create a disposable target
      - Scenario needs auxiliary data (labels, categories, statuses to filter by)
      - Tester failed because required data is missing (empty dropdown, no items to select)

      When to SKIP precondition():
      - Scenario is "Create X" — the test itself creates the item, no precondition needed
      - Current page already shows the exact data needed (check <state> h1/title and <page_summary>)
      - Scenario tests navigation, search UI, or viewing — no data mutation involved

      Examples — when to create:
      - "Edit test description" → precondition("1 test") — the test will edit this item
      - "Delete a comment" → precondition("1 comment") — the test will delete this item
      - "Assign a label to item" → precondition("1 item and 1 label named Bug") — test assigns the label
      - "Filter by status" → precondition("3 items: 2 with status Open, 1 with status Closed")

      Examples — when to skip:
      - "Create a new blog post" → SKIP, the test creates it
      - "Edit blog post" while on a blog post page → SKIP, data already exists
      - "View dashboard" → SKIP, no data mutation

      WRONG: precondition("1 test suite named Updated Suite with existing tests") — describes the page, not what to create
      RIGHT: precondition("1 test") — create a fresh test that the scenario will edit

      Keep descriptions short and specific.

      Response format:
      PROGRESS: <1 sentence assessment>
      NEXT: <specific actionable instruction for Tester>
    `;
  }
}
