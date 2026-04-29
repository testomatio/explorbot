import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActionResult } from '../../action-result.ts';
import { ConfigParser } from '../../config.ts';
import { KnowledgeTracker } from '../../knowledge-tracker.ts';
import type { Plan } from '../../test-plan.ts';
import { tag } from '../../utils/logger.ts';
import { relativeToCwd } from '../../utils/next-steps.ts';
import { safeFilename } from '../../utils/strings.ts';
import type { Conversation } from '../conversation.ts';
import { ASSERTION_TOOLS, CODECEPT_TOOLS } from '../tools.ts';
import type { Constructor } from './mixin.ts';
import { escapeString, getExecutionLabel, isNonReusableCode, stripComments } from './utils.ts';

export interface CodeceptJSMethods {
  toCode(conversation: Conversation, scenario: string): string;
  saveCodeceptPlanToFile(plan: Plan): string;
}

export function WithCodeceptJS<T extends Constructor>(Base: T) {
  return class extends Base {
    declare savedFiles: Set<string>;

    toCode(conversation: Conversation, scenario: string): string {
      const toolExecutions = conversation.getToolExecutions();
      const TRACKABLE_TOOLS = [...CODECEPT_TOOLS, ...ASSERTION_TOOLS];
      const successfulSteps = toolExecutions.filter((exec) => exec.wasSuccessful && TRACKABLE_TOOLS.includes(exec.toolName as any) && exec.output?.code);

      if (successfulSteps.length === 0) {
        return '';
      }

      const lines: string[] = [];
      lines.push(`Scenario('${escapeString(scenario)}', ({ I }) => {`);

      for (const exec of successfulSteps) {
        if (isNonReusableCode(exec.output.code)) continue;
        const explanation = getExecutionLabel(exec);
        if (explanation) {
          lines.push('');
          lines.push(`  Section('${escapeString(explanation)}');`);
        }
        const code = stripComments(exec.output.code);
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

    saveCodeceptPlanToFile(plan: Plan): string {
      const lines: string[] = [];

      lines.push(`import step, { Section } from 'codeceptjs/steps';`);
      lines.push('');
      lines.push(`Feature('${escapeString(plan.title)}')`);
      lines.push('');

      const startUrl = plan.url || plan.tests[0]?.startUrl;
      if (startUrl) {
        lines.push('Before(({ I }) => {');
        lines.push(`  I.amOnPage('${escapeString(startUrl)}');`);
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

        lines.push(`Scenario.todo('${escapeString(test.scenario)}', ({ I }) => {`);
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

      const filePath = join(testsDir, safeFilename(plan.title, '.js'));
      writeFileSync(filePath, lines.join('\n'));
      this.savedFiles.add(filePath);

      tag('substep').log(`Saved plan tests to: ${relativeToCwd(filePath)}`);
      return filePath;
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
  };
}
