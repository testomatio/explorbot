import chalk from 'chalk';
import { Stats } from '../stats.ts';
import { BaseCommand } from './base-command.js';

export class ExitCommand extends BaseCommand {
  name = 'exit';
  description = 'Exit the application';
  aliases = ['quit'];

  async execute(_args: string): Promise<void> {
    const parts: string[] = [];
    parts.push(Stats.getElapsedTime());
    parts.push(`Tests: ${Stats.tests}`);
    for (const [model, tokens] of Object.entries(Stats.models)) {
      parts.push(`${model}: ${Stats.humanizeTokens(tokens.total)} tokens`);
    }

    console.log(chalk.dim(parts.join(' | ')));
    console.log('\nGoodbye!');
    await this.explorBot.getExplorer().stop();
    process.exit(0);
  }
}
