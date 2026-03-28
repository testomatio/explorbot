import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class PlanCommand extends BaseCommand {
  name = 'plan';
  description = 'Plan testing for a feature';
  suggestions = ['/test - to launch first test', '/test * - to launch all tests', 'Edit the plan in file and call /plan:reload to update it'];
  options = [
    { flags: '--fresh', description: 'Regenerate plan from scratch' },
    { flags: '--clear', description: 'Clear plan before regenerating' },
    { flags: '--style <name>', description: 'Planning style (normal, curious, psycho, performer)' },
  ];

  async execute(args: string): Promise<void> {
    const clear = args.includes('--clear');
    const fresh = args.includes('--fresh') || clear;
    const styleMatch = args.match(/--style\s+(\S+)/);
    const style = styleMatch?.[1];
    const focus = args
      .replace('--clear', '')
      .replace('--fresh', '')
      .replace(/--style\s+\S+/, '')
      .trim();

    if (clear) {
      this.explorBot.clearPlan();
      tag('success').log('Plan cleared');
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
