import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanClearCommand extends BaseCommand {
  name = 'plan:clear';
  description = 'Clear current plan and create a new one';
  suggestions = ['/test - to launch first test', '/test * - to launch all tests'];

  async execute(args: string): Promise<void> {
    this.explorBot.clearPlan();
    tag('success').log('Plan cleared');
    await this.explorBot.plan(args.trim() || undefined, { fresh: true });
  }
}
