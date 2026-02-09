import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanReloadCommand extends BaseCommand {
  name = 'plan:reload';
  description = 'Clear current plan and regenerate';
  suggestions = ['/test - to launch first test', '/test * - to launch all tests'];

  async execute(args: string): Promise<void> {
    const currentPlan = this.explorBot.getCurrentPlan();
    if (!currentPlan) {
      throw new Error('No plan to reload. Run /plan first.');
    }

    const feature = args.trim() || this.explorBot.getPlanFeature();
    this.explorBot.clearPlan();

    tag('info').log('Plan cleared, regenerating...');
    await this.explorBot.plan(feature);

    const plan = this.explorBot.getCurrentPlan();
    if (!plan?.tests.length) {
      throw new Error('No test scenarios in the regenerated plan.');
    }

    tag('success').log(`Plan regenerated with ${plan.tests.length} tests`);
  }
}
