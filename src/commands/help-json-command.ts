import type { Command } from 'commander';
import { EXPLORBOT_ENV_VARS } from '../config.js';

const DESCRIPTION = 'Print command definitions as JSON for agents and tools';

export class HelpJsonCommand {
  static register(program: Command): void {
    program
      .command('help-json [command...]')
      .description(DESCRIPTION)
      .action(async (names: string[]) => {
        const target = HelpJsonCommand.find(program, names);
        if (!target) {
          console.error(`Unknown command: ${names.join(' ')}`);
          process.exit(1);
        }
        const json = JSON.stringify(HelpJsonCommand.data(target, target === program), null, 2);
        await new Promise<void>((resolve) => process.stdout.write(`${json}\n`, () => resolve()));
      });
  }

  static data(cmd: Command, root = false): CommandDefinition {
    const helper = cmd.createHelp();
    const definition: CommandDefinition = {
      name: cmd.name(),
      description: cmd.description(),
      aliases: cmd.aliases(),
      arguments: cmd.registeredArguments.map((argument) => ({
        name: argument.name(),
        description: argument.description,
        required: argument.required,
        variadic: argument.variadic,
      })),
      options: helper.visibleOptions(cmd).map((option) => ({
        flags: option.flags,
        description: option.description,
        default: option.defaultValue,
        choices: option.argChoices,
      })),
      commands: helper.visibleCommands(cmd).map((sub) => HelpJsonCommand.data(sub)),
    };

    if (!root) return definition;

    definition.version = cmd.version();
    definition.env = EXPLORBOT_ENV_VARS.map((variable) => ({
      name: variable.name,
      description: variable.description,
      required: !!variable.required,
    }));
    return definition;
  }

  private static find(cmd: Command, names: string[]): Command | undefined {
    let target = cmd;
    for (const name of names) {
      const sub = target.commands.find((candidate) => candidate.name() === name || candidate.aliases().includes(name));
      if (!sub) return undefined;
      target = sub;
    }
    return target;
  }
}

interface CommandDefinition {
  name: string;
  description: string;
  aliases: string[];
  version?: string;
  arguments: { name: string; description: string; required: boolean; variadic: boolean }[];
  options: { flags: string; description: string; default?: unknown; choices?: string[] }[];
  commands: CommandDefinition[];
  env?: { name: string; description: string; required: boolean }[];
}
