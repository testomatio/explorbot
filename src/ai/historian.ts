import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dedent from 'dedent';
import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import { ExperienceTracker, type SessionExperienceEntry, type SessionStep } from '../experience-tracker.ts';
import { type Reporter, type ReporterStep } from '../reporter.ts';
import { type Plan, type Task, Test } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import type { Conversation, ToolExecution } from './conversation.ts';
import type { Provider } from './provider.ts';
import { ASSERTION_TOOLS, CODECEPT_TOOLS } from './tools.ts';

const debugLog = createDebug('explorbot:historian');

export class Historian {
  private provider: Provider;
  private experienceTracker: ExperienceTracker;
  private reporter?: Reporter;

  constructor(provider: Provider, experienceTracker?: ExperienceTracker, reporter?: Reporter) {
    this.provider = provider;
    this.experienceTracker = experienceTracker || new ExperienceTracker();
    this.reporter = reporter;
  }

  async saveSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<void> {
    debugLog('Saving session experience');

    const result = this.determineResult(task);

    if (result === 'failed') {
      debugLog('Skipping session experience for failed test');
      if ('scenario' in task) {
        (task as Test).generatedCode = this.toCode(conversation, task.description);
      }
      return;
    }

    const toolExecutions = conversation.getToolExecutions();
    const steps = await this.extractSteps(toolExecutions);
    const relatedUrls = this.extractVisitedUrls(toolExecutions, initialState.url || '');

    const entry: SessionExperienceEntry = {
      scenario: task.description,
      result,
      steps,
      relatedUrls,
    };

    this.experienceTracker.saveSessionExperience(initialState, entry);

    if (task instanceof Test) {
      task.generatedCode = this.toCode(conversation, task.description);
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

      const message = exec.input?.explanation || exec.input?.assertion || exec.input?.note || `Executed ${exec.toolName}`;
      const ariaDiff = exec.output?.pageDiff?.ariaChanges || null;

      const step: SessionStep = {
        message,
        status: 'passed',
        tool: exec.toolName,
        code: this.stripComments(exec.output.code),
      };

      stepsWithDiffs.push({ step, ariaDiff });
    }

    await this.analyzeDiscoveries(stepsWithDiffs);

    return stepsWithDiffs.map((s) => s.step);
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
  }

  private buildDiscoveryPrompt(stepsWithDiffs: Array<{ step: SessionStep; ariaDiff: string | null }>): string {
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
      const { step, ariaDiff } = stepsWithDiffs[i];
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
    const initialPath = this.toRelativeUrl(initialUrl);

    for (const exec of toolExecutions) {
      const currentUrl = exec.output?.pageDiff?.currentUrl;
      if (!currentUrl) continue;

      const relativePath = this.toRelativeUrl(currentUrl);
      if (relativePath && relativePath !== initialPath) {
        urls.add(relativePath);
      }
    }

    return [...urls];
  }

  private toRelativeUrl(url: string): string {
    if (url.startsWith('/')) return url;
    try {
      const urlObj = new URL(url);
      return urlObj.pathname + urlObj.hash;
    } catch {
      return url;
    }
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
      const explanation = exec.input?.explanation || exec.input?.assertion || exec.input?.note;
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

    lines.push(`import { Section } from 'codeceptjs/steps';`);
    lines.push('');
    lines.push(`Feature('${this.escapeString(plan.title)}')`);
    lines.push('');

    const startUrl = plan.url || plan.tests[0]?.startUrl;
    if (startUrl) {
      lines.push('Before(({ I }) => {');
      lines.push(`  I.amOnPage('${this.escapeString(startUrl)}');`);
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

    const outputDir = ConfigParser.getInstance().getOutputDir();
    const testsDir = join(outputDir, 'tests');
    mkdirSync(testsDir, { recursive: true });

    const filename = plan.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const filePath = join(testsDir, `${filename}.js`);
    writeFileSync(filePath, lines.join('\n'));

    tag('substep').log(`Saved plan tests to: ${filePath}`);
    return filePath;
  }

  private escapeString(str: string): string {
    return str.replace(/'/g, "\\'").replace(/\n/g, ' ');
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
