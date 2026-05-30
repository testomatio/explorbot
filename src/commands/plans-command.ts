import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { Plan } from '../test-plan.js';
import { getCliName } from '../utils/cli-name.js';
import { tag } from '../utils/logger.js';
import { relativeToCwd } from '../utils/next-steps.js';
import { BaseCommand } from './base-command.js';

export class PlansCommand extends BaseCommand {
  name = 'plans';
  description = 'List saved plans and show their test scenarios';
  options = [{ flags: '--from-plan <file>', description: 'Plan file to show' }];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    const files = this.getPlanFiles();
    const target = String(opts.fromPlan || remaining[0] || '').trim();

    if (!target) {
      this.printPlans(files);
      return;
    }

    const file = this.resolvePlanFile(target, files);
    const plan = Plan.fromMarkdown(file.path);
    this.printPlanDetails(plan, file);
  }

  private getPlanFiles(): PlanFile[] {
    const plansDir = this.explorBot.getPlansDir();
    if (!existsSync(plansDir)) return [];

    return readdirSync(plansDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => {
        const filePath = path.join(plansDir, file);
        const stat = statSync(filePath);
        return {
          name: file,
          path: filePath,
          modifiedAt: stat.mtimeMs,
        };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
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

  private resolvePlanFile(target: string, files: PlanFile[]): PlanFile {
    const index = Number.parseInt(target, 10);
    if (!Number.isNaN(index) && String(index) === target) {
      const file = files[index - 1];
      if (!file) throw new Error(`Plan #${target} not found. Available: 1-${files.length}`);
      return file;
    }

    const resolved = this.explorBot.resolvePlanPath(target);
    if (!existsSync(resolved)) {
      throw new Error(`Plan file not found: ${resolved}`);
    }

    return {
      name: path.basename(resolved),
      path: resolved,
      modifiedAt: statSync(resolved).mtimeMs,
    };
  }
}

interface PlanFile {
  name: string;
  path: string;
  modifiedAt: number;
}
