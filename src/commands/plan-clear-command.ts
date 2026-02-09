import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanClearCommand extends BaseCommand {
  name = 'plan:clear';
  description = 'Clear current plan';
  suggestions = ['/plan <feature> - to create new plan'];

  async execute(_args: string): Promise<void> {
    const currentPlan = this.explorBot.getCurrentPlan();
    if (!currentPlan) {
      throw new Error('No plan to clear.');
    }

    this.explorBot.clearPlan();
    tag('success').log('Plan cleared');
  }
}
