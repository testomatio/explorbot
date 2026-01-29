import { describe, expect, it } from 'bun:test';
import type { ExplorBot } from '../../src/explorbot.js';
import { BaseCommand } from '../../src/commands/base-command.js';

const mockExplorBot = {} as ExplorBot;

class TestCommand extends BaseCommand {
  name = 'test';
  description = 'Test command';
  aliases = ['t', 'tst'];

  async execute(_args: string): Promise<void> {}
}

describe('BaseCommand', () => {
  it('should match primary name', () => {
    const cmd = new TestCommand(mockExplorBot);
    expect(cmd.matches('test')).toBe(true);
  });

  it('should match aliases', () => {
    const cmd = new TestCommand(mockExplorBot);
    expect(cmd.matches('t')).toBe(true);
    expect(cmd.matches('tst')).toBe(true);
  });

  it('should not match unknown names', () => {
    const cmd = new TestCommand(mockExplorBot);
    expect(cmd.matches('unknown')).toBe(false);
  });

  it('should have tuiEnabled true by default', () => {
    const cmd = new TestCommand(mockExplorBot);
    expect(cmd.tuiEnabled).toBe(true);
  });

  it('should store explorBot from constructor', () => {
    const cmd = new TestCommand(mockExplorBot);
    expect((cmd as any).explorBot).toBe(mockExplorBot);
  });
});
