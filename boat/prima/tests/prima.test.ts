import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'bun:test';
import { ConfigParser } from '../../../src/config.ts';
import { Prima } from '../src/prima.ts';

beforeAll(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

function fakeState(over: Record<string, unknown> = {}) {
  return {
    url: 'https://app.example.com/login',
    title: 'Login',
    hash: 'login_h1_login',
    getStateHash: () => 'login_h1_login',
    ariaSnapshot: '- textbox "Email"\n- button "Sign in"',
    combinedHtml: () => '<form></form>',
    ...over,
  };
}

function fakePrima() {
  const prima = new Prima({ instance: 'default' });
  const executed: string[] = [];
  const after = fakeState({
    url: 'https://app.example.com/dashboard',
    title: 'Dashboard',
    hash: 'dashboard_h1_dashboard',
    getStateHash: () => 'dashboard_h1_dashboard',
    toToolResult: async () => ({ pageDiff: { urlChanged: true, ariaChanges: 'added:\n  - heading "Dashboard"' } }),
  });
  (prima as any).bot = {
    getExplorer: () => ({
      action: () => ({
        execute: async (code: string) => {
          executed.push(code);
          return { actionResult: after, lastError: null };
        },
      }),
      capture: async () => after,
    }),
    stateManager: () => ({
      getCurrentState: () => fakeState(),
      getVisitCount: () => 1,
    }),
    requestStore: () => ({ getRequests: () => [] }),
  };
  (prima as any).artifactsDir = mkdtempSync(path.join(tmpdir(), 'prima-'));
  return { prima, executed };
}

describe('Prima.pw', () => {
  test('rejects non-function argument as tool error without executing', async () => {
    const { prima, executed } = fakePrima();
    const envelope = await prima.pw("page.click('text=Login')");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('tool:');
    expect(envelope.failure?.error).toContain('function');
    expect(executed.length).toBe(0);
  });

  test('executes wrapped function and returns success envelope data', async () => {
    const { prima, executed } = fakePrima();
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(executed[0]).toContain('I.usePlaywrightTo');
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("pw ({ page }) => page.click('text=Login')");
    expect(envelope.used).toEqual(["({ page }) => page.click('text=Login')"]);
    expect(envelope.page.url).toBe('https://app.example.com/dashboard');
    expect(envelope.page.previousUrl).toBe('https://app.example.com/login');
    expect(envelope.page.state).toBe('dashboard_h1_dashboard');
    expect(envelope.page.visits).toBe(1);
  });

  test('reports page changes from the action pipeline diff and writes artifacts', async () => {
    const { prima } = fakePrima();
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(envelope.changes).toContain('heading "Dashboard"');
    expect(existsSync(envelope.artifacts!.aria)).toBe(true);
    expect(existsSync(envelope.artifacts!.html)).toBe(true);
    expect(existsSync(envelope.artifacts!.network)).toBe(true);
    expect(envelope.instance.name).toBe('default');
  });

  test('execution error returns failure envelope with captured page', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getExplorer = () => ({
      action: () => ({
        execute: async () => {
          throw new Error("locator 'text=Login' not found");
        },
      }),
      capture: async () => fakeState({ url: 'https://app.example.com/login' }),
    });
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain("locator 'text=Login' not found");
    expect(envelope.failure?.attempts).toEqual([]);
    expect(envelope.page.url).toBe('https://app.example.com/login');
    expect(envelope.artifacts).toBeTruthy();
  });

  test('unrecoverable browser still returns a failure envelope when capture fails too', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getExplorer = () => ({
      action: () => ({
        execute: async () => {
          throw new Error('Browser page is unavailable before action');
        },
      }),
      capture: async () => {
        throw new Error('Target page, context or browser has been closed');
      },
    });
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('Browser page is unavailable');
    expect(envelope.page.url).toContain('/login');
    expect(envelope.artifacts).toBeTruthy();
  });

  test('missing explorer returns a failure envelope instead of rejecting', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getExplorer = () => undefined;
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toBeTruthy();
    expect(envelope.page.url).toContain('/login');
  });
});

describe('Prima.start', () => {
  test('never launches a browser and points at session creation when nothing is alive', async () => {
    const prima = new Prima({ instance: 'default' });
    let started = false;
    (prima as any).bot = {
      start: async () => {
        started = true;
      },
    };
    await expect(prima.start()).rejects.toThrow(/playwright-cli open/);
    expect(started).toBe(false);
  });
});

describe('Prima.instanceInfo', () => {
  test('reports instance name, tab count and other instances', async () => {
    const { prima } = fakePrima();
    const info = await prima.instanceInfo();
    expect(info.name).toBe('default');
    expect(info.tabs).toBe(0);
    expect(info.others).toEqual([]);
  });
});
