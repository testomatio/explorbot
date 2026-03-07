import dedent from 'dedent';
import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import type Explorer from '../explorer.ts';
import { type Test, TestResult } from '../test-plan.ts';
import { collectInteractiveNodes, detectFocusArea, extractFocusedElement } from '../utils/aria.ts';
import { tag } from '../utils/logger.ts';
import { truncateJson } from '../utils/strings.ts';
import type { Agent } from './agent.ts';
import type { Conversation } from './conversation.ts';
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
  private pendingVerdict: PendingVerdict | null = null;

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
    this.pendingVerdict = null;
  }

  getLastAnalysis(): string | null {
    if (!this.conversation) return null;
    return this.conversation.getLastMessage() || null;
  }

  get hasPendingVerdict(): boolean {
    return this.pendingVerdict !== null;
  }

  requestVerdict(verdict: PendingVerdict): void {
    this.pendingVerdict = verdict;
  }

  async reviewVerdict(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<void> {
    if (!this.pendingVerdict) return;

    const verdict = this.pendingVerdict;
    this.pendingVerdict = null;

    tag('substep').log(`🧭 Pilot reviewing ${verdict.type} verdict...`);

    const toolCalls = testerConversation.getToolExecutions().slice(-this.stepsToReview);
    const actionsContext = this.formatActions(toolCalls);
    const checked = task.getCheckedExpectations();
    const remaining = task.getRemainingExpectations();
    const stateContext = this.buildStateContext(currentState);
    const notes = task.notesToString() || 'No notes recorded.';

    const verifyInfo = verdict.verify ? `Tester verification: "${verdict.verify}" — ${verdict.verified ? 'PASSED' : 'FAILED'}${verdict.verifyDetails ? ` (${verdict.verifyDetails})` : ''}` : '';

    const schema = z.object({
      decision: z.enum(['pass', 'fail', 'continue']).describe('pass = test succeeded, fail = test failed, continue = tester should keep going'),
      reason: z.string().max(250).describe('For pass/fail: brief explanation. For continue: explain why rejected, suggest alternative approaches not yet tried, suggest reset as last resort.'),
    });

    try {
      const response = await this.provider.generateObject(
        [
          {
            role: 'system',
            content: dedent`
              You are Pilot — the final decision maker for test pass/fail.
              Tester has requested to ${verdict.type} the test. Review the evidence and decide.

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

              TRIVIAL VERIFICATION CHECK: If the verify assertion describes a state that was ALREADY TRUE before the test started (e.g., page content visible on initial load, items that existed before any action), the verification proves nothing. Reject with "continue" and explain that verification must prove the scenario ACTION changed something.

              NEGATIVE TESTS: Some scenarios test that something CANNOT or SHOULD NOT happen.
              Patterns: "without a name", "with invalid data", "empty field", "wrong password", "unauthorized", "duplicate".
              For negative tests, success means the system PREVENTED the action — error messages, validation, disabled buttons.
              Example: "Create X without a name" PASSES if X was NOT created and validation appeared.

              ${this.buildDeletionScope(task)}

              EXPECTED RESULTS (milestones, not the goal):
              ${task.expected.map((e) => `- ${e}`).join('\n')}
            `,
          },
          {
            role: 'user',
            content: dedent`
              Tester wants to ${verdict.type} the test.
              ${verifyInfo}

              <state>
              ${stateContext}
              </state>

              CHECKED: ${checked.length > 0 ? checked.join(', ') : 'none'}
              REMAINING: ${remaining.length > 0 ? remaining.join(', ') : 'none'}

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
            `,
          },
        ],
        schema,
        this.provider.getAgenticModel('pilot'),
        { agentName: 'pilot', experimental_telemetry: { functionId: 'pilot.reviewVerdict' } }
      );

      const result = response?.object;
      if (!result) {
        this.applyFallbackVerdict(task, verdict);
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
      testerConversation.addUserText(`Pilot rejected ${verdict.type}: ${result.reason}`);
    } catch (error: any) {
      tag('warning').log(`🧭 Pilot verdict failed: ${error.message}, falling back to tester judgment`);
      this.applyFallbackVerdict(task, verdict);
    }
  }

  async finalReview(task: Test, currentState: ActionResult, testerConversation: Conversation): Promise<void> {
    if (task.hasFinished) return;

    this.requestVerdict({ type: 'stop' });
    await this.reviewVerdict(task, currentState, testerConversation);
  }

  private applyFallbackVerdict(task: Test, verdict: PendingVerdict): void {
    if (verdict.type === 'finish') {
      task.finish(TestResult.PASSED);
    } else {
      task.finish(TestResult.FAILED);
    }
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
    const checked = task.getCheckedExpectations();
    const remaining = task.getRemainingExpectations();
    const stateContext = this.buildStateContext(currentState);

    this.conversation.cleanupTag('recent_actions', '...trimmed...', 2);

    this.conversation.addUserText(dedent`
      <state>
      ${stateContext}
      </state>

      CHECKED: ${checked.length > 0 ? checked.join(', ') : 'none'}
      REMAINING: ${remaining.length > 0 ? remaining.join(', ') : 'none'}

      <recent_actions>
      ${actionsContext || 'None'}
      </recent_actions>

      What should Tester do next?
    `);

    const hasFailures = toolCalls.some((t) => !t.wasSuccessful);

    const result = await this.provider.generateWithTools(this.conversation.messages, this.provider.getAgenticModel('pilot'), this.agentTools, {
      maxToolRoundtrips: hasFailures ? 2 : 0,
      agentName: 'pilot',
      experimental_telemetry: { functionId: 'pilot.analyze' },
    });

    const text = result?.text || '';
    this.conversation.addAssistantText(text);

    const contextToAttach = await this.fetchRequestedContext(text, currentState);

    if (contextToAttach) {
      return `${text}\n\n${contextToAttach}`;
    }

    return text;
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

        let line = `[${status}] ${kind} ${t.toolName}: ${description}`;
        if (resultMessage) line += `\n   result: ${resultMessage}`;

        const ariaDiff = t.output?.pageDiff?.ariaDiff;
        if (ariaDiff) line += `\n   ariaDiff: ${ariaDiff}`;

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
      1. Detect when Tester is stuck: repeated failures, loops, or wrong direction
      2. Track which expectations have been checked and which remain
      3. When problems are detected, suggest concrete alternative approaches
      4. When everything is going well, give brief encouragement and let Tester continue

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

      Response format:
      PROGRESS: <1 sentence assessment>
      NEXT: <specific actionable instruction for Tester>
    `;
  }
}

type PendingVerdict = {
  type: 'finish' | 'stop';
  verify?: string;
  verified?: boolean;
  verifyDetails?: string;
};
