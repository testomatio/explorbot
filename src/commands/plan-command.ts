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
    { flags: '--focus <feature>', description: 'Focus area for test planning' },
  ];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    const focus = (opts.focus as string) || remaining.join(' ') || undefined;

    if (opts.clear) {
      this.explorBot.clearPlan();
      tag('success').log('Plan cleared');
    }

    if (focus) {
      tag('info').log(`Planning focus: ${focus}`);
    }

    await this.explorBot.plan(focus, { fresh: !!(opts.fresh || opts.clear), style: opts.style as string });

    const plan = this.explorBot.getCurrentPlan();
    if (!plan?.tests.length) {
      throw new Error('No test scenarios in the current plan.');
    }
  }
}
