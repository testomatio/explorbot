import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanCommand extends BaseCommand {
  name = 'plan';
  description = 'Plan testing for a feature';
  suggestions = ['/test - to launch first test', '/test * - to launch all tests', 'Edit the plan in file and call /plan:reload to update it'];

  async execute(args: string): Promise<void> {
    const clear = args.includes('--clear');
    const fresh = args.includes('--fresh') || clear;
    const append = args.includes('--append');
    const styleMatch = args.match(/--style\s+(\S+)/);
    const style = styleMatch?.[1];
    const focus = args
      .replace('--clear', '')
      .replace('--fresh', '')
      .replace('--append', '')
      .replace(/--style\s+\S+/, '')
      .trim();

    if (clear) {
      this.explorBot.clearPlan();
      tag('success').log('Plan cleared');
    }

    if (!fresh && !append) {
      const existingPlan = this.explorBot.getCurrentPlan();
      if (existingPlan?.tests.length) {
        tag('info').log(`Plan already exists: "${existingPlan.title}" with ${existingPlan.tests.length} tests`);
        tag('info').log('Use /plan --append to add more tests');
        return;
      }
    }

    if (focus) {
      tag('info').log(`Planning focus: ${focus}`);
    }

    await this.explorBot.plan(focus || undefined, { fresh, style });

    const plan = this.explorBot.getCurrentPlan();
    if (!plan?.tests.length) {
      throw new Error('No test scenarios in the current plan.');
    }
  }
}
