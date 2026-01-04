import type { ExplorBot } from './explorbot.js';
import { htmlTextSnapshot } from './utils/html.js';
import { tag } from './utils/logger.js';

export type InputSubmitCallback = (input: string) => Promise<void>;

export interface InputManager {
  registerInputPane(addLog: (entry: string) => void, onSubmit: InputSubmitCallback): () => void;
  getAvailableCommands(): string[];
  getFilteredCommands(input: string): string[];
  setExitOnEmptyInput(enabled: boolean): void;
}

export interface Command {
  name: string;
  description: string;
  execute: (args: string, explorBot: ExplorBot) => Promise<void>;
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
  private commands: Command[];
  private registeredInputPanes: Set<{
    addLog: (entry: string) => void;
    onSubmit: InputSubmitCallback;
  }> = new Set();
  private exitOnEmptyInput = false;

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
    this.commands = this.initializeCommands();
  }

  private initializeCommands(): Command[] {
    return [
      {
        name: 'research',
        description: 'Research current page or navigate to URI and research',
        execute: async (uri: string) => {
          const target = uri.trim();
          if (target) {
            await this.explorBot.getExplorer().visit(target);
          }
          await this.explorBot.agentResearcher().research(this.explorBot.getExplorer().getStateManager().getCurrentState()!, {
            screenshot: true,
            force: true,
          });
        },
      },
      {
        name: 'plan',
        description: 'Plan testing for a feature',
        execute: async (feature: string) => {
          const focus = feature.trim();
          if (focus) {
            tag('info').log(`Planning focus: ${focus}`);
          }
          await this.explorBot.plan();
          const plan = this.explorBot.getCurrentPlan();
          if (!plan?.tests.length) {
            throw new Error('No test scenarios in the current plan. Please run /plan first to create test scenarios.');
          }
          tag('success').log(`Plan ready with ${plan.tests.length} tests`);
        },
      },
      {
        name: 'navigate',
        description: 'Navigate to URI or state using AI',
        execute: async (target: string) => {
          const destination = target.trim();
          if (!destination) {
            throw new Error('Navigate command requires a target URI or state');
          }

          await this.explorBot.agentNavigator().visit(destination);
          tag('success').log(`Navigation requested: ${destination}`);
        },
      },
      {
        name: 'know',
        description: 'Store knowledge for current page',
        execute: async (payload: string) => {
          const note = payload.trim();
          if (!note) return;

          const explorer = this.explorBot.getExplorer();
          const state = explorer.getStateManager().getCurrentState();
          if (!state) {
            throw new Error('No active page to attach knowledge');
          }

          const targetUrl = state.url || state.fullUrl || '/';
          explorer.getKnowledgeTracker().addKnowledge(targetUrl, note);
          tag('success').log('Knowledge saved for current page');
        },
      },
      {
        name: 'explore',
        description: 'Make everything from research to test',
        execute: async (args: string) => {
          await this.explorBot.explore(args);
          tag('info').log('Navigate to other page with /navigate or /explore again to continue exploration');
        },
      },
      {
        name: 'aria',
        description: 'Print ARIA snapshot for current page',
        execute: async (args: string) => {
          const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
          if (!state) {
            throw new Error('No active page to snapshot');
          }
          const ariaSnapshot = state.ariaSnapshot;
          if (!ariaSnapshot) {
            throw new Error('No ARIA snapshot available for current page');
          }
          const wantsShort = args.split(/\s+/).includes('short') || args.includes('--short');
          if (wantsShort) {
            tag('multiline').log(`ARIA Snapshot:\n\n${ariaSnapshot}`);
            return;
          }
          tag('snapshot').log(`ARIA Snapshot:\n\n${ariaSnapshot}`);
        },
      },
      {
        name: 'html',
        description: 'Print HTML snapshot for current page',
        execute: async (args: string) => {
          const manager = this.explorBot.getExplorer().getStateManager();
          const state = manager.getCurrentState();
          if (!state) {
            throw new Error('No active page to snapshot');
          }
          let html = state.html;
          if (!html && state.htmlFile) {
            html = manager.loadHtmlFromFile(state.htmlFile) || '';
          }
          if (!html) {
            throw new Error('No HTML snapshot available for current page');
          }
          const wantsFull = args.split(/\s+/).includes('full') || args.includes('--full');
          if (!wantsFull) {
            tag('html').log(html);
            return;
          }
          const markdown = htmlTextSnapshot(html);
          tag('snapshot').log(`HTML Content:\n\n${markdown}`);
        },
      },
      {
        name: 'test',
        description: 'Launch tester agent to execute test scenarios',
        execute: async (args: string) => {
          if (!this.explorBot.getCurrentPlan()) {
            throw new Error('No plan found. Please run /plan first to create test scenarios.');
          }
          const plan = this.explorBot.getCurrentPlan()!;
          if (plan.isComplete) {
            throw new Error('All tests are already complete. Please run /plan to create test scenarios.');
          }
          const toExecute = [];
          if (!args) {
            toExecute.push(plan.getPendingTests()[0]);
          } else if (args === '*') {
            toExecute.push(...plan.getPendingTests());
          } else if (args.match(/^\d+$/)) {
            toExecute.push(plan.getPendingTests()[Number.parseInt(args) - 1]);
          } else {
            toExecute.push(...plan.getPendingTests().filter((test) => test.scenario.toLowerCase().includes(args.toLowerCase())));
          }
          tag('info').log(`Launching ${toExecute.length} test scenarios. Run /test * to execute all tests.`);
          const tester = this.explorBot.agentTester();
          for (const test of toExecute) {
            await tester.test(test);
          }
          tag('success').log('Test execution finished');
        },
      },
      {
        name: 'exit',
        description: 'Exit the application',
        execute: async () => {
          console.log('\n👋 Goodbye!');
          await this.explorBot.getExplorer().stop();
          process.exit(0);
        },
      },
    ];
  }

  getAvailableCommands(): string[] {
    const slashCommands = this.commands.map((cmd) => `/${cmd.name}`);
    if (!slashCommands.includes('/quit')) {
      slashCommands.push('/quit');
    }
    return [...slashCommands, 'I.amOnPage', 'I.click', 'I.see', 'I.fillField', 'I.selectOption', 'I.checkOption', 'I.pressKey', 'I.wait', 'I.waitForElement', 'I.waitForVisible', 'I.waitForInvisible', 'I.scrollTo'];
  }

  getCommandDescriptions(): { name: string; description: string }[] {
    const descriptions = [
      ...this.commands.map((cmd) => ({
        name: `/${cmd.name}`,
        description: cmd.description,
      })),
      { name: 'I.*', description: 'CodeceptJS commands for web interaction' },
    ];
    descriptions.push({ name: '/quit', description: 'Exit the application' });
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
      const exitCommand = this.commands.find((cmd) => cmd.name === 'exit');
      if (exitCommand) {
        try {
          await exitCommand.execute('', this.explorBot);
        } catch (error) {
          tag('error').log(`Exit command failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return;
    }

    // Don't treat lone '/' as a URL
    if (trimmedInput === '/') {
      return;
    }

    const parsed = parseCommand(trimmedInput);
    if (parsed) {
      const command = this.commands.find((cmd) => cmd.name === parsed.name);
      if (command) {
        const argsString = parsed.args.join(' ');
        try {
          await command.execute(argsString, this.explorBot);
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
      return this.commands.some((cmd) => cmd.name === parsed.name);
    }

    return false;
  }

  // InputManager implementation
  registerInputPane(addLog: (entry: string) => void, onSubmit: InputSubmitCallback): () => void {
    const pane = { addLog, onSubmit };
    this.registeredInputPanes.add(pane);

    // Return unregister function
    return () => {
      this.registeredInputPanes.delete(pane);
    };
  }

  getFilteredCommands(input: string): string[] {
    const trimmedInput = input.trim();
    const normalizedInput = trimmedInput === '/' ? '' : trimmedInput;
    const slashCommands = this.getAvailableCommands().filter((cmd) => cmd.startsWith('/'));
    const defaultCommands = ['/explore', '/navigate', '/plan', '/research', '/aria', '/html', 'exit'];
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

    // Check if this is a command (starts with / or I.)
    const isCommand = trimmedInput.startsWith('/') || trimmedInput.startsWith('I.');

    if (isCommand) {
      // Otherwise, execute as command
      try {
        await this.executeCommand(trimmedInput);
      } catch (error) {
        // Use the first registered pane's addLog if available
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
