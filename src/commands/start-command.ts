import { BaseCommand, type Suggestion } from './base-command.js';
import { ExploreCommand } from './explore-command.js';

export class StartCommand extends BaseCommand {
  name = 'start';
  description = 'Start web exploration';
  suggestions: Suggestion[] = [
    { command: 'navigate <page>', hint: 'go to another page' },
    { command: 'research', hint: 'analyze current page' },
    { command: 'plan <feature>', hint: 'plan testing' },
  ];

  async execute(args: string): Promise<void> {
    await new ExploreCommand(this.explorBot).execute(args);
  }
}
