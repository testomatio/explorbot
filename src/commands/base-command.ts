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
}
