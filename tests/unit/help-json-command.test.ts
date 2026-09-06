import { describe, expect, it } from 'bun:test';
import { Command } from 'commander';
import { HelpJsonCommand } from '../../src/commands/help-json-command.js';

const build = () => {
  const program = new Command();
  program.name('explorbot').description('AI-powered web exploration tool').version('1.2.3');
  program.command('explore <path> [extras...]').alias('x').description('Explore a page').option('--max-tests <count>', 'Maximum tests', '5');
  program.command('api').description('API boat').command('config').description('Show config').option('--json', 'Print as JSON');
  return program;
};

describe('HelpJsonCommand.data', () => {
  it('describes arguments, options and nested commands', () => {
    const data = HelpJsonCommand.data(build());
    const explore = data.commands.find((command) => command.name === 'explore')!;

    expect(explore.aliases).toEqual(['x']);
    expect(explore.arguments).toEqual([
      { name: 'path', description: '', required: true, variadic: false },
      { name: 'extras', description: '', required: false, variadic: true },
    ]);
    expect(explore.options).toContainEqual({ flags: '--max-tests <count>', description: 'Maximum tests', default: '5', choices: undefined });

    const api = data.commands.find((command) => command.name === 'api')!;
    expect(api.commands.map((command) => command.name)).toContain('config');
  });

  it('adds version and env vars only to the root command', () => {
    const data = HelpJsonCommand.data(build(), true);

    expect(data.version).toBe('1.2.3');
    expect(data.env?.length).toBeGreaterThan(0);
    expect(data.commands[0].version).toBeUndefined();
    expect(data.commands[0].env).toBeUndefined();
  });
});
