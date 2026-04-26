import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../../action-result.ts';
import { ExperienceTracker, type SessionStep } from '../../experience-tracker.ts';
import type { PlaywrightRecorder } from '../../playwright-recorder.ts';
import type { Reporter, ReporterStep } from '../../reporter.ts';
import type { StateManager } from '../../state-manager.ts';
import { type Task, Test } from '../../test-plan.ts';
import { tag } from '../../utils/logger.ts';
import { extractStatePath } from '../../utils/url-matcher.ts';
import type { Conversation, ToolExecution } from '../conversation.ts';
import type { Provider } from '../provider.ts';
import { CODECEPT_TOOLS } from '../tools.ts';
import { type Constructor, debugLog } from './mixin.ts';
import { getExecutionLabel, isNonReusableCode, stripComments } from './utils.ts';

export interface ExperienceMethods {
  saveSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<void>;
}

export function WithExperience<T extends Constructor>(Base: T) {
  return class extends Base {
    declare provider: Provider;
    declare experienceTracker: ExperienceTracker;
    declare reporter: Reporter | undefined;
    declare stateManager: StateManager | undefined;
    declare recorder: PlaywrightRecorder | undefined;
    declare isPlaywrightFramework: () => boolean;
    declare toCode: (conversation: Conversation, scenario: string) => string;
    declare toPlaywrightCode: (conversation: Conversation, scenario: string) => Promise<string>;

    async saveSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<void> {
      debugLog('Saving session experience');

      const result = task.getRunResult();
      const toolExecutions = conversation.getToolExecutions();

      if (task instanceof Test) {
        task.generatedCode = this.isPlaywrightFramework() ? await this.toPlaywrightCode(conversation, task.description) : this.toCode(conversation, task.description);
      }

      const steps = await this.extractSteps(toolExecutions);

      const skipExperience = result === 'failed' || (task instanceof Test && (task.hasFailed || task.isSkipped));
      if (!skipExperience) {
        await this.detectRetryPatterns(toolExecutions, initialState);
        const body = await this.curateFlow(steps, task, initialState);
        if (body.trim()) {
          const relatedUrls = this.extractVisitedUrls(toolExecutions, initialState.url || '');
          this.experienceTracker.writeFlow(initialState, body, relatedUrls);
        }
      }

      if (task instanceof Test && result !== 'failed') {
        await this.reportSession(task, steps);
      }

      tag('substep').log(`Historian saved session for: ${task.description}`);
    }

    private async reportSession(test: Test, steps: SessionStep[]): Promise<void> {
      if (!this.reporter) return;

      const reporterSteps: ReporterStep[] = steps.map((step) => ({
        title: step.message,
        status: step.status === 'passed' ? 'passed' : 'failed',
        code: step.code ? step.code.split('\n').filter((l) => l.trim()) : [],
        discovery: step.discovery,
      }));

      await this.reporter.reportSteps(test, reporterSteps);
    }

    private async extractSteps(toolExecutions: ToolExecution[]): Promise<SessionStep[]> {
      const stepsWithDiffs: Array<{ step: SessionStep; ariaDiff: string | null }> = [];

      for (const exec of toolExecutions) {
        if (!CODECEPT_TOOLS.includes(exec.toolName as any)) continue;
        if (!exec.output?.code) continue;
        if (!exec.wasSuccessful) continue;
        if (isNonReusableCode(exec.output.code)) continue;

        const step: SessionStep = {
          message: getExecutionLabel(exec, `Executed ${exec.toolName}`),
          status: 'passed',
          tool: exec.toolName,
          code: stripComments(exec.output.code),
        };

        stepsWithDiffs.push({ step, ariaDiff: exec.output?.pageDiff?.ariaChanges || null });
      }

      await this.analyzeDiscoveries(stepsWithDiffs);

      return stepsWithDiffs.map((s) => s.step);
    }

    private async curateFlow(steps: SessionStep[], task: Task, initialState: ActionResult): Promise<string> {
      if (steps.length === 0) return '';

      const existingExperience = this.experienceTracker
        .getRelevantExperience(initialState)
        .map((e) => e.content)
        .filter(Boolean)
        .join('\n');
      const existingSummary = existingExperience.length > 2000 ? existingExperience.substring(0, 2000) : existingExperience;

      const stepsBlock = steps
        .map((s, i) => {
          const lines = [`Step ${i + 1}: ${s.message}`];
          if (s.code) {
            lines.push('```js');
            lines.push(s.code);
            lines.push('```');
          }
          if (s.discovery) {
            for (const d of s.discovery.split('\n').filter((line) => line.trim())) {
              lines.push(`> ${d.trim()}`);
            }
          }
          return lines.join('\n');
        })
        .join('\n\n');

      const expected = task instanceof Test && task.expected.length > 0 ? task.expected.map((e) => `- ${e}`).join('\n') : '';
      const notes = task.notesToString();

      const prompt = dedent`
        You are curating a how-to recipe from a recorded test run. Decide whether the run produced
        anything reusable, and if so, output a single \`## FLOW: ...\` markdown block. Otherwise output
        an empty response (no text at all).

        <original_scenario>
        ${task.description}
        </original_scenario>

        ${expected ? `<expected_outcomes>\n${expected}\n</expected_outcomes>` : ''}

        ${notes ? `<run_notes>\n${notes}\n</run_notes>` : ''}

        <recorded_steps>
        ${stepsBlock}
        </recorded_steps>

        ${existingSummary ? `<existing_experience_for_this_page>\n${existingSummary}\n</existing_experience_for_this_page>` : ''}

        Output a FLOW block in EXACTLY this format:

        ## FLOW: <imperative how-to that matches what the steps actually accomplished>

        * <action description>

        \`\`\`js
        <code from input>
        \`\`\`

        > <relevant element or observation worth remembering>

        * <next action>

        \`\`\`js
        <code from input>
        \`\`\`

        ---

        Rules:
        - Title is an imperative phrase answering "how do I X". It must describe what the steps
          ACTUALLY accomplished, not the original scenario if the run drifted off course.
        - Drop steps that wandered onto unrelated pages or did not contribute to a reusable recipe.
        - Drop discoveries that are noise (loading states, timestamps, repeated buttons).
        - Code blocks may only contain code that appears verbatim in <recorded_steps>. Do not invent
          CodeceptJS calls.
        - Lowercase the first letter of the title. No trailing punctuation.

        Return an EMPTY response (no markdown, no explanation) if any of:
        - The original scenario is a negative test (verifying an error, validation rejection, blocked
          or forbidden action, "should fail" expectation).
        - The surviving steps do not accomplish anything reusable.
        - The recipe duplicates a recipe already present in <existing_experience_for_this_page>.
      `;

      try {
        const response = await this.provider.chat(
          [
            { role: 'system', content: 'Curate reusable how-to recipes from recorded test runs. Be selective — only emit a FLOW when the steps demonstrate a coherent, reusable, positive recipe. Otherwise return nothing.' },
            { role: 'user', content: prompt },
          ],
          this.provider.getModelForAgent('historian'),
          { agentName: 'historian', telemetryFunctionId: 'historian.curateFlow' }
        );

        const body = (response?.text || '').trim();
        if (!body) {
          debugLog('curateFlow returned empty — skipping flow write');
          return '';
        }
        if (!body.includes('## FLOW:')) {
          debugLog('curateFlow output missing ## FLOW: heading — skipping');
          return '';
        }
        return `${body}\n`;
      } catch (error: any) {
        debugLog('curateFlow failed, skipping flow write: %s', error.message);
        return '';
      }
    }

    private async detectRetryPatterns(toolExecutions: ToolExecution[], initialState: ActionResult): Promise<void> {
      if (!this.experienceTracker || !this.stateManager) return;

      const failedByTool = new Map<string, ToolExecution[]>();
      const candidates: Array<{ failed: ToolExecution[]; success: ToolExecution }> = [];

      for (const exec of toolExecutions) {
        if (!CODECEPT_TOOLS.includes(exec.toolName as any)) continue;
        if (!exec.output?.code) continue;

        if (!exec.wasSuccessful) {
          const bucket = failedByTool.get(exec.toolName) || [];
          bucket.push(exec);
          failedByTool.set(exec.toolName, bucket);
          continue;
        }

        const failed = failedByTool.get(exec.toolName);
        if (failed?.length) {
          candidates.push({ failed: [...failed], success: exec });
          failedByTool.set(exec.toolName, []);
        }
      }

      if (candidates.length === 0) return;

      const prompt = dedent`
        Analyze these retry patterns where a tool failed multiple times before succeeding.
        For each candidate, determine which failed attempts were trying to do the same thing as the success.

        ${candidates
          .map(
            (c, i) => dedent`
          Candidate ${i}:
          Failed attempts:
          ${c.failed.map((f, j) => `  ${j}: ${getExecutionLabel(f, f.toolName)} → code: ${f.output?.code}`).join('\n')}
          Succeeded:
            ${getExecutionLabel(c.success, c.success.toolName)} → code: ${c.success.output.code}
        `
          )
          .join('\n\n')}

        For each candidate where failures share the same intent as the success:
        - candidateIndex: index of the candidate
        - failedIndices: which failed attempts share the same intent
        - intent: business-focused description of what was being done
        - explanation: actionable tip explaining which element works and what to avoid
      `;

      const schema = z.object({
        retryPatterns: z.array(
          z.object({
            candidateIndex: z.number(),
            failedIndices: z.array(z.number()),
            intent: z.string(),
            explanation: z.string(),
          })
        ),
      });

      try {
        const response = await this.provider.generateObject(
          [
            { role: 'system', content: 'Analyze retry patterns in web testing tool executions. Identify when failed attempts share the same intent as a successful one.' },
            { role: 'user', content: prompt },
          ],
          schema
        );

        for (const pattern of response?.object?.retryPatterns || []) {
          const candidate = candidates[pattern.candidateIndex];
          if (!candidate) continue;

          const url = candidate.success.output?.pageDiff?.currentUrl;
          let state: ActionResult = initialState;

          if (url && url !== initialState.url) {
            const transition = this.stateManager.getLastVisitToPath(url);
            if (transition) {
              state = ActionResult.fromState(transition.toState);
            }
          }

          if (isNonReusableCode(candidate.success.output.code)) continue;
          this.experienceTracker.writeAction(state, { title: pattern.intent, code: candidate.success.output.code, explanation: pattern.explanation });
        }

        debugLog('Detected %d retry patterns', response?.object?.retryPatterns?.length || 0);
      } catch (error: any) {
        debugLog('Failed to detect retry patterns: %s', error.message);
      }
    }

    private async analyzeDiscoveries(stepsWithDiffs: Array<{ step: SessionStep; ariaDiff: string | null }>): Promise<void> {
      if (!stepsWithDiffs.some((s) => s.ariaDiff)) return;

      const prompt = this.buildDiscoveryPrompt(stepsWithDiffs);

      const schema = z.object({
        discoveries: z.array(
          z.object({
            stepNumber: z.number(),
            discoveries: z.array(z.string()),
          })
        ),
      });

      try {
        const response = await this.provider.generateObject(
          [
            { role: 'system', content: 'Analyze test execution steps and identify valuable UI discoveries. Return multiple discoveries per step when multiple new elements appear. Return no discoveries for steps with no meaningful changes.' },
            { role: 'user', content: prompt },
          ],
          schema
        );

        for (const { stepNumber, discoveries } of response?.object?.discoveries || []) {
          const stepIndex = stepNumber - 1;
          if (!stepsWithDiffs[stepIndex]) continue;
          if (discoveries.length === 0) continue;
          stepsWithDiffs[stepIndex].step.discovery = discoveries.join('\n');
        }
      } catch (error: any) {
        debugLog('Failed to analyze discoveries: %s', error.message);
      }
    }

    private buildDiscoveryPrompt(stepsWithDiffs: Array<{ step: SessionStep; ariaDiff: string | null }>): string {
      const stepsBlock = stepsWithDiffs
        .map(({ step, ariaDiff }, i) => {
          const lines = [`Step ${i + 1}: ${step.message}`];
          if (ariaDiff) lines.push(ariaDiff);
          return lines.join('\n');
        })
        .join('\n\n');

      return dedent`
        Review these test steps and their ARIA diffs. Identify new UI elements that appeared
        which could be valuable for deeper testing of this feature or related features that can
        be triggered from this flow.

        Return MULTIPLE discoveries per step when multiple new elements appear (buttons, inputs,
        links, errors, warnings — list them all). Return an empty array for a step with no new
        elements or only generic changes (loading spinners, timestamps).

        <steps>
        ${stepsBlock}
        </steps>

        Format:
        - stepNumber: which step revealed these elements
        - discoveries: array of brief descriptions, e.g. ["A new button appeared: Publish To Twitter", "A new input field appeared: Description"]

        Only return actionable elements that could lead to new test scenarios.
      `;
    }

    private extractVisitedUrls(toolExecutions: ToolExecution[], initialUrl: string): string[] {
      const urls = new Set<string>();
      const initialPath = extractStatePath(initialUrl);

      for (const exec of toolExecutions) {
        const currentUrl = exec.output?.pageDiff?.currentUrl;
        if (!currentUrl) continue;

        const relativePath = extractStatePath(currentUrl);
        if (relativePath && relativePath !== initialPath) {
          urls.add(relativePath);
        }
      }

      return [...urls];
    }
  };
}
