import dedent from 'dedent';
import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import type Explorer from '../explorer.ts';
import { type Test, TestResult } from '../test-plan.ts';
import { collectInteractiveNodes, condenseAriaDiff, detectFocusArea, extractFocusedElement } from '../utils/aria.ts';
import { tag } from '../utils/logger.ts';
import { truncateJson } from '../utils/strings.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
import type { Navigator } from './navigator.ts';
import type { Provider } from './provider.ts';
import type { Researcher } from './researcher.ts';
import { isInteractive } from './task-agent.ts';

export class Pilot implements Agent {
  emoji = '🧭';
  private provider: Provider;
  private agentTools: any;
  private conversation: Conversation | null = null;
  private researcher: Researcher;
  private explorer: Explorer;

  constructor(provider: Provider, agentTools: any, researcher: Researcher, explorer: Explorer) {
    this.provider = provider;
    this.agentTools = agentTools;
    this.researcher = researcher;
    this.explorer = explorer;
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

  async reviewFinish(task: Test, currentState: ActionResult, testerConversation: Conversation, navigator: Navigator): Promise<void> {
    await this.reviewDecision('finish', task, currentState, testerConversation, navigator);
  }

  async reviewStop(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<void> {
    await this.reviewDecision('stop', task, currentState, testerConversation);
  }

  async reviewCompletion(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<void> {
    const verdictType = task.hasAchievedAny() ? 'finish' : 'stop';
    await this.reviewDecision(verdictType, task, currentState, testerConversation);
  }

  async finalReview(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<void> {
    if (task.hasFinished) return;
    await this.reviewDecision('stop', task, currentState, testerConversation);
  }

  private collectVerifications(): Array<{ url: string; verifications: Record<string, boolean> }> {
    const history = this.explorer.getStateManager().getStateHistory();
    return history.map((t) => ({ url: t.toState.url, verifications: t.toState.verifications })).filter((s): s is { url: string; verifications: Record<string, boolean> } => !!s.verifications && Object.keys(s.verifications).length > 0);
  }

  private async reviewDecision(type: 'finish' | 'stop', task: Test, currentState: ActionResult, testerConversation: Conversation, navigator?: Navigator): Promise<void> {
    tag('substep').log(`🧭 Pilot reviewing ${type} verdict...`);

    const toolCalls = testerConversation.getToolExecutions().slice(-this.stepsToReview);
    const actionsContext = this.formatActions(toolCalls);
    const stateContext = this.buildStateContext(currentState);
    const notes = task.notesToString() || 'No notes recorded.';

    const allVerifications = this.collectVerifications();
    const verifyInfo =
      allVerifications.length > 0
        ? `Verifications:\n${allVerifications
            .map(
              (v) =>
                `  ${v.url}: ${Object.entries(v.verifications)
                  .map(([a, p]) => `${p ? 'PASS' : 'FAIL'}: ${a}`)
                  .join(', ')}`
            )
            .join('\n')}`
        : '';

    const schema = z.object({
      decision: z.enum(['pass', 'fail', 'continue']).describe('pass = test succeeded, fail = test failed, continue = tester should keep going'),
      reason: z.string().describe('Brief explanation (1-2 sentences). For continue: explain why rejected and suggest alternatives.'),
      requestVerification: z.string().optional().describe('If evidence is insufficient, provide an assertion to verify on the page'),
    });

    const userContent = dedent`
      Tester wants to ${type} the test.
      ${verifyInfo}

      <state>
      ${stateContext}
      </state>

      ${this.formatExpectations(task)}

      <notes>
      ${notes}
      </notes>

      <recent_actions>
      ${actionsContext || 'None'}
      </recent_actions>

      Decide:
      - "pass" ONLY if the SCENARIO GOAL is fully accomplished (not just milestones)
      - "fail" if the scenario clearly failed or is incompatible with the page
      - "continue" if tester hasn't completed the scenario goal yet — even if milestones were checked
      - If evidence is mixed, but final state indicates goal completion, choose "pass"
      - If evidence is mixed and final state is unclear, prefer "continue" over "fail"
    `;

    const messages = [
      { role: 'system' as const, content: this.buildVerdictSystemPrompt(type, task) },
      { role: 'user' as const, content: userContent },
    ];

    try {
      const response = await this.provider.generateObject(messages, schema, this.provider.getAgenticModel('pilot'), { agentName: 'pilot', experimental_telemetry: { functionId: 'pilot.reviewVerdict' } });

      const result = response?.object;
      if (!result) {
        task.finish(type === 'finish' ? TestResult.PASSED : TestResult.FAILED);
        return;
      }

      if (result.requestVerification && navigator) {
        tag('substep').log(`🧭 Pilot requesting verification: ${result.requestVerification}`);
        const action = this.explorer.createAction();
        const actionResult = await action.capturePageState();
        const verifyResult = await navigator.verifyState(result.requestVerification, actionResult);

        if (verifyResult.verified) {
          task.addNote(`Pilot verified: ${result.requestVerification}`, TestResult.PASSED);
          task.finish(TestResult.PASSED);
        } else {
          task.addNote(`Pilot verification failed: ${result.requestVerification}`, TestResult.FAILED);
          testerConversation.addUserText(`Pilot: verification failed for "${result.requestVerification}". ${result.reason}`);
        }
        return;
      }

      tag('info').log(`🧭 Pilot: ${result.decision} — ${result.reason}`);

      if (result.decision === 'pass') {
        task.addNote(`Pilot: ${result.reason}`, TestResult.PASSED);
        task.finish(TestResult.PASSED);
        return;
      }

      if (result.decision === 'fail') {
        task.addNote(`Pilot: ${result.reason}`, TestResult.FAILED);
        task.finish(TestResult.FAILED);
        return;
      }

      task.addNote(`Pilot: continue — ${result.reason}`);
      testerConversation.addUserText(`Pilot rejected ${type}: ${result.reason}`);
    } catch (error: any) {
      tag('warning').log(`🧭 Pilot verdict failed: ${error.message}`);
      task.finish(type === 'finish' ? TestResult.PASSED : TestResult.FAILED);
    }
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
      If the scenario says "Create X", then X must be created — opening a form or navigating to /new URL is NOT enough. There must be evidence that the item now exists: visible on page, redirected to the item's page, or a success/confirmation message appeared.
      If the scenario says "Delete X", then X must be deleted — clicking delete button is not enough. There must be evidence the item is gone.
      If the scenario says "Edit X", then changes must be saved — opening an edit form is NOT enough.
      For edit/update/rename scenarios, persisted updated value visible in list/detail view is valid save evidence, even without toast and even if page redirected away from edit view.
      DO NOT trust Tester's self-assessment in notes (like "scenario goal achieved"). Verify against actual actions and state.
      EVIDENCE SOURCES: verify(), see(), and ariaDiff in recent_actions are all evidence. They may disagree — analyze all of them together to reach your decision. No single source automatically overrides the others. Tester's self-assessment in record() notes is the least reliable — always cross-check against actual evidence.

      TRIVIAL VERIFICATION CHECK: If the verify assertion describes a state that was ALREADY TRUE before the test started (e.g., page content visible on initial load, items that existed before any action), the verification proves nothing. Reject with "continue" and explain that verification must prove the scenario ACTION changed something.

      NEGATIVE TESTS: Some scenarios test that something CANNOT or SHOULD NOT happen.
      Patterns: "without a name", "with invalid data", "empty field", "wrong password", "unauthorized", "duplicate".
      For negative tests, success means the system PREVENTED the action — error messages, validation, disabled buttons.
      Example: "Create X without a name" PASSES if X was NOT created and validation appeared.

      ${this.buildDeletionScope(task)}

      EXPECTED RESULTS (milestones, not the goal):
      ${task.expected.map((e) => `- ${e}`).join('\n')}
    `;
  }

  async planTest(task: Test, currentState: ActionResult): Promise<string> {
    tag('substep').log('🧭 Pilot planning test...');

    const pageSummary = await this.researcher.summary(currentState, { allowNewResearch: false });
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
        Based on the page elements and current state, outline:
        1. Which elements to interact with and in what order
        2. What to verify at each step
        3. Potential issues to watch for

        Be concise and specific. Tester will follow your plan.
      `,
      'pilot.planTest'
    );
  }

  async reviewNewPage(task: Test, currentState: ActionResult): Promise<string> {
    if (!this.conversation) return '';

    tag('substep').log('🧭 Pilot reviewing new page...');

    const pageSummary = await this.researcher.summary(currentState, { allowNewResearch: false });
    if (!pageSummary) return '';

    const stateContext = this.buildStateContext(currentState);

    this.conversation.cleanupTag('page_summary', '...trimmed...', 1);

    return this.sendToPilot(
      dedent`
        Navigated to new page.

        <state>
        ${stateContext}
        </state>

        <page_summary>
        ${pageSummary}
        </page_summary>

        ${this.formatExpectations(task)}

        Review the new page and plan the next testing steps to achieve remaining goals.
      `,
      'pilot.reviewNewPage'
    );
  }

  async analyzeProgress(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<string> {
    tag('substep').log('🧭 Pilot analyzing progress...');

    if (!this.conversation) {
      const pageSummary = await this.researcher.summary(currentState, { allowNewResearch: false });
      const agenticModel = this.provider.getAgenticModel('pilot');
      this.conversation = this.provider.startConversation(this.getSystemPrompt(task, currentState, pageSummary), 'pilot', agenticModel);
    }

    const toolCalls = testerConversation.getToolExecutions().slice(-this.stepsToReview);
    const actionsContext = this.formatActions(toolCalls);
    const stateContext = this.buildStateContext(currentState);

    this.conversation.cleanupTag('recent_actions', '...trimmed...', 2);

    const hasFailures = toolCalls.some((t) => !t.wasSuccessful);

    const text = await this.sendToPilot(
      dedent`
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
      { tools: hasFailures, maxToolRoundtrips: hasFailures ? 2 : 0 }
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

  private async sendToPilot(userText: string, functionId: string, opts: { tools?: boolean; maxToolRoundtrips?: number } = {}): Promise<string> {
    this.conversation!.addUserText(userText);
    const tools = opts.tools ? this.agentTools : undefined;
    const result = await this.provider.invokeConversation(this.conversation!, tools, {
      maxToolRoundtrips: opts.maxToolRoundtrips ?? 0,
      agentName: 'pilot',
      experimental_telemetry: { functionId },
    });
    return result?.response?.text || '';
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
        ${currentState.ariaSnapshot}
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
      const uiMap = await this.researcher.research(currentState);
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

  private formatActions(toolCalls: any[]): string {
    const ASSERTION_TOOLS = ['verify', 'see', 'research', 'context'];

    return toolCalls
      .map((t) => {
        const status = t.wasSuccessful ? 'SUCCESS' : 'FAILED';
        const kind = ASSERTION_TOOLS.includes(t.toolName) ? 'CHECK' : 'ACTION';
        const description = t.input?.explanation || t.input?.request || truncateJson(t.input);
        const resultMessage = t.output?.message || '';
        const errorDetail = t.output?.attempts?.find((a: any) => a.error)?.error;

        let line = `[${status}] ${kind} ${t.toolName}: ${description}`;
        if (resultMessage) line += `\n   result: ${resultMessage}`;
        if (errorDetail && errorDetail !== resultMessage) line += `\n   error: ${errorDetail}`;

        const ariaDiff = t.output?.pageDiff?.ariaChanges;
        if (ariaDiff) line += `\n   ${condenseAriaDiff(ariaDiff, t.output?.pageDiff?.urlChanged)}`;

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
      - If diagnosis is unclear, ariaDiff is empty, and your previous advice didn't help → suggest Tester use see() to visually inspect the page. But ONLY as a last resort after other diagnostics failed.

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
      - reset() — return to initial page
      - finish(verify?) — complete test
      - stop(reason) — abort test
      - record(notes) — document findings

      Response format:
      PROGRESS: <1 sentence assessment>
      NEXT: <specific actionable instruction for Tester>
    `;
  }
}
