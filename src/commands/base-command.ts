import chalk from 'chalk';
import { Command } from 'commander';
import { isInteractive } from '../ai/task-agent.js';
import { ConfigParser } from '../config.js';
import type { ExplorBot } from '../explorbot.js';
import { Stats } from '../stats.js';
import { getCliName } from '../utils/cli-name.js';
import { tag } from '../utils/logger.js';

const DEFAULT_HEAL_ATTEMPTS = 2;

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

  protected healByCaptain = async (err: unknown): Promise<void> => {
    const msg = err instanceof Error ? err.message : String(err);
    tag('warning').log(`Failure observed: ${msg}`);
    Stats.recordError(msg);
    if (Stats.haltSession) return;
    const attempts = ConfigParser.getInstance().getConfig().healAttempts ?? DEFAULT_HEAL_ATTEMPTS;
    if (!attempts) return;
    if (Stats.consecutiveFailures < attempts) return;
    tag('warning').log(`Captain heal mode: ${Stats.consecutiveFailures} consecutive failures — investigating`);
    await this.explorBot.agentCaptain().heal();
    Stats.consecutiveFailures = 0;
  };

  matches(commandName: string): boolean {
    return this.name === commandName || this.aliases.includes(commandName);
  }

  printSuggestions(): void {
    if (this.suggestions.length === 0) return;
    const prefix = isInteractive() ? '/' : `${getCliName()} `;
    const commandWidth = this.suggestions.reduce((max, s) => (s.command ? Math.max(max, prefix.length + s.command.length) : max), 0);
    const lines = [chalk.bold('Suggested:')];
    for (const { command, hint } of this.suggestions) {
      if (!command) {
        lines.push(`  ${chalk.dim(hint)}`);
        continue;
      }
      const cmd = `${prefix}${command}`.padEnd(commandWidth);
      lines.push(`  ${chalk.yellow(cmd)}  ${chalk.dim(hint)}`);
    }
    tag('info').log(lines.join('\n'));
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
