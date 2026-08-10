import { describe, expect, test } from 'bun:test';
import { createPrimaCommands } from '../src/cli.ts';

describe('prima cli options', () => {
  test('takes the logging flags before the command as well as after it', () => {
    const cmd = createPrimaCommands();
    const root = cmd.options.map((option) => option.long);
    const check = cmd.commands.find((command) => command.name() === 'check')!.options.map((option) => option.long);

    expect(root).toContain('--verbose');
    expect(root).toContain('--debug');
    expect(check).toContain('--verbose');
  });
});
