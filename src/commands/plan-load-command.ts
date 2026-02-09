import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanLoadCommand extends BaseCommand {
  name = 'plan:load';
  description = 'Load plan from file';
  suggestions = ['/test - to launch first test', '/test * - to launch all tests'];

  async execute(args: string): Promise<void> {
    const filename = args.trim();
    if (!filename) {
      throw new Error('Filename required. Usage: /plan:load <filename>');
    }

    const plan = this.explorBot.loadPlan(filename);
    tag('success').log(`Plan loaded: ${plan.title} with ${plan.tests.length} tests`);
  }
}
