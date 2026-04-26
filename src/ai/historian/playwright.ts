import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActionResult } from '../../action-result.ts';
import { ConfigParser } from '../../config.ts';
import { KnowledgeTracker } from '../../knowledge-tracker.ts';
import { type PlaywrightRecorder, type TraceCall, renderAssertion, renderCall } from '../../playwright-recorder.ts';
import type { Plan } from '../../test-plan.ts';
import { tag } from '../../utils/logger.ts';
import { relativeToCwd } from '../../utils/next-steps.ts';
import type { Conversation } from '../conversation.ts';
import { ASSERTION_TOOLS, CODECEPT_TOOLS } from '../tools.ts';
import type { Constructor } from './mixin.ts';
import { escapeString, getExecutionLabel } from './utils.ts';

const PLAYWRIGHT_EMITTED_TOOLS = [...CODECEPT_TOOLS, ...ASSERTION_TOOLS] as const;

export interface PlaywrightMethods {
  toPlaywrightCode(conversation: Conversation, scenario: string): Promise<string>;
  savePlaywrightPlanToFile(plan: Plan): string;
}

export function WithPlaywright<T extends Constructor>(Base: T) {
  return class extends Base {
    declare recorder: PlaywrightRecorder | undefined;
    declare savedFiles: Set<string>;

    async toPlaywrightCode(conversation: Conversation, scenario: string): Promise<string> {
      const toolExecutions = conversation.getToolExecutions();
      const successfulSteps = toolExecutions.filter((exec) => exec.wasSuccessful && PLAYWRIGHT_EMITTED_TOOLS.includes(exec.toolName as any));

      const callsByGroup = this.recorder ? await this.recorder.exportChunk() : new Map<string, TraceCall[]>();

      const stepLines: string[] = [];
      for (const exec of successfulSteps) {
        const explanation = getExecutionLabel(exec);
        const execLines: string[] = [];
        const groupId: string | undefined = exec.output?.playwrightGroupId;
        const calls = groupId ? callsByGroup.get(groupId) || [] : [];
        for (const call of calls) {
          execLines.push(renderCall(call));
        }
        const assertions: Array<{ name: string; args: any[] }> = exec.output?.assertionSteps || [];
        for (const assertion of assertions) {
          const line = renderAssertion(assertion);
          if (line) execLines.push(line);
        }
        if (execLines.length === 0) continue;
        stepLines.push('');
        if (explanation) {
          stepLines.push(`  await test.step('${escapeString(explanation)}', async () => {`);
          for (const line of execLines) {
            stepLines.push(`    ${line}`);
          }
          stepLines.push('  });');
        } else {
          for (const line of execLines) {
            stepLines.push(`  ${line}`);
          }
        }
      }

      const pilotVerifications = this.recorder ? this.recorder.drainVerifications() : [];
      if (pilotVerifications.length > 0) {
        const assertionLines: string[] = [];
        for (const step of pilotVerifications) {
          const line = renderAssertion(step);
          if (line) assertionLines.push(line);
        }
        if (assertionLines.length > 0) {
          stepLines.push('');
          stepLines.push(`  await test.step('Verification', async () => {`);
          for (const line of assertionLines) {
            stepLines.push(`    ${line}`);
          }
          stepLines.push('  });');
        }
      }

      if (stepLines.length === 0) {
        return '';
      }

      const lines: string[] = [];
      lines.push(`test('${escapeString(scenario)}', async ({ page }) => {`);
      lines.push(...stepLines);
      lines.push('});');
      return lines.join('\n');
    }

    savePlaywrightPlanToFile(plan: Plan): string {
      const lines: string[] = [];

      lines.push(`import { test, expect } from '@playwright/test';`);
      lines.push('');
      lines.push(`test.describe('${escapeString(plan.title)}', () => {`);

      const startUrl = plan.url || plan.tests[0]?.startUrl;
      if (startUrl) {
        lines.push('  test.beforeEach(async ({ page }) => {');
        lines.push(`    await page.goto('${escapeString(startUrl)}');`);
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
            lines.push(`  // FAILED: ${escapeString(test.scenario)}`);
            lines.push(indented.replace(/test\(/, 'test.skip('));
          }
          lines.push('');
          continue;
        }

        lines.push(`  test.fixme('${escapeString(test.scenario)}', async ({ page }) => {`);
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

      tag('substep').log(`Saved plan tests to: ${relativeToCwd(filePath)}`);
      return filePath;
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
  };
}

function indentBlock(block: string, indent: string): string {
  return block
    .split('\n')
    .map((line) => (line ? indent + line : line))
    .join('\n');
}
