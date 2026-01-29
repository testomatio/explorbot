import { BaseCommand } from './base-command.js';

export class ExitCommand extends BaseCommand {
  name = 'exit';
  description = 'Exit the application';
  aliases = ['quit'];

  async execute(_args: string): Promise<void> {
    console.log('\nGoodbye!');
    await this.explorBot.getExplorer().stop();
    process.exit(0);
  }
}
