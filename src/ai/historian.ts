import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import type { ExplorbotConfig } from '../config.ts';
import { ConfigParser } from '../config.ts';
import { ExperienceTracker, type SessionStep } from '../experience-tracker.ts';
import { KnowledgeTracker } from '../knowledge-tracker.ts';
import { PlaywrightRecorder, renderAssertion, renderCall, type TraceCall } from '../playwright-recorder.ts';
import { type Reporter, type ReporterStep } from '../reporter.ts';
import type { StateManager } from '../state-manager.ts';
import { type Plan, type Task, Test } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { extractStatePath } from '../utils/url-matcher.ts';
import type { Conversation, ToolExecution } from './conversation.ts';
import type { Provider } from './provider.ts';
import { ASSERTION_TOOLS, CODECEPT_TOOLS } from './tools.ts';

const PLAYWRIGHT_EMITTED_TOOLS = [...CODECEPT_TOOLS, ...ASSERTION_TOOLS] as const;

const debugLog = createDebug('explorbot:historian');

export class Historian {
  private provider: Provider;
  private experienceTracker: ExperienceTracker;
  private reporter?: Reporter;
  private stateManager?: StateManager;
  private savedFiles = new Set<string>();
  private config?: ExplorbotConfig;
  private recorder?: PlaywrightRecorder;

  constructor(provider: Provider, experienceTracker?: ExperienceTracker, reporter?: Reporter, stateManager?: StateManager, config?: ExplorbotConfig, recorder?: PlaywrightRecorder) {
    this.provider = provider;
    this.experienceTracker = experienceTracker || new ExperienceTracker();
    this.reporter = reporter;
    this.stateManager = stateManager;
    this.config = config;
    this.recorder = recorder;
  }

  private isPlaywrightFramework(): boolean {
    return this.config?.ai?.agents?.historian?.framework === 'playwright';
  }

  getSavedFiles(): string[] {
    return [...this.savedFiles];
  }

  async saveSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<void> {
    debugLog('Saving session experience');

    const result = this.determineResult(task);
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
    const stepsWithDiffs: Array<{ step: SessionStep; ariaDiff: string | null; urlChanged: boolean }> = [];

    for (const exec of toolExecutions) {
      if (!CODECEPT_TOOLS.includes(exec.toolName as any)) continue;
      if (!exec.output?.code) continue;
      if (!exec.wasSuccessful) continue;
      if (isNonReusableCode(exec.output.code)) continue;

      const message = this.getExecutionLabel(exec, `Executed ${exec.toolName}`);
      const ariaDiff = exec.output?.pageDiff?.ariaChanges || null;
      const urlChanged = exec.output?.pageDiff?.urlChanged || false;

      const step: SessionStep = {
        message,
        status: 'passed',
        tool: exec.toolName,
        code: this.stripComments(exec.output.code),
      };

      stepsWithDiffs.push({ step, ariaDiff, urlChanged });
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
        ${c.failed.map((f, j) => `  ${j}: ${this.getExecutionLabel(f, f.toolName)} → code: ${f.output?.code}`).join('\n')}
        Succeeded:
          ${this.getExecutionLabel(c.success, c.success.toolName)} → code: ${c.success.output.code}
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

  private async analyzeDiscoveries(stepsWithDiffs: Array<{ step: SessionStep; ariaDiff: string | null; urlChanged: boolean }>): Promise<void> {
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

  private buildDiscoveryPrompt(stepsWithDiffs: Array<{ step: SessionStep; ariaDiff: string | null; urlChanged: boolean }>): string {
    let prompt = dedent`
      Review these test steps and their ARIA diffs. Identify new UI elements that appeared
      which could be valuable for:
      - Deeper testing of this feature
      - Related features that can be triggered from this flow

      IMPORTANT:
      - Return MULTIPLE discoveries per step when multiple new elements appear (e.g., if 3 buttons appeared, return an array with 3 discoveries for that step)
      - Return NO discoveries (empty array) for a step if nothing new appeared or if elements were already discovered in previous steps
      - Only include steps that have discoveries

      Steps:
    `;

    for (let i = 0; i < stepsWithDiffs.length; i++) {
      const { step, ariaDiff, urlChanged } = stepsWithDiffs[i];
      prompt += `\n\nStep ${i + 1}: ${step.message}`;
      if (ariaDiff) {
        prompt += `\n${ariaDiff}`;
      }
    }

    prompt += dedent`

      Return discoveries in format:
      - stepNumber: which step revealed these elements
      - discoveries: array of brief descriptions like ["A new button appeared: Publish To Twitter", "A new input field appeared: Description"]

      Only return elements that are actionable and could lead to new test scenarios.
      Ignore generic UI changes (loading spinners, timestamps, etc).
      If errors or warnings appeared in the step, include them in the discoveries array.
      If multiple buttons, inputs, links, or other actionable elements appeared in the same step, include all of them in the discoveries array.
    `;

    return prompt;
  }

  private determineResult(task: Task): 'success' | 'partial' | 'failed' {
    if ('isSuccessful' in task && (task as any).isSuccessful) return 'success';
    if ('hasAchievedAny' in task && (task as any).hasAchievedAny()) return 'partial';

    const hasPassedNotes = Object.values(task.notes).some((n) => n.status === 'passed');
    if (hasPassedNotes) return 'partial';
    return 'failed';
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

  toCode(conversation: Conversation, scenario: string): string {
    const toolExecutions = conversation.getToolExecutions();
    const TRACKABLE_TOOLS = [...CODECEPT_TOOLS, ...ASSERTION_TOOLS];
    const successfulSteps = toolExecutions.filter((exec) => exec.wasSuccessful && TRACKABLE_TOOLS.includes(exec.toolName as any) && exec.output?.code);

    if (successfulSteps.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(`Scenario('${this.escapeString(scenario)}', ({ I }) => {`);

    for (const exec of successfulSteps) {
      if (isNonReusableCode(exec.output.code)) continue;
      const explanation = this.getExecutionLabel(exec);
      if (explanation) {
        lines.push('');
        lines.push(`  Section('${this.escapeString(explanation)}');`);
      }
      const code = this.stripComments(exec.output.code);
      const codeLines = code.includes('\n') ? code.split('\n') : code.split('; ');
      for (const codeLine of codeLines) {
        const trimmed = codeLine.trim();
        if (trimmed) {
          lines.push(`  ${trimmed}`);
        }
      }
    }

    lines.push('});');
    return lines.join('\n');
  }

  async toPlaywrightCode(conversation: Conversation, scenario: string): Promise<string> {
    const toolExecutions = conversation.getToolExecutions();
    const successfulSteps = toolExecutions.filter((exec) => exec.wasSuccessful && PLAYWRIGHT_EMITTED_TOOLS.includes(exec.toolName as any));

    const callsByGroup = this.recorder ? await this.recorder.exportChunk() : new Map<string, TraceCall[]>();

    const stepLines: string[] = [];
    for (const exec of successfulSteps) {
      const explanation = this.getExecutionLabel(exec);
      const execLines: string[] = [];
      const groupId: string | undefined = exec.output?.playwrightGroupId;
      const calls = groupId ? callsByGroup.get(groupId) || [] : [];
      for (const call of calls) {
        execLines.push(`  ${renderCall(call)}`);
      }
      const assertions: Array<{ name: string; args: any[] }> = exec.output?.assertionSteps || [];
      for (const assertion of assertions) {
        const line = renderAssertion(assertion);
        if (line) execLines.push(`  ${line}`);
      }
      if (execLines.length === 0) continue;
      if (explanation) {
        stepLines.push('');
        stepLines.push(`  // ${this.escapeString(explanation)}`);
      }
      stepLines.push(...execLines);
    }

    const pilotVerifications = this.recorder ? this.recorder.drainVerifications() : [];
    if (pilotVerifications.length > 0) {
      stepLines.push('');
      stepLines.push('  // Verification');
      for (const step of pilotVerifications) {
        const line = renderAssertion(step);
        if (line) stepLines.push(`  ${line}`);
      }
    }

    if (stepLines.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(`test('${this.escapeString(scenario)}', async ({ page }) => {`);
    lines.push(...stepLines);
    lines.push('});');
    return lines.join('\n');
  }

  savePlanToFile(plan: Plan): string {
    if (this.isPlaywrightFramework()) {
      return this.savePlaywrightPlanToFile(plan);
    }
    const lines: string[] = [];

    lines.push(`import step, { Section } from 'codeceptjs/steps';`);
    lines.push('');
    lines.push(`Feature('${this.escapeString(plan.title)}')`);
    lines.push('');

    const startUrl = plan.url || plan.tests[0]?.startUrl;
    if (startUrl) {
      lines.push('Before(({ I }) => {');
      lines.push(`  I.amOnPage('${this.escapeString(startUrl)}');`);
      lines.push(...this.getKnowledgeLines(startUrl));
      lines.push('});');
      lines.push('');
    }

    for (const test of plan.tests) {
      if (test.generatedCode) {
        if (test.isSuccessful) {
          lines.push(test.generatedCode);
        } else {
          lines.push(`// FAILED: ${test.scenario}`);
          lines.push(test.generatedCode.replace(/Scenario\(/, 'Scenario.skip('));
        }
        lines.push('');
        continue;
      }

      lines.push(`Scenario.todo('${this.escapeString(test.scenario)}', ({ I }) => {`);
      if (test.plannedSteps.length > 0) {
        for (const step of test.plannedSteps) {
          lines.push(`  // ${step}`);
        }
      } else {
        lines.push(`  // ${test.scenario}`);
      }
      lines.push('});');
      lines.push('');
    }

    const testsDir = ConfigParser.getInstance().getTestsDir();
    mkdirSync(testsDir, { recursive: true });

    const filename = plan.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const filePath = join(testsDir, `${filename}.js`);
    writeFileSync(filePath, lines.join('\n'));
    this.savedFiles.add(filePath);

    tag('substep').log(`Saved plan tests to: ${filePath}`);
    return filePath;
  }

  savePlaywrightPlanToFile(plan: Plan): string {
    const lines: string[] = [];

    lines.push(`import { test, expect } from '@playwright/test';`);
    lines.push('');
    lines.push(`test.describe('${this.escapeString(plan.title)}', () => {`);

    const startUrl = plan.url || plan.tests[0]?.startUrl;
    if (startUrl) {
      lines.push('  test.beforeEach(async ({ page }) => {');
      lines.push(`    await page.goto('${this.escapeString(startUrl)}');`);
      for (const line of this.getPlaywrightKnowledgeLines(startUrl, '    ')) {
        lines.push(line);
      }
      lines.push('  });');
      lines.push('');
    }

    for (const test of plan.tests) {
      if (test.generatedCode) {
        const indented = indentBlock(test.generatedCode, '  ');
        if (test.isSuccessful) {
          lines.push(indented);
        } else {
          lines.push(`  // FAILED: ${this.escapeString(test.scenario)}`);
          lines.push(indented.replace(/test\(/, 'test.skip('));
        }
        lines.push('');
        continue;
      }

      lines.push(`  test.fixme('${this.escapeString(test.scenario)}', async ({ page }) => {`);
      if (test.plannedSteps.length > 0) {
        for (const step of test.plannedSteps) {
          lines.push(`    // ${step}`);
        }
      } else {
        lines.push(`    // ${test.scenario}`);
      }
      lines.push('  });');
      lines.push('');
    }

    lines.push('});');

    const testsDir = ConfigParser.getInstance().getTestsDir();
    mkdirSync(testsDir, { recursive: true });

    const filename = plan.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const filePath = join(testsDir, `${filename}.spec.ts`);
    writeFileSync(filePath, lines.join('\n'));
    this.savedFiles.add(filePath);

    tag('substep').log(`Saved plan tests to: ${filePath}`);
    return filePath;
  }

  rewriteScenarioInFile(filePath: string, healedSteps: Array<{ test: string; original: string; healed: string }>): void {
    let content = readFileSync(filePath, 'utf-8');

    for (const step of healedSteps) {
      if (!content.includes(step.original)) continue;
      content = content.replace(step.original, step.healed);
    }

    writeFileSync(filePath, content);
    this.savedFiles.add(filePath);
    tag('substep').log(`Updated test file with healed steps: ${filePath}`);
  }

  private getExecutionLabel(exec: ToolExecution, fallback?: string): string {
    return exec.input?.explanation || exec.input?.assertion || exec.input?.note || fallback || '';
  }

  private escapeString(str: string): string {
    return str.replace(/'/g, "\\'").replace(/\n/g, ' ');
  }

  private getKnowledgeLines(url: string, indent = '  '): string[] {
    const knowledgeTracker = new KnowledgeTracker();
    const state = new ActionResult({ url });
    const { wait, waitForElement, code } = knowledgeTracker.getStateParameters(state, ['wait', 'waitForElement', 'code']);

    const lines: string[] = [];
    if (wait !== undefined) {
      lines.push(`${indent}I.wait(${wait});`);
    }
    if (waitForElement) {
      lines.push(`${indent}I.waitForElement(${JSON.stringify(waitForElement)});`);
    }
    if (code) {
      for (const codeLine of code.split('\n')) {
        const trimmed = codeLine.trim();
        if (trimmed) lines.push(`${indent}${trimmed}`);
      }
    }
    return lines;
  }

  private getPlaywrightKnowledgeLines(url: string, indent = '    '): string[] {
    const knowledgeTracker = new KnowledgeTracker();
    const state = new ActionResult({ url });
    const { wait, waitForElement } = knowledgeTracker.getStateParameters(state, ['wait', 'waitForElement']);

    const lines: string[] = [];
    if (wait !== undefined) {
      lines.push(`${indent}await page.waitForTimeout(${Number(wait) * 1000});`);
    }
    if (waitForElement) {
      lines.push(`${indent}await page.locator(${JSON.stringify(waitForElement)}).waitFor();`);
    }
    return lines;
  }

  private stripComments(code: string): string {
    return code
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*');
      })
      .join('\n');
  }
}

export function isNonReusableCode(code: string): boolean {
  return /\bI\.clickXY\s*\(/.test(code);
}

function indentBlock(block: string, indent: string): string {
  return block
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
}
