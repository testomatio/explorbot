import { BaseCommand, type Suggestion } from './base-command.js';

export class PlanEditCommand extends BaseCommand {
  name = 'plan:edit';
  description = 'Open test plan editor';
  suggestions: Suggestion[] = [{ command: 'plan:edit', hint: 'toggle tests on/off' }];

  async execute(_args: string): Promise<void> {}
}
