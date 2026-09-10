import { tag } from '../../../../src/utils/logger.ts';
import { type NextStepSection, printNextSteps, relativeToCwd } from '../../../../src/utils/next-steps.ts';
import { ApiCommand } from './api-command.ts';

export class PlanCommand extends ApiCommand {
  name = 'plan';
  description = 'Generate a test plan for an API endpoint';
  style?: string;
  fresh = false;

  async execute(endpoint: string): Promise<void> {
    await this.bot.plan(endpoint, { style: this.style, fresh: this.fresh });

    const plan = this.bot.getCurrentPlan();
    if (!plan?.tests.length) {
      throw new Error('No test scenarios generated.');
    }

    const lines = [`Plan: ${plan.title} (${plan.tests.length} tests)`];
    for (const [i, test] of plan.tests.entries()) {
      lines.push(`  ${String(i + 1).padStart(2)}. [${test.priority}] ${test.scenario}`);
    }
    tag('multiline').log(lines.join('\n'), { maxLines: 24 });

    const savedPath = this.bot.savePlan();
    if (!savedPath) return;

    const relative = relativeToCwd(savedPath);
    const sections: NextStepSection[] = [
      {
        label: 'Plan',
        path: savedPath,
        commands: [
          { label: 'Run first', command: `${this.prefix} test ${relative} 1` },
          { label: 'Run all', command: `${this.prefix} test ${relative} *` },
          { label: 'Run range', command: `${this.prefix} test ${relative} 1-3` },
        ],
      },
    ];
    printNextSteps(sections);
  }
}
