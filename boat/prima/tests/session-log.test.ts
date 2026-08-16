import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { ConfigParser } from '../../../src/config.ts';
import type { EnvelopeData } from '../src/envelope.ts';
import { latestSessionFile, readSession, recordCommand, sessionFile, sessionsDir } from '../src/session-log.ts';

const session = { key: 'default', endpoint: 'ws://127.0.0.1:5000/one', title: 'prima session "default"' };
const restarted = { ...session, endpoint: 'ws://127.0.0.1:5000/two' };

beforeAll(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

afterAll(() => {
  ConfigParser.cleanupAllTestDirectories();
});

beforeEach(() => {
  rmSync(sessionsDir(), { recursive: true, force: true });
});

function envelope(over: Partial<EnvelopeData> = {}): EnvelopeData {
  return {
    ok: true,
    command: 'do "open the account menu"',
    page: { url: 'https://app.example.com/settings', title: 'Settings', state: 'settings_h1_settings', visits: 1 },
    instance: { name: 'default', tabs: 1, others: [] },
    status: 'abc123',
    ...over,
  };
}

describe('prima session log', () => {
  test('records every command of one session', () => {
    const file = sessionFile(session.key);
    recordCommand(file, session, envelope(), 1200);
    recordCommand(file, session, envelope({ command: 'check "settings save"', ok: false, status: 'def456', failure: { error: 'the form never saved' } }), 3400);

    const recorded = readSession(file);
    expect(recorded.title).toBe('prima session "default"');
    expect(recorded.tests.map((test: any) => test.title)).toEqual(['do "open the account menu"', 'check "settings save"']);
    expect(recorded.tests.map((test: any) => test.status)).toEqual(['passed', 'failed']);
    expect(recorded.tests[1].error.message).toBe('the form never saved');
    expect(recorded.tests[1].time).toBe(3400);
  });

  test('starts a new log when the session is a different browser', () => {
    const file = sessionFile(session.key);
    recordCommand(file, session, envelope(), 1000);
    recordCommand(file, restarted, envelope({ command: 'pw "({ page }) => page.title()"' }), 1000);

    const recorded = readSession(file);
    expect(recorded.tests.map((test: any) => test.title)).toEqual(['pw "({ page }) => page.title()"']);
  });

  test('carries steps, expectations and assertions as report steps', () => {
    const file = sessionFile(session.key);
    recordCommand(
      file,
      session,
      envelope({
        steps: [{ label: 'done: open the account menu', ok: true, proof: 'the menu is expanded' }],
        expectations: [
          { text: 'the theme is dark', status: 'passed' },
          { text: 'the choice survives a reload', status: 'unverified' },
        ],
        assertions: [{ code: 'I.see("Dark")', passed: true, proof: ['locator("body").filter({ hasText: "Dark" })'] }],
        stepFiles: '/tmp/prima/abc123',
      }),
      900
    );

    const [test] = readSession(file).tests;
    expect(test.steps.map((step: any) => [step.title, step.status])).toEqual([
      ['done: open the account menu', 'passed'],
      ['expected: the theme is dark', 'passed'],
      ['expected: the choice survives a reload', 'skipped'],
      ['I.see("Dark")', 'passed'],
    ]);
    expect(test.description).toContain('artifacts: /tmp/prima/abc123');
    expect(test.logs).toContain('### Result');
  });

  test('reports the most recent session when none is named', () => {
    expect(latestSessionFile()).toBe(null);

    recordCommand(sessionFile('checkout'), { ...session, key: 'checkout' }, envelope(), 500);
    expect(latestSessionFile()).toBe(sessionFile('checkout'));
    expect(existsSync(sessionFile('checkout'))).toBe(true);
  });
});
