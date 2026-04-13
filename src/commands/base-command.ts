import { Command } from 'commander';
import type { ExplorBot } from '../explorbot.js';

export interface CommandOption {
  flags: string;
  description: string;
}

export abstract class BaseCommand {
  abstract name: string;
  abstract description: string;
  aliases: string[] = [];
  options: CommandOption[] = [];
  tuiEnabled = true;
  suggestions: string[] = [];

  protected explorBot: ExplorBot;

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
  }

  abstract execute(args: string): Promise<void>;

  matches(commandName: string): boolean {
    return this.name === commandName || this.aliases.includes(commandName);
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
