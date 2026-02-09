import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanCommand extends BaseCommand {
  name = 'plan';
  description = 'Plan testing for a feature';
  suggestions = ['/test - to launch first test', '/test * - to launch all tests', 'Edit the plan in file and call /plan:reload to update it'];

  async execute(args: string): Promise<void> {
    const focus = args.trim();
    if (focus) {
      tag('info').log(`Planning focus: ${focus}`);
    }

    await this.explorBot.plan(focus || undefined);

    const plan = this.explorBot.getCurrentPlan();
    if (!plan?.tests.length) {
      throw new Error('No test scenarios in the current plan.');
    }

    tag('success').log(`Plan ready with ${plan.tests.length} tests`);
    tag('info').log('Use /plan:save to save plan, /plan:load <file> to load a saved plan');
  }
}
