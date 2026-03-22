import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import type { WebPageState } from '../../state-manager.ts';
import { toolExecutionLabel } from '../conversation.ts';
import { type Constructor, type ModeContext, debugLog } from './mixin.ts';

export function WithTestMode<T extends Constructor>(Base: T) {
  return class extends Base {
    testModeTools(ctx: ModeContext): Record<string, any> {
      return {
        test: tool({
          description: dedent`
            Inspect test execution data. Use flags to control output depth.
            Tests are identified by sessionName (e.g. "brave-fox123").

            Examples:
              test()                                        — summary of all tests in plan (with sessionNames)
              test --session brave-fox123                   — overview with structured timeline (step, action, success, state, url)
              test --session brave-fox123 --step 5          — drill into step 5: full commands, code, attempts, error, suggestion
              test --session brave-fox123 --log             — full chronological execution log
              test --session brave-fox123 --code            — generated CodeceptJS code
              test --session brave-fox123 --pilot           — Pilot's last analysis
          `,
          inputSchema: z.object({
            session: z.string().optional().describe('Test sessionName (e.g. "brave-fox123"). Omit for plan summary.'),
            step: z.number().optional().describe('Drill into step N from timeline — shows full commands, code, attempts, suggestions'),
            log: z.boolean().optional().describe('Include full execution log'),
            code: z.boolean().optional().describe('Include generated CodeceptJS code'),
            pilot: z.boolean().optional().describe('Include Pilot analysis'),
          }),
          execute: async ({ session, step, log, code, pilot }) => {
            const plan = ctx.explorBot.getCurrentPlan();
            if (!plan || plan.tests.length === 0) return { success: false, message: 'No plan or tests available' };

            if (!session) {
              return {
                success: true,
                planTitle: plan.title,
                tests: plan.tests.map((t) => ({
                  session: t.sessionName,
                  scenario: t.scenario,
                  status: t.status,
                  result: t.result,
                  priority: t.priority,
                })),
              };
            }

            const t = plan.tests.find((test) => test.sessionName === session);
            if (!t) return { success: false, message: `Test "${session}" not found` };

            const testerConv = ctx.explorBot.agentTester().getConversation();

            if (step !== undefined) {
              if (!testerConv) return { success: false, message: 'No tester conversation available' };
              const execs = testerConv.getToolExecutions();
              if (step < 0 || step >= execs.length) return { success: false, message: `Step ${step} not found (${execs.length} steps available)` };
              const e = execs[step];
              return {
                success: true,
                step,
                action: e.toolName,
                explanation: toolExecutionLabel(e.input),
                commands: e.input?.commands || null,
                code: e.output?.code || null,
                attempts: e.output?.attempts || null,
                suggestion: e.output?.suggestion || null,
                wasSuccessful: e.wasSuccessful,
                error: e.wasSuccessful ? null : e.output?.message || null,
                ariaChanges: e.output?.pageDiff?.ariaChanges || null,
                url: e.output?.pageDiff?.currentUrl || null,
              };
            }

            const result: Record<string, any> = {
              success: true,
              session: t.sessionName,
              scenario: t.scenario,
              status: t.status,
              result: t.result,
              priority: t.priority,
              startUrl: t.startUrl,
              expected: t.expected,
              notes: t.notesToString(),
            };

            if (testerConv) {
              const execs = testerConv.getToolExecutions();
              let currentStateIdx = -1;
              let currentUrl = t.startUrl;

              result.timeline = execs.map((e, i) => {
                const newUrl = e.output?.pageDiff?.currentUrl;
                if (newUrl && newUrl !== currentUrl) {
                  currentUrl = newUrl;
                  currentStateIdx = t.states.findIndex((s, idx) => idx > currentStateIdx && s.url === newUrl);
                  if (currentStateIdx === -1) currentStateIdx = t.states.length - 1;
                }
                const entry: Record<string, any> = {
                  step: i,
                  action: e.toolName,
                  explanation: toolExecutionLabel(e.input),
                  success: e.wasSuccessful,
                  url: currentUrl,
                };
                if (currentStateIdx >= 0) entry.state = currentStateIdx;
                if (!e.wasSuccessful) entry.error = e.output?.message || null;
                if (e.output?.pageDiff?.ariaChanges) entry.ariaChanges = e.output.pageDiff.ariaChanges;
                return entry;
              });
            }

            if (log) result.log = t.getLogString();

            if (code) result.generatedCode = t.generatedCode || 'Not generated yet';

            if (pilot) {
              result.pilotAnalysis = ctx.explorBot.agentPilot().getLastAnalysis() || 'No analysis available';
            }

            return result;
          },
        }),

        inspectState: tool({
          description: dedent`
            Inspect previously visited page states. Shows URL, title, headings, associated files, and changes from previous state.
            Use bash('cat <file>') to read HTML/log files. Use navigate() to go to the state's URL.

            inspectState()                              — list all states from current page history
            inspectState --session brave-fox123         — list all states from test session
            inspectState --session brave-fox123 --index 2 — details of state 2: headings, ARIA, files, diff from state 1
          `,
          inputSchema: z.object({
            session: z.string().optional().describe('Test session name. Uses current page history if omitted.'),
            index: z.number().optional().describe('State index for detailed inspection'),
          }),
          execute: async ({ session, index }) => {
            let states: WebPageState[];

            if (session) {
              const plan = ctx.explorBot.getCurrentPlan();
              if (!plan) return { success: false, message: 'No plan available' };
              const t = plan.tests.find((test) => test.sessionName === session);
              if (!t) return { success: false, message: `Test "${session}" not found` };
              states = t.states;
            } else {
              const stateManager = ctx.explorBot.getExplorer().getStateManager();
              const history = stateManager.getStateHistory();
              const seen = new Set<string>();
              states = history
                .map((t) => t.toState)
                .filter((s) => {
                  const key = s.hash || s.url;
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                });
            }

            if (states.length === 0) return { success: true, states: [], message: 'No states recorded' };

            if (index === undefined) {
              return {
                success: true,
                states: states.map((s, i) => ({
                  index: i,
                  url: s.url,
                  title: s.title,
                  h1: s.h1,
                })),
              };
            }

            if (index < 0 || index >= states.length) {
              return { success: false, message: `State ${index} not found (${states.length} states available)` };
            }

            const state = states[index];
            const prev = index > 0 ? states[index - 1] : null;

            const changes: string[] = [];
            if (prev) {
              if (prev.url !== state.url) changes.push(`URL changed from ${prev.url} to ${state.url}`);
              if (prev.h1 !== state.h1 && state.h1) changes.push(`new H1: ${state.h1}`);
              if (prev.title !== state.title && state.title) changes.push(`title changed to: ${state.title}`);
            }

            const files: Record<string, string | null> = {
              html: state.htmlFile || null,
              screenshot: state.screenshotFile || null,
              log: state.logFile || null,
              aria: state.ariaSnapshotFile || null,
            };

            const suggestions: string[] = [];
            if (state.htmlFile) suggestions.push(`Use bash('cat ${state.htmlFile}') to see full HTML.`);
            if (state.url) suggestions.push(`Use navigate('${state.url}') to go to this page.`);

            debugLog('inspectState index=%d url=%s', index, state.url);

            return {
              success: true,
              index,
              url: state.url,
              title: state.title,
              h1: state.h1,
              h2: state.h2,
              h3: state.h3,
              h4: state.h4,
              ariaSnapshot: state.ariaSnapshot,
              files,
              changesFromPrevious: changes.length > 0 ? changes.join(', ') : null,
              suggestion: suggestions.join(' '),
            };
          },
        }),
      };
    }

    testModePrompt(): string {
      return dedent`
        <test_capabilities>
        - Test inspection: test() — timeline, steps, log, code, pilot analysis
        - State inspection: inspectState() — traverse previously visited page states
        - Test control: runCommand("/test stop"), runCommand("/test skip")
        </test_capabilities>

        <debugging_skill>
        When user asks "why did X fail?" or about test problems:

        1. IDENTIFY — test() without flags to list all tests. Name the failed test.
        2. OVERVIEW — test --session <name> to read the timeline. Find the step where behavior diverged.
        3. DRILL — test --session <name> --step N to inspect the failing step details.
        4. INSPECT STATE — inspectState --session <name> --index N to see page ARIA at that point.
        5. CONTEXT — Use bash('cat <file>') to read HTML/log files referenced by inspectState.
        6. REPORT — Explain with specifics: test name, which step failed, what was attempted, your hypothesis.

        Always name the test session and scenario when discussing results.
        Do NOT call done() after just reading data — investigate first.
        </debugging_skill>
      `;
    }

    testModeRules(): string {
      return dedent`
        - Use test() to inspect what the tester is doing
        - Use inspectState() to explore page states — use bash('cat <file>') for HTML/logs
        - When debugging test failures, follow <debugging_skill> — do not summarize without investigating
        - Use test() with minimal flags first, then drill into timeline steps and states as needed
        - Prefer ARIA over HTML — avoid full HTML reads
      `;
    }
  };
}

export interface TestModeMethods {
  testModeTools(ctx: ModeContext): Record<string, any>;
  testModePrompt(): string;
  testModeRules(): string;
}
