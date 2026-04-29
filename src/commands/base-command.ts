import chalk from 'chalk';
import { Command } from 'commander';
import { isInteractive } from '../ai/task-agent.js';
import type { ExplorBot } from '../explorbot.js';
import { getCliName } from '../utils/cli-name.js';
import { tag } from '../utils/logger.js';

export interface CommandOption {
  flags: string;
  description: string;
}

export interface Suggestion {
  command?: string;
  hint: string;
}

export abstract class BaseCommand {
  abstract name: string;
  abstract description: string;
  aliases: string[] = [];
  options: CommandOption[] = [];
  tuiEnabled = true;
  suggestions: Suggestion[] = [];

  protected explorBot: ExplorBot;

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
  }

  abstract execute(args: string): Promise<void>;

  matches(commandName: string): boolean {
    return this.name === commandName || this.aliases.includes(commandName);
  }

  printSuggestions(): void {
    if (this.suggestions.length === 0) return;
    const prefix = isInteractive() ? '/' : `${getCliName()} `;
    tag('info').log('');
    tag('info').log(chalk.bold('Suggested:'));
    for (const { command, hint } of this.suggestions) {
      tag('info').log('');
      if (!command) {
        tag('info').log(chalk.dim(hint));
        continue;
      }
      tag('info').log(chalk.dim(`${hint}:`));
      tag('info').log(`  ${chalk.yellow(`${prefix}${command}`)}`);
    }
  }

  protected parseArgs(args: string): { opts: Record<string, string | boolean>; args: string[] } {
    const cmd = new Command();
    cmd.exitOverride();
    for (const opt of this.options) {
      cmd.option(opt.flags, opt.description);
    }
    cmd.argument('[args...]');
    const argv = (args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || []).map((s) => s.replace(/^["']|["']$/g, ''));
    cmd.parse(argv, { from: 'user' });
    return { opts: cmd.opts(), args: cmd.args };
  }
}
