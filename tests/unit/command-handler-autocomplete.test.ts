import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { CommandHandler } from '../../src/command-handler.js';
import type { ExplorBot } from '../../src/explorbot.js';
import { Plan, Test } from '../../src/test-plan.js';

let plansDir = '';

beforeEach(() => {
  plansDir = mkdtempSync(path.join(tmpdir(), 'explorbot-autocomplete-'));
  new Plan('/checkout').saveToMarkdown(path.join(plansDir, 'checkout.md'));
  const loginPlan = new Plan('/login');
  loginPlan.addTest(new Test('Sign in with a valid password', 'high', ['The dashboard opens'], '/login'));
  loginPlan.saveToMarkdown(path.join(plansDir, 'login.md'));
  utimesSync(path.join(plansDir, 'checkout.md'), new Date(1000), new Date(1000));
});

afterEach(() => {
  rmSync(plansDir, { recursive: true, force: true });
});

describe('CommandHandler argument autocomplete', () => {
  it('completes a command name with a trailing space so arguments can follow', () => {
    const autocomplete = createHandler().getAutocomplete('/tes', 4);

    expect(autocomplete.suggestions[0].value).toBe('/test ');
    expect(autocomplete.completesArgument).toBeFalsy();
  });

  it('lists saved plans after /test, newest first', () => {
    const input = '/test ';
    const autocomplete = createHandler().getAutocomplete(input, input.length);

    expect(autocomplete.visible).toBe(true);
    expect(autocomplete.completesArgument).toBe(true);
    expect(autocomplete.suggestions.map((suggestion) => suggestion.value)).toEqual(['--from-plan login.md', '--from-plan checkout.md']);
    expect(autocomplete.suggestions[0].display).toBe('login.md     /login     1 test');
    expect(autocomplete.replaceFrom).toBe(input.length);
    expect(autocomplete.replaceTo).toBe(input.length);
  });

  it('filters plan files by the typed argument and replaces the whole argument', () => {
    const input = '/plan:load chec';
    const autocomplete = createHandler().getAutocomplete(input, input.length);

    expect(autocomplete.suggestions.map((suggestion) => suggestion.value)).toEqual(['checkout.md']);
    expect(autocomplete.replaceFrom).toBe('/plan:load '.length);
    expect(autocomplete.replaceTo).toBe(input.length);
  });

  it('hides suggestions once the argument matches one exactly', () => {
    const input = '/plan:load checkout.md';
    const autocomplete = createHandler().getAutocomplete(input, input.length);

    expect(autocomplete.visible).toBe(false);
  });

  it('suggests known URLs for navigation commands', () => {
    const handler = createHandler();

    for (const command of ['/navigate', '/research', '/explore']) {
      const input = `${command} /us`;
      expect(handler.getAutocomplete(input, input.length).suggestions.map((suggestion) => suggestion.value)).toEqual(['/users']);
    }
  });

  it('shows nothing for commands without argument values', () => {
    const input = '/help ';
    const autocomplete = createHandler().getAutocomplete(input, input.length);

    expect(autocomplete.visible).toBe(false);
    expect(autocomplete.suggestions).toEqual([]);
  });
});

function createHandler(): CommandHandler {
  const explorBot = {
    agentCaptain: () => ({ setCommandExecutor: () => {} }),
    getPlansDir: () => plansDir,
    stateManager: () => ({ getKnownUrls: () => ['/users', '/login'] }),
  } as unknown as ExplorBot;
  return new CommandHandler(explorBot);
}
