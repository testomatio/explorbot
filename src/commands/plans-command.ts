import { statSync } from 'node:fs';
import path from 'node:path';
import { Plan, type PlanFile } from '../test-plan.js';
import { getCliName } from '../utils/cli-name.js';
import { tag } from '../utils/logger.js';
import { relativeToCwd } from '../utils/next-steps.js';
import { type ArgumentCompletion, BaseCommand } from './base-command.js';

export class PlansCommand extends BaseCommand {
  name = 'plans';
  description = 'List saved plans and show their test scenarios';
  options = [{ flags: '--from-plan <file>', description: 'Plan file to show' }];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    const files = Plan.listFiles(this.explorBot.getPlansDir());
    const target = String(opts.fromPlan || remaining[0] || '').trim();

    if (!target) {
      this.printPlans(files);
      return;
    }

    const { plan, file } = this.resolvePlanFile(target, files);
    this.printPlanDetails(plan, file);
  }

  completeArguments(): ArgumentCompletion[] {
    return Plan.listFiles(this.explorBot.getPlansDir()).map((file) => ({ value: file.name }));
  }

  private printPlans(files: PlanFile[]): void {
    if (files.length === 0) {
      tag('info').log(`No saved plans found in ${relativeToCwd(this.explorBot.getPlansDir())}`);
      return;
    }

    tag('info').log('Saved plans:');
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const plan = Plan.fromMarkdown(file.path);
      tag('info').log(`${i + 1}. ${plan.title} (${plan.tests.length} tests) - ${file.name}`);
    }
    tag('info').log('');
    tag('info').log(`View plan tests: ${getCliName()} plans <number>`);
  }

  private printPlanDetails(plan: Plan, file: PlanFile): void {
    tag('info').log(`${plan.title} (${plan.tests.length} tests)`);
    for (let i = 0; i < plan.tests.length; i++) {
      const test = plan.tests[i];
      tag('info').log(`${i + 1}. ${test.scenario}`);
    }
    tag('info').log('');
    tag('info').log('Run test from this plan as:');
    tag('info').log(`${getCliName()} test 1 --from-plan ${file.name}`);
  }

  private resolvePlanFile(target: string, files: PlanFile[]): { plan: Plan; file: PlanFile } {
    const index = Number.parseInt(target, 10);
    if (!Number.isNaN(index) && String(index) === target) {
      const file = files[index - 1];
      if (!file) throw new Error(`Plan #${target} not found. Available: 1-${files.length}`);
      return { plan: Plan.fromMarkdown(file.path), file };
    }

    const plan = Plan.loadFromFile(target, this.explorBot.getPlansDir());
    if (!plan?.filePath) {
      throw new Error(`Plan file not found: ${target}`);
    }

    const file = {
      name: path.basename(plan.filePath),
      path: plan.filePath,
      modifiedAt: statSync(plan.filePath).mtimeMs,
    };
    return { plan, file };
  }
}
