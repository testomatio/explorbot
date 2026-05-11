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
    let screenshotState: ActionResult | null = null;
    if (this.provider.hasVision()) {
      try {
        const action = this.explorer.createAction();
        screenshotState = await action.caputrePageWithScreenshot();
        if (screenshotState.screenshot) {
          visualAnalysis = (await this.researcher.answerQuestionAboutScreenshot(screenshotState, `Describe current page state relevant to: ${task.scenario}`)) || '';
        }
      } catch {
        screenshotState = null;
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
          'REQUIRED whenever decision is "pass" — a one-sentence natural-language claim about the current page that, if true, proves the scenario goal (e.g., "New test suite \\"Foo\\" is visible in the suites list"). NOT code: do not write I.*, expect(), .then(), grabTitle, or any JavaScript. Navigator translates the claim into CodeceptJS assertions and runs them; passing assertions are saved to the generated test file. Also use when evidence is insufficient before deciding pass/fail. Leave null for "continue", "fail", or "skipped".'
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

      Decide and commit. "continue" extends the loop and burns iterations — choose it only when
      evidence is genuinely insufficient to call pass/fail, not as a safety hedge.
      - "pass" if final state proves the SCENARIO GOAL is accomplished. Set requestVerification.
      - "fail" if scenario was attempted but goal not achieved.
      - "skipped" if scenario is irrelevant/inapplicable, OR systematic infrastructure failures.
      - "continue" only when a concrete missing piece of evidence (a verify/see) would change your verdict.
      - Mixed evidence + final state shows success → pass. Mixed + final state unclear → continue with guidance.

      When deciding "pass", you MUST also set requestVerification to a one-sentence natural-language
      claim about the current page (e.g., "New test suite Foo is visible in the suites list"). NOT
      code — do not write I.*, expect(), .then(), or any JavaScript. Choose the strongest single
      piece of evidence (a unique element/text that exists ONLY because the scenario succeeded).
      Navigator translates the claim into CodeceptJS assertions; without it the generated test has
      nothing to assert and is worthless.
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

      if (result.decision === 'pass' && result.requestVerification && navigator) {
        tag('substep').log(`Pilot requesting verification: ${result.requestVerification}`);
        const verifyResult = await navigator.verifyState(result.requestVerification, currentState).catch(() => null);
        if (verifyResult?.verified && verifyResult.assertionSteps?.length) {
          this.explorer.getPlaywrightRecorder().recordVerification(verifyResult.assertionSteps);
        }
      }

      tag('info').log(`Pilot: ${result.decision} — ${result.reason}`);
      task.summary = result.reason;

      const verdictState = screenshotState || currentState;

      if (result.decision === 'pass') {
        task.setVerification(`Pilot: ${result.reason}`, TestResult.PASSED, verdictState);
        task.finish(TestResult.PASSED);
        return false;
      }

      if (result.decision === 'fail') {
        task.setVerification(`Pilot: ${result.reason}`, TestResult.FAILED, verdictState);
        task.finish(TestResult.FAILED);
        return false;
      }

      if (result.decision === 'skipped') {
        task.setVerification(`Pilot: skipped — ${result.reason}`, TestResult.SKIPPED, verdictState);
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

  private buildSharedEvidenceRules(task: Test): string {
    return dedent`
      SCENARIO: ${task.scenario}

      EVIDENCE PRIORITY (strict):
      1) Final observable state proving the scenario goal
      2) verify()/see() results in the LAST few actions before stop/finish
      3) Intermediate action outcomes (diagnostic, not decisive)
      Mixed evidence with a clear final-state success → pass. Mixed with unclear final state → continue.

      EVIDENCE SOURCES disagree often: verify(), see(), visual_analysis, session_log. No single source
      overrides the others — weigh them together. Tester's record() notes are the LEAST reliable; always
      cross-check against actual actions and state. Visual screenshot analysis is strong for UI state
      (active tabs, visible counts, colors).

      SCENARIO TITLE defines what must happen. Action verbs require persisted evidence:
      - "Create X" → X must exist (visible, redirected to its page, or success message). Opening a form is NOT enough.
      - "Delete X" → X must be gone. Clicking delete is NOT enough.
      - "Edit X" → updated value must be persisted (visible in list/detail). Opening edit is NOT enough; redirect after save with the new value visible IS enough.
      - Negative tests ("without a name", "invalid", "duplicate", "unauthorized") → success means the system PREVENTED the action with validation/error.

      PROVENANCE: the entity you cite as proof must appear by name in <notes> or
      <session_log> tool inputs for THIS run. Name absent from tester activity = stale
      coincidence, vote \`fail\`. Same if no fillField/type/select/click on a target ran.

      Expected results are MILESTONES, not the goal. Never fail because a milestone (toast, icon, styling)
      didn't match if the scenario goal IS accomplished.

      ${this.buildDeletionScope(task)}

      EXPECTED RESULTS (milestones):
      ${task.expected.map((e) => `- ${e}`).join('\n')}
    `;
  }

  private buildResetSystemPrompt(task: Test): string {
    return dedent`
      You are Pilot — decide whether a reset is legitimate. Reset is DESTRUCTIVE: it abandons this
      iteration's work, but server-side side effects (records created, forms submitted) persist.
      Unnecessary resets create duplicate data and infinite loops.

      ${this.buildSharedEvidenceRules(task)}

      DECISION:
      - "allow": current page cannot host the scenario, irrecoverable error, or no path back.
      - "continue": prior action already succeeded (URL changed, record visible, confirmation shown) — verify/finish instead. Or scenario goal may already be met; instruct tester to verify the actual outcome rather than redo. Provide guidance.
      - "fail": resetCount >= 2 and underlying situation hasn't changed; same flow tried twice with same failure mode.
      - "skipped": feature doesn't exist on this app or prerequisites can't be met.

      PRIORITY:
      1) Successful side effects in session_log → almost never allow reset.
      2) resetCount — each prior reset raises the bar.
      3) Tester's stated reason — weigh against evidence, don't trust blindly.

      GUIDANCE (required for "continue"): a specific next action on the current page — which tool, what
      to verify, how to record. Do not suggest repeating actions that already succeeded.
    `;
  }

  private buildVerdictSystemPrompt(type: string, task: Test): string {
    return dedent`
      You are Pilot — final decision maker for test pass/fail. Tester requested ${type}. Review the
      evidence and commit to a verdict; "continue" only when evidence is genuinely insufficient.

      ${this.buildSharedEvidenceRules(task)}

      DECISION:
      - "pass": scenario goal is fully accomplished. Set requestVerification to a one-sentence claim about
        the current page that proves it (a unique element/text that exists ONLY because the scenario succeeded).
        Pick assertions DOM can express; for non-DOM regions (iframes, canvas, Monaco/CodeMirror), target a
        stable landmark (container, ARIA role) instead of literal inner text. Your "pass" stands even if the
        DOM assertion can't be made.
      - "fail": scenario was attempted but the goal was not achieved.
      - "skipped": scenario is irrelevant to the app, OR systematic infrastructure failures (LLM errors,
        crashes) prevented testing. NOT for "test failed to interact" — that's "fail" or "continue".
      - "continue": tester hasn't completed the goal; provide concrete guidance (which tool, what to check).
        If a verify() asserted a state that was ALREADY TRUE before the test, it proves nothing — reject.

      reason field: do NOT restate the decision ("scenario goal achieved/not achieved"). State what happened —
      what was verified, what failed, what evidence was found.
    `;
  }

  async planTest(task: Test, currentState: ActionResult): Promise<string> {
    tag('substep').log('Pilot planning test...');
    debugLog(`planTest: ${task.scenario}, fisherman: ${this.fisherman ? 'available' : 'none'}`);

    const pageSummary = await this.researcher.summary(currentState, {
      allowNewResearch: false,
    });
    const agenticModel = this.provider.getAgenticModel('pilot');
    this.conversation = this.provider.startConversation(this.getSystemPrompt(task, currentState), 'pilot', agenticModel);
    this.conversation.markLastMessageCacheable();
    this.conversation.protectPrefix(1);

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

  async reviewNewPage(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<string> {
    if (!this.conversation) return '';

    tag('substep').log('Pilot reviewing new page...');

    const pageSummary = await this.researcher.summary(currentState, {
      allowNewResearch: false,
    });
    if (!pageSummary) return '';

    const stateContext = this.buildStateContext(currentState);
    const toolCalls = testerConversation
      .getToolExecutions()
      .filter((t: any) => t.wasSuccessful)
      .slice(-this.stepsToReview);
    const actionsContext = this.formatActions(toolCalls);

    this.conversation.cleanupTag('page_summary', '...trimmed...', 1);
    this.conversation.cleanupTag('recent_actions', '...trimmed...', 2);

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

        <recent_actions>
        ${actionsContext || 'None'}
        </recent_actions>

        ${this.formatExpectations(task)}

        First: evaluate whether this navigation makes sense for the scenario goal. If the page is unrelated, instruct Tester to back() or reset(). Then plan next steps.
      `,
      'pilot.reviewNewPage'
    );
  }

  async analyzeProgress(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<string> {
    tag('substep').log('Pilot analyzing progress...');

    if (!this.conversation) {
      const agenticModel = this.provider.getAgenticModel('pilot');
      this.conversation = this.provider.startConversation(this.getSystemPrompt(task, currentState), 'pilot', agenticModel);
      this.conversation.markLastMessageCacheable();
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
      stopWhen: opts.task ? () => opts.task!.hasFinished : undefined,
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
            const skipReason = await this.checkDataAvailability(task, description, 'Fisherman not available');
            if (skipReason) return { noted: true, prepared: false, skipped: true, reason: skipReason };
            return { noted: true, prepared: false, reason: 'Fisherman not available' };
          }

          const result = await this.fisherman.prepareData(description, task.startUrl, task.sessionName);

          if (!result.success || result.created.length === 0) {
            if (result.summary) tag('warning').log(`Precondition failed: ${result.summary}`);
            const skipReason = await this.checkDataAvailability(task, description, result.summary);
            if (skipReason) return { noted: true, prepared: false, skipped: true, reason: skipReason };
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

  private async checkDataAvailability(task: Test, requestedData: string, fishermanReason: string | undefined): Promise<string | null> {
    if (!this.provider.hasVision()) return null;

    const action = this.explorer.createAction();
    const screenshotState = await action.caputrePageWithScreenshot().catch(() => null);
    if (!screenshotState?.screenshot) return null;

    const question = dedent`
      Test scenario: "${task.scenario}"
      Data we tried to create automatically (and failed): ${requestedData}
      Failure reason: ${fishermanReason || 'unknown'}

      Looking at the current page only, can this scenario still be carried out?
      - YES if the page already shows the items the scenario will act on, OR if the page exposes a UI control that creates such items (an "Add", "New", "+" button, an empty-state CTA, etc.).
      - NO if the scenario needs items that aren't visible AND there is no way to create them from this page (e.g. a filter/search/select scenario over an empty list with no creation affordance).

      Reply with YES or NO on the first line, then a one-sentence reason on the second line.
    `;

    const answer = await this.researcher.answerQuestionAboutScreenshot(screenshotState, question);
    if (!answer) return null;

    const firstLine = answer.split('\n')[0]?.trim().toUpperCase() ?? '';
    if (!firstLine.startsWith('NO')) return null;

    const reason = answer.split('\n').slice(1).join(' ').trim() || 'Required data is absent and cannot be created from this page';
    task.setVerification(`Pilot: skipped — ${reason}`, TestResult.SKIPPED, screenshotState);
    task.finish(TestResult.SKIPPED);
    tag('info').log(`Pilot: precondition failed and page lacks required data — skipping test (${reason})`);
    return reason;
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
      const resultMessage = analysisText ? (analysisText.length > 300 ? `${analysisText.slice(0, 300)}...` : analysisText) : exec.output?.message || exec.output?.result;
      if (resultMessage && (CHECK_TOOLS.includes(exec.toolName) || !exec.wasSuccessful)) {
        line += `\n    result: ${resultMessage}`;
      }

      groups.get(currentUrl)!.lines.push(line);
    }

    const PER_GROUP_CAP = 25;
    const parts: string[] = [];
    for (const [url, group] of groups) {
      const header = [url];
      if (group.title) header.push(`  title: ${group.title}`);
      if (group.h1) header.push(`  h1: ${group.h1}`);
      if (group.h3) header.push(`  h3: ${group.h3}`);
      header.push('');
      const omitted = Math.max(0, group.lines.length - PER_GROUP_CAP);
      const visibleLines = omitted > 0 ? group.lines.slice(-PER_GROUP_CAP) : group.lines;
      const lines = visibleLines.map((l) => `  ${l}`);
      if (omitted > 0) lines.unshift(`  [...${omitted} earlier action(s) omitted...]`);
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

  private getSystemPrompt(task: Test, initialState: ActionResult): string {
    const interactive = isInteractive();
    const stepsText = task.plannedSteps.length > 0 ? task.plannedSteps.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'No planned steps';

    return dedent`
      You are Pilot — a supervisor that detects problems and intervenes only when needed.

      SCENARIO: ${task.scenario}
      START URL: ${initialState.url}
      PAGE: ${initialState.title || ''} | ${initialState.h1 || ''}

      EXPECTED RESULTS:
      ${task.expected.map((e) => `- ${e}`).join('\n')}

      PLANNED STEPS:
      ${stepsText}

      Your job: plan, review new pages, detect stuck patterns, suggest concrete next steps. Track which
      expectations are checked. When things go well, encourage briefly and let Tester continue. The current
      page is usually richer than the page summary lists — prefer exploring it before navigating away.

      Already-achieved detection: if the scenario goal is met in the current state (page_summary, ariaDiff,
      state), instruct Tester to verify() and finish(). If goal was already true at the start, propose
      different input data so the test is meaningful. If Tester repeats the same successful action, STOP.

      Action classification: GOAL-ADVANCING actions mutate the scenario's subject data (create/edit/delete/submit/verify).
      VIEW-ONLY actions toggle filters/tabs/sort/collapse without changing data. One VIEW-ONLY to reveal a
      target is fine; ≥2 consecutive VIEW-ONLY actions with no GOAL-ADVANCING action in between is thrashing
      — redirect Tester to the actual mutation or verification. Repeated large htmlParts diffs are a thrashing signal.

      Navigation: compare current url to START URL. Subpage = OK. Parent/sibling = suspicious, instruct
      back()/reset(). Different domain = wrong, reset() immediately.

      Tool usage policy:
      - When Tester is making progress with no failures, do NOT call see/context/research — Tester already has ARIA/HTML.
      - Use see/context only after 2+ failures on the same element or action.
      - Use xpathCheck proactively on the FIRST element-not-found error or when ARIA role looks wrong; pass the discovered locator into your next instruction.
      ${interactive ? '- Use askUser() only as last resort.' : ''}

      Diagnostic patterns (use <state>, executed/element/skipped fields, ariaDiff):
      - Click failed + button in "disabled buttons" → required field missing. Instruct fill first.
      - "modal: none" but Tester targets a modal → modal closed; re-trigger.
      - Action SUCCESS but ariaDiff empty → may have worked without visible DOM change; check result message.
      - MultipleElementsFound → xpathCheck() to identify the right one, then precise locator or visualClick().
      - Wrong page (settings vs feature) → getVisitedStates() then back() or reset(). Don't try breadcrumbs (SPA back-nav is unreliable).
      - Click SUCCESS but executed locator ≠ explanation intent, or "skipped" attempts present → wrong element clicked.
      - form(I.type()) SUCCESS but "element" shows a button/link → keys went to wrong element; click the input first.
      - ariaDiff shows 5+ added/removed → page entered new mode (editor/modal); call context() before guessing selectors.
      - Empty dropdown/list when items expected → missing data; call precondition() to create it.
      - Search-and-select needs SEQUENCE: focus trigger → type to filter → click option. Tell Tester to split into separate tool calls.
      - Multi-action explanation in one tool call → instruct Tester to split.

      xpathCheck strategy when stuck: never guess one exact text. Combine synonyms, aria-label, title,
      role, icon classes with "or" in one XPath. If empty, broaden (drop role filter). Pass discovered
      XPath into NEXT instruction.

      To request more context, mention ATTACH_HTML, ATTACH_ARIA, or ATTACH_UI_MAP — only when recent actions show failures.

      Tester tools: click, pressKey, form, see, verify, context, research, xpathCheck, visualClick,
      back, getVisitedStates, reset, stop, finish, record.

      YOUR Pilot-only tool: precondition(description) — create FRESH disposable test data via API. Never
      request users. Use when:
      - Scenario edits/deletes/modifies an item → create a disposable target ("1 post").
      - Scenario needs auxiliary data (labels, categories, statuses for filtering).
      - Tester failed because required data is missing (empty dropdown, empty list).

      Skip precondition() when:
      - Scenario is "Create X" — the test creates it itself.
      - Current page already shows the exact data needed.
      - Scenario tests navigation, search UI, or viewing.

      Describe WHAT to create, not what exists. RIGHT: precondition("1 test"). WRONG:
      precondition("1 test suite named Updated Suite with existing tests"). Keep descriptions short.

      Response format:
      PROGRESS: <1 sentence assessment>
      NEXT: <specific actionable instruction for Tester>
    `;
  }
}
