import { type BaseCommand, createCommands } from './commands/index.js';
import type { ExplorBot } from './explorbot.js';
import { tag } from './utils/logger.js';

export type InputSubmitCallback = (input: string) => Promise<void>;

export interface InputManager {
  registerInputPane(addLog: (entry: string) => void, onSubmit: InputSubmitCallback): () => void;
  getAvailableCommands(): string[];
  getFilteredCommands(input: string): string[];
  setExitOnEmptyInput(enabled: boolean): void;
}

export interface ParsedCommand {
  name: string;
  args: string[];
}

function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  return { name, args };
}

export class CommandHandler implements InputManager {
  private explorBot: ExplorBot;
  private commands: BaseCommand[];
  private registeredInputPanes: Set<{
    addLog: (entry: string) => void;
    onSubmit: InputSubmitCallback;
  }> = new Set();
  private exitOnEmptyInput = false;

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
    this.commands = createCommands(explorBot);
  }

  private findCommand(name: string): BaseCommand | undefined {
    return this.commands.find((cmd) => cmd.matches(name));
  }

  getAvailableCommands(): string[] {
    const slashCommands = this.commands.map((cmd) => `/${cmd.name}`);
    for (const cmd of this.commands) {
      for (const alias of cmd.aliases) {
        if (!slashCommands.includes(`/${alias}`)) {
          slashCommands.push(`/${alias}`);
        }
      }
    }
    return [...slashCommands, 'I.amOnPage', 'I.click', 'I.see', 'I.fillField', 'I.selectOption', 'I.checkOption', 'I.pressKey', 'I.wait', 'I.waitForElement', 'I.waitForVisible', 'I.waitForInvisible', 'I.scrollTo'];
  }

  getCommandDescriptions(): { name: string; description: string }[] {
    const descriptions = this.commands.map((cmd) => ({
      name: `/${cmd.name}`,
      description: cmd.description,
    }));
    descriptions.push({ name: 'I.*', description: 'CodeceptJS commands for web interaction' });
    return descriptions;
  }

  async executeCommand(input: string): Promise<void> {
    const trimmedInput = input.trim();
    const lowered = trimmedInput.toLowerCase();

    if (trimmedInput.startsWith('I.')) {
      try {
        await this.executeCodeceptJSCommand(trimmedInput);
      } catch (error) {
        tag('error').log(`CodeceptJS command failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (lowered === 'exit' || lowered === '/exit' || lowered === 'quit' || lowered === '/quit') {
      const exitCommand = this.findCommand('exit');
      if (exitCommand) {
        try {
          await exitCommand.execute('');
        } catch (error) {
          tag('error').log(`Exit command failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return;
    }

    if (trimmedInput === '/') {
      return;
    }

    const parsed = parseCommand(trimmedInput);
    if (parsed) {
      const command = this.findCommand(parsed.name);
      if (command) {
        const argsString = parsed.args.join(' ');
        try {
          await command.execute(argsString);
        } catch (error) {
          tag('error').log(`/${command.name} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
    }

    try {
      const response = await this.explorBot.agentCaptain().handle(trimmedInput);
      if (response) {
        tag('multiline').log(response);
      }
    } catch (error) {
      tag('error').log(`Captain failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeCodeceptJSCommand(input: string): Promise<void> {
    const action = this.explorBot.getExplorer().createAction();
    await action.execute(input);
  }

  isCommand(input: string): boolean {
    const trimmedInput = input.trim();
    const lowered = trimmedInput.toLowerCase();

    if (trimmedInput.startsWith('I.')) {
      return true;
    }

    if (lowered === 'exit' || lowered === 'quit' || lowered === '/exit' || lowered === '/quit') {
      return true;
    }

    const parsed = parseCommand(trimmedInput);
    if (parsed) {
      return !!this.findCommand(parsed.name);
    }

    return false;
  }

  registerInputPane(addLog: (entry: string) => void, onSubmit: InputSubmitCallback): () => void {
    const pane = { addLog, onSubmit };
    this.registeredInputPanes.add(pane);

    return () => {
      this.registeredInputPanes.delete(pane);
    };
  }

  getFilteredCommands(input: string): string[] {
    const trimmedInput = input.trim();
    const normalizedInput = trimmedInput === '/' ? '' : trimmedInput;
    const allCommands = this.getAvailableCommands().filter((cmd) => cmd.startsWith('/'));
    const hasColon = normalizedInput.includes(':');
    const slashCommands = hasColon ? allCommands : allCommands.filter((cmd) => !cmd.includes(':'));
    const defaultCommands = ['/help', '/explore', '/navigate', '/plan', '/knows', '/research', '/test', 'exit'];

    if (!normalizedInput) {
      const prioritized = defaultCommands.filter((cmd) => cmd === 'exit' || slashCommands.includes(cmd));
      const extras = slashCommands.filter((cmd) => !prioritized.includes(cmd) && cmd !== 'exit');
      const ordered = [...prioritized, ...extras];
      const unique = ordered.filter((cmd, index) => ordered.indexOf(cmd) === index);
      return unique.slice(0, 20);
    }

    const searchTerm = normalizedInput.toLowerCase();
    const pool = Array.from(new Set([...slashCommands, 'exit']));
    return pool.filter((cmd) => cmd.toLowerCase().includes(searchTerm)).slice(0, 20);
  }

  setExitOnEmptyInput(enabled: boolean): void {
    this.exitOnEmptyInput = enabled;
  }

  async submitInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
      if (this.exitOnEmptyInput) {
        process.exit(0);
      }
      return;
    }

    const isCommand = trimmedInput.startsWith('/') || trimmedInput.startsWith('I.');

    if (isCommand) {
      try {
        await this.executeCommand(trimmedInput);
      } catch (error) {
        const firstPane = this.registeredInputPanes.values().next().value;
        firstPane?.addLog(`Command failed: ${error}`);
      }
    } else {
      const firstPane = this.registeredInputPanes.values().next().value;
      if (firstPane) {
        await firstPane.onSubmit(trimmedInput);
      }
      const response = await this.explorBot.agentCaptain().handle(trimmedInput);
      if (response) {
        if (firstPane) {
          firstPane.addLog(response);
        } else {
          console.log(response);
        }
      }
    }
  }
}
