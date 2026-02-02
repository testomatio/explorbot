import { BaseCommand } from './base-command.js';

export class HelpCommand extends BaseCommand {
  name = 'help';
  description = 'Show available commands';

  async execute(_args: string): Promise<void> {}
}
