import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ConfigParser } from '../../../src/config.ts';
import { SettledExpectation } from '../../../src/test-plan.ts';
import { type EnvelopeData, renderEnvelope } from '../src/envelope.ts';
import { Prima } from '../src/prima.ts';
import { latestSessionFile, purposeFile, readSession, recordCommand, sessionFile, sessionsDir } from '../src/session-log.ts';

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
  rmSync(path.dirname(purposeFile('any')), { recursive: true, force: true });
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
        expectations: [new SettledExpectation('the theme is dark', 'passed'), new SettledExpectation('the choice survives a reload', 'unverified'), new SettledExpectation('the toggle shows dark', 'contradiction')],
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
      ['expected: the toggle shows dark', 'failed'],
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

  test('keeps a recorded video as the command artifact', () => {
    const file = sessionFile(session.key);
    recordCommand(file, session, envelope({ artifacts: { aria: '/a.yml', html: '/a.html', video: '/tmp/prima/abc123/video.webm' } }), 500);

    const [test] = readSession(file).tests;
    expect(test.artifacts).toEqual(['/tmp/prima/abc123/video.webm']);
  });
});

describe('prima purpose log', () => {
  test('collects the commands of one purpose across browser restarts', () => {
    const prima = new Prima({ purpose: 'checkout flow' });
    (prima as any).session = session;
    prima.record(envelope(), 500);
    (prima as any).session = restarted;
    prima.record(envelope({ command: 'check "the cart total updates"' }), 500);

    const recorded = readSession(purposeFile('checkout flow'));
    expect(recorded.title).toBe('checkout flow');
    expect(recorded.tests.map((test: any) => test.meta.number)).toEqual(['0001', '0002']);
    expect(recorded.tests.map((test: any) => test.title)).toEqual(['do "open the account menu"', 'check "the cart total updates"']);
    expect(readSession(sessionFile(session.key)).tests).toHaveLength(1);
  });

  test('a command without a purpose writes no purpose log', () => {
    const prima = new Prima();
    (prima as any).session = session;
    prima.record(envelope(), 500);

    expect(existsSync(path.dirname(purposeFile('checkout flow')))).toBe(false);
  });

  test('numbers each command of a purpose in hex and prints the number', () => {
    const prima = new Prima({ purpose: 'checkout flow' });
    const commands = Array.from({ length: 10 }, () => envelope());
    for (const command of commands) prima.record(command, 100);

    expect(commands[9].purpose).toEqual({ text: 'checkout flow', number: '000a' });
    expect(renderEnvelope(commands[9])).toContain('purpose: checkout flow #000a');
  });

  test('video --list shows every command of the purpose by number', async () => {
    const prima = new Prima({ purpose: 'checkout flow' });
    spyOn(prima as any, 'loadRecordedConfig').mockResolvedValue({});
    prima.record(envelope(), 100);
    prima.record(envelope({ ok: false, command: 'check "the cart total updates"' }), 100);

    expect(await prima.video({ list: true })).toBe(['#0001  passed  no video  do "open the account menu"', '#0002  FAILED  no video  check "the cart total updates"'].join('\n'));
  });

  test('video --only names the numbers that have no recording', async () => {
    const prima = new Prima({ purpose: 'checkout flow' });
    spyOn(prima as any, 'loadRecordedConfig').mockResolvedValue({});
    prima.record(envelope(), 100);

    expect(await prima.video({ only: ['0001,0007'] })).toContain('No recording for #0001, #0007');
  });

  test('--video without --purpose is refused before anything runs', async () => {
    await expect(new Prima({ video: true }).startVideo()).rejects.toThrow('--purpose');
  });
});
