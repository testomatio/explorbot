import { describe, expect, test } from 'bun:test';
import { PrimaHelp } from '../src/help.ts';

describe('PrimaHelp', () => {
  test('names the cli the way it was launched', () => {
    expect(PrimaHelp.invokedAs(['node', '/usr/local/bin/prima-cli'], {})).toBe('prima-cli');
    expect(PrimaHelp.invokedAs(['node', '/app/dist/boat/prima/bin/prima-cli.js'], {})).toBe('prima-cli');
    expect(PrimaHelp.invokedAs(['node', '/usr/local/bin/prima'], {})).toBe('prima');
    expect(PrimaHelp.invokedAs(['node', '/app/dist/bin/explorbot-cli.js'], {})).toBe('explorbot prima');
    expect(PrimaHelp.invokedAs(['node', '/home/u/.npm/_npx/1a2b/node_modules/.bin/prima-cli'], { npm_command: 'exec' })).toBe('npx prima-cli');
    expect(PrimaHelp.invokedAs(['bun', '/tmp/bunx-1000-prima-cli@latest/node_modules/.bin/prima-cli'], {})).toBe('bunx prima-cli');
  });

  test('every command line in the help uses that name', () => {
    const help = new PrimaHelp('npx prima-cli');
    const lines = [help.bare(), help.footer(), help.install()].join('\n').split('\n');
    const named = lines.filter((line) => /\bprima(-cli)? (do|check|video|status|skill|go|--help|<command>)/.test(line));
    expect(named.length).toBeGreaterThan(10);
    expect(named.every((line) => line.includes('npx prima-cli'))).toBe(true);
  });
});

test('a prima symlink that the runtime resolved is still named prima, from the shell', () => {
  expect(PrimaHelp.invokedAs(['bun', '/app/boat/prima/bin/prima-cli.ts'], { _: '/usr/local/bin/prima' })).toBe('prima');
});
