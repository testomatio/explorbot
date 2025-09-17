import type { ExplorBot } from './explorbot.js';

export interface Command {
  name: string;
  description: string;
  pattern: RegExp;
  execute: (input: string, explorBot: ExplorBot) => Promise<void>;
}

export class CommandHandler {
  private explorBot: ExplorBot;
  private commands: Command[];

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
    this.commands = this.initializeCommands();
  }

  private initializeCommands(): Command[] {
    return [
      {
        name: '/research',
        description: 'Research current page or navigate to URI and research',
        pattern: /^\/research(?:\s+(.+))?$/,
        execute: async (input: string) => {
          const match = input.match(/^\/research(?:\s+(.+))?$/);
          const uri = match?.[1]?.trim();

          if (uri) {
            await this.explorBot.getExplorer().visit(uri);
          }
          await this.explorBot.getExplorer().research();
        },
      },
      {
        name: '/plan',
        description: 'Plan testing for a feature',
        pattern: /^\/plan(?:\s+(.+))?$/,
        execute: async (input: string) => {
          const match = input.match(/^\/plan(?:\s+(.+))?$/);
          const feature = match?.[1]?.trim() || '';
          await this.explorBot.getExplorer().plan(feature);
        },
      },
      {
        name: '/navigate',
        description: 'Navigate to URI or state using AI',
        pattern: /^\/navigate(?:\s+(.+))?$/,
        execute: async (input: string) => {
          const match = input.match(/^\/navigate(?:\s+(.+))?$/);
          const target = match?.[1]?.trim();

          if (!target) {
            throw new Error('Navigate command requires a target URI or state');
          }

          await this.explorBot.getExplorer().navigate(target);
        },
      },
    ];
  }

  getAvailableCommands(): string[] {
    return [
      ...this.commands.map((cmd) => cmd.name),
      'I.amOnPage',
      'I.click',
      'I.see',
      'I.fillField',
      'I.selectOption',
      'I.checkOption',
      'I.pressKey',
      'I.wait',
      'I.waitForElement',
      'I.waitForVisible',
      'I.waitForInvisible',
      'I.scrollTo',
    ];
  }

  getCommandDescriptions(): { name: string; description: string }[] {
    return [
      ...this.commands.map((cmd) => ({
        name: cmd.name,
        description: cmd.description,
      })),
      { name: 'I.*', description: 'CodeceptJS commands for web interaction' },
    ];
  }

  async executeCommand(input: string): Promise<void> {
    const trimmedInput = input.trim();

    if (trimmedInput.startsWith('I.')) {
      await this.executeCodeceptJSCommand(trimmedInput);
      return;
    }

    for (const command of this.commands) {
      if (command.pattern.test(trimmedInput)) {
        await command.execute(trimmedInput, this.explorBot);
        return;
      }
    }

    await this.explorBot.getExplorer().visit(trimmedInput);
  }

  private async executeCodeceptJSCommand(input: string): Promise<void> {
    const action = this.explorBot.getExplorer().createAction();
    await action.execute(input);
  }

  isCommand(input: string): boolean {
    const trimmedInput = input.trim();

    if (trimmedInput.startsWith('I.')) {
      return true;
    }

    return this.commands.some((cmd) => cmd.pattern.test(trimmedInput));
  }
}
