import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dedent from 'dedent';
import { z } from 'zod';
import { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import { KnowledgeTracker } from '../knowledge-tracker.ts';
import { ExperienceTracker, type SessionExperienceEntry, type SessionStep } from '../experience-tracker.ts';
import { type Reporter, type ReporterStep } from '../reporter.ts';
import type { StateManager } from '../state-manager.ts';
import { type Plan, type Task, Test } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import type { Conversation, ToolExecution } from './conversation.ts';
import type { Provider } from './provider.ts';
import { extractStatePath } from '../utils/url-matcher.ts';
import { ASSERTION_TOOLS, CODECEPT_TOOLS } from './tools.ts';

const debugLog = createDebug('explorbot:historian');

export class Historian {
  private provider: Provider;
  private experienceTracker: ExperienceTracker;
  private reporter?: Reporter;
  private stateManager?: StateManager;
  private savedFiles = new Set<string>();

  constructor(provider: Provider, experienceTracker?: ExperienceTracker, reporter?: Reporter, stateManager?: StateManager) {
    this.provider = provider;
    this.experienceTracker = experienceTracker || new ExperienceTracker();
    this.reporter = reporter;
    this.stateManager = stateManager;
  }

  getSavedFiles(): string[] {
    return [...this.savedFiles];
  }

  async saveSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<void> {
    debugLog('Saving session experience');

    const result = this.determineResult(task);
    const toolExecutions = conversation.getToolExecutions();

    if (task instanceof Test) {
      task.generatedCode = this.toCode(conversation, task.description);
    }

    const steps = await this.extractSteps(toolExecutions);
    await this.detectRetryPatterns(toolExecutions, initialState);
    const verifiedSteps = await this.verifySteps(steps, initialState);

    if (verifiedSteps.length > 0) {
      const relatedUrls = this.extractVisitedUrls(toolExecutions, initialState.url || '');
      const entry: SessionExperienceEntry = {
        scenario: task.description,
        result,
        steps: verifiedSteps,
        relatedUrls,
      };
      this.experienceTracker.saveSessionExperience(initialState, entry);
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

  private async verifySteps(steps: SessionStep[], initialState: ActionResult): Promise<SessionStep[]> {
    if (steps.length === 0) return [];

    const existingExperience = this.experienceTracker
      .getRelevantExperience(initialState)
      .map((e) => e.content)
      .filter(Boolean)
      .join('\n');

    const existingSummary = existingExperience.length > 2000 ? existingExperience.substring(0, 2000) : existingExperience;

    const stepsList = steps.map((s, i) => `${i}. ${s.message}\n   Code: ${s.code || 'none'}`).join('\n');
    const prompt = dedent`
      Review these test steps and determine which are valuable to save as experience
      for future test executions on this page.

      <steps>
      ${stepsList}
      </steps>

      ${existingSummary ? `<existing_experience>\n${existingSummary}\n</existing_experience>` : ''}

      For each step, determine if it is useful:
      - NOT useful if it uses auto-generated or unstable locators (ember IDs, numeric data-testid, random IDs)
      - NOT useful if it is already documented in existing experience
      - NOT useful if it requires an unclear precondition that would not be reproducible
      - NOT useful if it is trivial navigation (I.amOnPage) without meaningful context
      - USEFUL if it demonstrates how to interact with a specific UI component (expand dropdown, fill form, etc)
      - USEFUL if it shows a working approach for a common task on this page
    `;

    const schema = z.object({
      steps: z.array(
        z.object({
          stepIndex: z.number(),
          useful: z.boolean(),
        })
      ),
    });

    try {
      const response = await this.provider.generateObject(
        [
          { role: 'system', content: 'Evaluate test steps for experience value. Be selective — only keep steps that teach something reusable.' },
          { role: 'user', content: prompt },
        ],
        schema,
        undefined,
        { telemetryFunctionId: 'historian.verifySteps' }
      );

      const usefulIndices = new Set((response?.object?.steps || []).filter((s) => s.useful).map((s) => s.stepIndex));

      const verified = steps.filter((_, i) => usefulIndices.has(i));
      debugLog('Verified %d/%d steps as useful', verified.length, steps.length);
      return verified;
    } catch (error: any) {
      debugLog('Step verification failed, keeping all steps: %s', error.message);
      return steps;
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

        await this.experienceTracker.saveSuccessfulResolution(state, pattern.intent, candidate.success.output.code, pattern.explanation);
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

  savePlanToFile(plan: Plan): string {
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
