import { BaseCommand } from './base-command.js';

export class PlanEditCommand extends BaseCommand {
  name = 'plan:edit';
  description = 'Open test plan editor';
  suggestions = ['/plan:edit - toggle tests on/off'];

  async execute(_args: string): Promise<void> {}
}
