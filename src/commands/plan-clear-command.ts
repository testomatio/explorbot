import { tag } from '../utils/logger.js';
import { BaseCommand, type Suggestion } from './base-command.js';

export class PlanClearCommand extends BaseCommand {
  name = 'plan:clear';
  description = 'Clear current plan and create a new one';
  suggestions: Suggestion[] = [
    { command: 'test', hint: 'launch first test' },
    { command: 'test *', hint: 'launch all tests' },
  ];

  async execute(args: string): Promise<void> {
    this.explorBot.clearPlan();
    tag('success').log('Plan cleared');
    await this.explorBot.plan(args.trim() || undefined, { fresh: true });
  }
}
