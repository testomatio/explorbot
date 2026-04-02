import { recommendedCodeceptCommands } from './ai/rules.js';
import { type BaseCommand, createCommands } from './commands/index.js';
import type { ExplorBot } from './explorbot.js';
import { tag } from './utils/logger.js';

export type InputSubmitCallback = (input: string) => Promise<void>;

export interface InputManager {
  registerInputPane(addLog: (entry: string) => void, onSubmit: InputSubmitCallback): () => void;
  getAvailableCommands(): string[];
  getFilteredCommands(input: string): string[];
  getAutocomplete(input: string, cursor: number): CommandAutocomplete;
  setExitOnEmptyInput(enabled: boolean): void;
}

export interface ParsedCommand {
  name: string;
  args: string[];
}

export interface CommandAutocompleteSuggestion {
  value: string;
  display: string;
  description: string;
  argumentHint?: string;
}

export interface CommandAutocomplete {
  suggestions: CommandAutocompleteSuggestion[];
  replaceFrom: number;
  replaceTo: number;
  visible: boolean;
  argumentHint?: string;
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
  private runningCommands = new Set<string>();

  constructor(explorBot: ExplorBot) {
    this.explorBot = explorBot;
    this.commands = createCommands(explorBot);
    explorBot.agentCaptain().setCommandExecutor((cmd) => this.executeCommand(cmd), this.getCommandDescriptions());
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
    return [...slashCommands, ...recommendedCodeceptCommands];
  }

  getAutocomplete(input: string, cursor: number): CommandAutocomplete {
    const safeCursor = Math.max(0, Math.min(cursor, input.length));
    const slashAutocomplete = this.getSlashAutocomplete(input, safeCursor);
    if (slashAutocomplete) {
      return slashAutocomplete;
    }

    const codeceptAutocomplete = this.getCodeceptAutocomplete(input, safeCursor);
    if (codeceptAutocomplete) {
      return codeceptAutocomplete;
    }

    const exitAutocomplete = this.getExitAutocomplete(input, safeCursor);
    if (exitAutocomplete) {
      return exitAutocomplete;
    }

    return {
      suggestions: [],
      replaceFrom: safeCursor,
      replaceTo: safeCursor,
      visible: false,
    };
  }

  getCommandDescriptions(): { name: string; description: string; options: string }[] {
    const descriptions = this.commands.map((cmd) => ({
      name: `/${cmd.name}`,
      description: cmd.description,
      options: cmd.options.map((o) => `${o.flags}: ${o.description}`).join(', '),
    }));
    descriptions.push({ name: 'I.click / I.type / I.fillField / I.see / I.seeElement', description: 'Recommended CodeceptJS interaction commands', options: '' });
    return descriptions;
  }

  async executeCommand(input: string): Promise<void> {
    const trimmedInput = input.trim();
    const lowered = trimmedInput.toLowerCase();

    if (trimmedInput.startsWith('I.') || trimmedInput.startsWith('page.') || trimmedInput.startsWith('await ')) {
      try {
        await this.executeBrowserCommand(trimmedInput);
      } catch (error) {
        tag('error').log(`Browser command failed: ${error instanceof Error ? error.message : String(error)}`);
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
        if (this.runningCommands.has(command.name)) {
          tag('warning').log(`/${command.name} is already running, skipping`);
          return;
        }
        const argsString = parsed.args.join(' ');
        this.runningCommands.add(command.name);
        try {
          await command.execute(argsString);
          command.suggestions.forEach((s) => tag('step').log(s));
        } catch (error: any) {
          if (error?.name === 'AbortError') throw error;
          tag('error').log(`/${command.name} failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          this.runningCommands.delete(command.name);
        }
        return;
      }
    }

    try {
      const response = await this.explorBot.agentCaptain().handle(trimmedInput);
      if (response) {
        tag('multiline').log(response);
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
      tag('error').log(`Captain failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async executeBrowserCommand(input: string): Promise<void> {
    const action = this.explorBot.getExplorer().createAction();
    await action.execute(input);
  }

  isCommand(input: string): boolean {
    const trimmedInput = input.trim();
    const lowered = trimmedInput.toLowerCase();

    if (trimmedInput.startsWith('I.') || trimmedInput.startsWith('page.') || trimmedInput.startsWith('await ')) {
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
    return this.getAutocomplete(input, input.length).suggestions.map((suggestion) => suggestion.value);
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

    const isCommand = trimmedInput.startsWith('/') || trimmedInput.startsWith('I.') || trimmedInput.startsWith('page.') || trimmedInput.startsWith('await ');

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

  private getSlashAutocomplete(input: string, cursor: number): CommandAutocomplete | null {
    if (!input.startsWith('/')) {
      return null;
    }

    const commandEnd = input.search(/\s/);
    const replaceTo = commandEnd === -1 ? input.length : commandEnd;
    const query = input.slice(0, replaceTo);
    const insideCommand = cursor <= replaceTo;
    const parsed = parseCommand(query);
    const exactCommand = parsed ? this.findCommand(parsed.name) : undefined;
    const hasArguments = commandEnd !== -1 && input.slice(commandEnd + 1).trim().length > 0;
    const commandEntries = this.getSlashCommandEntries();
    let suggestions: CommandAutocompleteSuggestion[] = [];
    if (insideCommand) {
      if (query === '/') {
        suggestions = commandEntries.slice(0, 20).map((entry) => ({
          value: entry.value,
          display: entry.value,
          description: entry.description,
          argumentHint: entry.argumentHint,
        }));
      } else {
        suggestions = this.rankSuggestions(query, commandEntries);
      }
    }
    const argumentHint = !insideCommand && exactCommand && !hasArguments && exactCommand.options.length > 0 ? exactCommand.options.map((option) => option.flags).join(' ') : undefined;

    return {
      suggestions,
      replaceFrom: 0,
      replaceTo,
      visible: insideCommand && suggestions.length > 0,
      argumentHint,
    };
  }

  private getCodeceptAutocomplete(input: string, cursor: number): CommandAutocomplete | null {
    if (!input.startsWith('I.')) {
      return null;
    }

    const query = input.slice(0, cursor).split(/\s+/).pop() || 'I.';
    const replaceFrom = cursor - query.length;
    const firstWhitespace = input.search(/\s/);
    const tokenEnd = firstWhitespace === -1 ? input.length : firstWhitespace;
    const insideCommand = cursor <= tokenEnd;
    const suggestions = insideCommand ? this.rankSuggestions(query, this.getCodeceptEntries()) : [];

    return {
      suggestions,
      replaceFrom,
      replaceTo: tokenEnd,
      visible: insideCommand && suggestions.length > 0,
    };
  }

  private getExitAutocomplete(input: string, cursor: number): CommandAutocomplete | null {
    if (input.includes(' ')) {
      return null;
    }

    const query = input.slice(0, cursor).trim();
    if (!query) {
      return null;
    }

    const exitCommand = this.findCommand('exit');
    if (!exitCommand) {
      return null;
    }

    const entries = [
      {
        aliases: exitCommand.aliases,
        argumentHint: undefined,
        canonical: exitCommand.name,
        description: exitCommand.description,
        value: exitCommand.name,
      },
    ];
    const suggestions = this.rankSuggestions(query, entries);

    return {
      suggestions,
      replaceFrom: 0,
      replaceTo: input.length,
      visible: suggestions.length > 0,
    };
  }

  private getSlashCommandEntries(): AutocompleteEntry[] {
    const entries: AutocompleteEntry[] = [];

    for (const command of this.commands) {
      if (!command.tuiEnabled) {
        continue;
      }

      entries.push({
        aliases: command.aliases.map((alias) => `/${alias}`),
        argumentHint: command.options.length > 0 ? command.options.map((option) => option.flags).join(' ') : undefined,
        canonical: `/${command.name}`,
        description: command.description,
        value: `/${command.name}`,
      });
    }

    return entries;
  }

  private getCodeceptEntries(): AutocompleteEntry[] {
    return recommendedCodeceptCommands.map((value) => ({
      aliases: [],
      argumentHint: undefined,
      canonical: value,
      description: 'Recommended CodeceptJS interaction command',
      value,
    }));
  }

  private rankSuggestions(query: string, entries: AutocompleteEntry[]): CommandAutocompleteSuggestion[] {
    if (!query) {
      return entries.slice(0, 20).map((entry) => ({
        value: entry.value,
        display: entry.value,
        description: entry.description,
        argumentHint: entry.argumentHint,
      }));
    }

    const ranked = entries
      .map((entry) => {
        const matches = [entry.canonical, ...entry.aliases]
          .map((candidate) => ({ candidate, score: this.getMatchScore(query, candidate) }))
          .filter((candidate) => candidate.score > 0)
          .sort((left, right) => right.score - left.score);

        const match = matches[0];
        if (!match) {
          return null;
        }

        const display = match.candidate === entry.canonical ? entry.value : `${entry.value} (${match.candidate})`;

        return {
          value: match.candidate,
          display,
          description: entry.description,
          argumentHint: entry.argumentHint,
          score: match.score,
        };
      })
      .filter((entry): entry is CommandAutocompleteSuggestion & { score: number } => !!entry)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }
        return left.display.localeCompare(right.display);
      });

    return ranked.slice(0, 20).map(({ score: _score, ...suggestion }) => suggestion);
  }

  private getMatchScore(query: string, candidate: string): number {
    const normalizedQuery = query.toLowerCase();
    const normalizedCandidate = candidate.toLowerCase();

    if (normalizedCandidate === normalizedQuery) {
      return 500;
    }

    if (normalizedCandidate.startsWith(normalizedQuery)) {
      return 400 - normalizedCandidate.length;
    }

    const candidateParts = normalizedCandidate.split(/[:.\-]/).filter(Boolean);
    const queryCore = normalizedQuery.replace(/^\//, '');
    if (candidateParts.some((part) => part.startsWith(queryCore))) {
      return 300 - normalizedCandidate.length;
    }

    const index = normalizedCandidate.indexOf(normalizedQuery);
    if (index !== -1) {
      return 200 - index;
    }

    return 0;
  }
}

type AutocompleteEntry = {
  aliases: string[];
  argumentHint?: string;
  canonical: string;
  description: string;
  value: string;
};
