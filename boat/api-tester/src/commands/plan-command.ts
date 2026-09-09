import path from 'node:path';
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

    console.log(`\nPlan: ${plan.title} (${plan.tests.length} tests)\n`);
    plan.tests.forEach((test, i) => {
      console.log(`  ${i + 1}. [${test.priority}] ${test.scenario}`);
    });

    const savedPath = this.bot.savePlan();
    if (!savedPath) return;

    const relative = path.relative(process.cwd(), savedPath);
    console.log(`\nSaved to: ${relative}`);
    console.log('\nRun tests:');
    console.log(`  ${this.prefix} test ${relative} 1       # run first test`);
    console.log(`  ${this.prefix} test ${relative} 1-3     # run tests 1 to 3`);
    console.log(`  ${this.prefix} test ${relative} *       # run all tests`);
  }
}
