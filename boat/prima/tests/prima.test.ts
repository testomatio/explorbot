import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Navigator } from '../../../src/ai/navigator.ts';
import { getEndpointFilePath, listInstances } from '../../../src/browser-server.ts';
import { ConfigParser } from '../../../src/config.ts';
import { ExplorBot } from '../../../src/explorbot.ts';
import { TestResult } from '../../../src/test-plan.ts';
import { Prima } from '../src/prima.ts';

let artifactsRoot: string;

beforeAll(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
  artifactsRoot = mkdtempSync(path.join(tmpdir(), 'prima-'));
});

afterAll(() => {
  ConfigParser.cleanupAllTestDirectories();
  rmSync(artifactsRoot, { recursive: true, force: true });
});

function fakeState(over: Record<string, unknown> = {}) {
  return {
    url: 'https://app.example.com/login',
    title: 'Login',
    hash: 'login_h1_login',
    getStateHash: () => 'login_h1_login',
    ariaSnapshot: '- textbox "Email"\n- button "Sign in"',
    combinedHtml: () => '<form></form>',
    simplifiedHtml: async () => '<form><button>Sign in</button></form>',
    toToolResult: async () => ({ pageDiff: { urlChanged: false, ariaChanges: null } }),
    ...over,
  };
}

function failingExplorer() {
  return {
    action: () => ({
      execute: async () => {
        throw new Error("locator 'text=Login' not found");
      },
    }),
    capture: async () => fakeState(),
  };
}

function toolExecution(code: string, success = true, message?: string) {
  return { toolName: 'click', input: { commands: [code] }, output: { success, code, message }, wasSuccessful: success };
}

function completedExecution(numbers: number[], proof: string) {
  return { toolName: 'completed', input: { numbers, proof }, output: { success: true, action: 'completed' }, wasSuccessful: true };
}

function blockedExecution(instruction: number, reason: string) {
  return { toolName: 'blocked', input: { instruction, reason }, output: { success: true, action: 'blocked' }, wasSuccessful: true };
}

function fakeProvider(invokeConversation: (...args: any[]) => Promise<any>, prompts: string[] = []) {
  return {
    startConversation: () => ({ addUserText: (text: string) => prompts.push(text) }),
    invokeConversation,
  };
}

function fakePrima(options: Record<string, unknown> = {}) {
  const prima = new Prima({ instance: 'default', ...options });
  const executed: string[] = [];
  const executeOptions: unknown[] = [];
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
        execute: async (code: string, opts?: unknown) => {
          executed.push(code);
          executeOptions.push(opts);
          return { actionResult: after, lastError: null };
        },
      }),
      capture: async () => after,
      withPage: async (fn: (page: any) => any) => fn({ locator: () => ({ ariaSnapshot: async () => `${(prima as any).bot.stateManager().getCurrentState().ariaSnapshot}\n- button "Refreshed" [ref=e7]` }) }),
    }),
    stateManager: () => ({
      getCurrentState: () => fakeState(),
      getVisitCount: () => 1,
    }),
    getCurrentState: () => fakeState(),
    getConfig: () => ({}),
    requestStore: () => ({ getRequests: () => [] }),
    getProvider: () => ({ chat: async () => '' }),
  };
  (prima as any).artifactsDir = artifactsRoot;
  return { prima, executed, executeOptions };
}

describe('Prima.pw', () => {
  test('rejects non-function argument as tool error without executing', async () => {
    const { prima, executed } = fakePrima();
    const envelope = await prima.pw("page.click('text=Login')");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('tool:');
    expect(envelope.failure?.error).toContain('function');
    expect(envelope.failure?.compactAria).toContain('button');
    expect(executed.length).toBe(0);
  });

  test('executes wrapped function and returns success envelope data', async () => {
    const { prima, executed, executeOptions } = fakePrima();
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(executed[0]).toContain('I.usePlaywrightTo');
    expect(executeOptions[0]).toEqual({ verbatim: true });
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
    expect(envelope.status).toMatch(/^[0-9a-f]{15}$/);
    expect(existsSync(path.join(artifactsRoot, envelope.status!, 'aria.yml'))).toBe(true);
    expect(existsSync(path.join(artifactsRoot, envelope.status!, 'page.html'))).toBe(true);
    expect(existsSync(path.join(artifactsRoot, envelope.status!, 'network.jsonl'))).toBe(false);
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
    expect(envelope.page.url).toBe('https://app.example.com/login');
    expect(envelope.status).toBeTruthy();
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
    expect(envelope.status).toBeTruthy();
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

describe('Prima failure never substitutes a target', () => {
  test('a failed pw fails without consulting the navigator', async () => {
    const { prima } = fakePrima();
    let called = false;
    (prima as any).bot.getExplorer = failingExplorer;
    (prima as any).bot.agentNavigator = () => {
      called = true;
      return { resolveState: async () => true };
    };

    const envelope = await prima.pw("({ page }) => page.click('text=Login')");

    expect(called).toBe(false);
    expect(envelope.ok).toBe(false);
    expect(envelope.used).toBeUndefined();
    expect(envelope.failure?.error).toContain("locator 'text=Login' not found");
    expect(envelope.failure?.compactAria).toContain('button');
    expect(envelope.status).toBeTruthy();
  });

  test('a failed pw carries no healed marker', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getExplorer = failingExplorer;

    const envelope = await prima.pw("({ page }) => page.click('text=Login')");

    expect(envelope).not.toHaveProperty('healed');
    expect(envelope).not.toHaveProperty('healNote');
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
    (prima as any).discover = () => ({ candidates: [] });
    await expect(prima.start()).rejects.toThrow(/playwright-cli open/);
    expect(started).toBe(false);
  });
});

describe('Prima attach ladder', () => {
  const descriptor = { file: 'a', title: 'default', endpoint: '/tmp/pw/a.sock', workspaceDir: process.cwd(), browserName: 'chromium', playwrightLib: '/lib/pw' };

  function ladderPrima(options: Record<string, unknown> = {}) {
    const prima = new Prima({ instance: 'default', ...options });
    const calls: string[] = [];
    (prima as any).bot = { start: async () => calls.push('bot.start'), getCurrentState: () => null };
    return { prima, calls };
  }

  test('start attaches to workspace playwright-cli browser before own daemon', async () => {
    const { prima, calls } = ladderPrima();
    (prima as any).discover = () => ({ match: descriptor, candidates: [] });
    (prima as any).attachToEndpoint = async () => {
      calls.push('attach');
      return true;
    };
    (prima as any).connectOwnInstance = async () => {
      calls.push('own');
      return true;
    };

    await prima.start();
    expect(calls).toEqual(['attach', 'bot.start']);
  });

  test('dead playwright-cli descriptor falls through to the own instance', async () => {
    const { prima, calls } = ladderPrima();
    (prima as any).discover = () => ({ match: descriptor, candidates: [descriptor] });
    (prima as any).attachToEndpoint = async () => {
      calls.push('attach');
      return false;
    };
    (prima as any).connectOwnInstance = async () => {
      calls.push('own');
      return true;
    };

    await prima.start();
    expect(calls).toEqual(['attach', 'own', 'bot.start']);
  });

  test('start uses explicitly started own instance when nothing attachable', async () => {
    const { prima, calls } = ladderPrima();
    (prima as any).discover = () => ({ candidates: [] });
    (prima as any).attachToEndpoint = async () => {
      calls.push('attach');
      return true;
    };
    (prima as any).connectOwnInstance = async () => {
      calls.push('own');
      return true;
    };

    await prima.start();
    expect(calls).toEqual(['own', 'bot.start']);
  });

  test('explicit endpoint attaches without discovery', async () => {
    const { prima } = ladderPrima({ endpoint: 'ws://127.0.0.1:4321/session' });
    const attached: any[] = [];
    (prima as any).discover = () => {
      throw new Error('discovery must be skipped for an explicit endpoint');
    };
    (prima as any).attachToEndpoint = async (target: unknown) => {
      attached.push(target);
      return true;
    };

    await prima.start();
    expect(attached.length).toBe(1);
    expect(attached[0].endpoint).toBe('ws://127.0.0.1:4321/session');
  });

  test('unreachable explicit endpoint fails naming the endpoint', async () => {
    const { prima } = ladderPrima({ endpoint: 'ws://127.0.0.1:4321/session' });
    (prima as any).attachToEndpoint = async () => false;

    await expect(prima.start()).rejects.toThrow(/ws:\/\/127.0.0.1:4321\/session/);
  });

  test('start fails with playwright-cli guidance when no session exists anywhere', async () => {
    const { prima } = ladderPrima();
    (prima as any).discover = () => ({ candidates: [] });
    (prima as any).connectOwnInstance = async () => false;

    await expect(prima.start()).rejects.toThrow(/playwright-cli open/);
    await expect(prima.start()).rejects.toThrow(/prima browser start/);
  });

  test('ambiguous sessions surface as tool error listing candidates', async () => {
    const { prima } = ladderPrima();
    (prima as any).discover = () => ({ candidates: [{ title: 'auth' }, { title: 'smoke' }] });

    await expect(prima.start()).rejects.toThrow(/auth.*smoke|smoke.*auth/);
  });

  test('a stale descriptor is skipped so a live session beside it still wins', async () => {
    const { prima } = fakePrima();
    const stale = { ...descriptor, title: 'default', endpoint: '/tmp/pw/stale.sock' };
    const live = { ...descriptor, title: 'auth', endpoint: '/tmp/pw/auth.sock' };
    const disconnected: string[] = [];
    (prima as any).connectDescriptor = async (candidate: any) => {
      if (candidate.endpoint === stale.endpoint) return null;
      return { endpoint: candidate.endpoint, close: async () => disconnected.push(candidate.endpoint) };
    };

    const discovery = await (prima as any).discover([stale, live]);
    expect(discovery.match?.title).toBe('auth');
    expect(discovery.candidates.map((candidate: any) => candidate.title)).toEqual(['auth']);
    expect(discovery.browser?.endpoint).toBe(live.endpoint);
    expect(disconnected).toEqual([]);
  });

  test('probe connections that are not attached to are disconnected', async () => {
    const { prima } = fakePrima();
    const first = { ...descriptor, title: 'auth' };
    const second = { ...descriptor, title: 'smoke', endpoint: '/tmp/pw/smoke.sock' };
    const disconnected: string[] = [];
    (prima as any).connectDescriptor = async (candidate: any) => ({ close: async () => disconnected.push(candidate.title) });

    const discovery = await (prima as any).discover([first, second]);
    expect(discovery.match).toBeUndefined();
    expect(discovery.candidates.length).toBe(2);
    expect(disconnected.sort()).toEqual(['auth', 'smoke']);
  });

  test('the probed connection is reused instead of connecting twice', async () => {
    const { prima } = fakePrima();
    let connects = 0;
    const injected: any[] = [];
    (prima as any).bot.attachBrowser = (browser: unknown) => injected.push(browser);
    (prima as any).connectDescriptor = async () => {
      connects++;
      return { contexts: () => [] };
    };

    const discovery = await (prima as any).discover([descriptor]);
    expect(await (prima as any).attachToEndpoint(discovery.match, discovery.browser)).toBe(true);
    expect(connects).toBe(1);
    expect(injected[0]).toBe(discovery.browser);
  });

  test('attached session is injected into the browser and reported in the instance block', async () => {
    const { prima } = fakePrima();
    const injected: any[] = [];
    (prima as any).bot.attachBrowser = (browser: unknown) => injected.push(browser);
    (prima as any).connectDescriptor = async () => ({ contexts: () => [] });

    const attached = await (prima as any).attachToEndpoint({ ...descriptor, title: 'auth', workspaceDir: '/work/app' });
    expect(attached).toBe(true);
    expect(injected.length).toBe(1);

    const info = await prima.instanceInfo();
    expect(info.attached).toContain('auth');
    expect(info.attached).toContain('/work/app');
  });

  test('endpoint attachment is reported by its endpoint', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.attachBrowser = () => {};
    (prima as any).connectDescriptor = async () => ({ contexts: () => [] });

    await (prima as any).attachToEndpoint({ ...descriptor, title: '', workspaceDir: '', endpoint: 'ws://127.0.0.1:4321/session' });
    const info = await prima.instanceInfo();
    expect(info.attached).toContain('ws://127.0.0.1:4321/session');
  });

  test('descriptor that cannot be connected reports no attachment', async () => {
    const { prima } = fakePrima();
    (prima as any).connectDescriptor = async () => null;

    expect(await (prima as any).attachToEndpoint(descriptor)).toBe(false);
    expect((await prima.instanceInfo()).attached).toBeUndefined();
  });

  test('stop in attached mode never reaches the browser server kill path', async () => {
    const { prima } = fakePrima();
    const calls: string[] = [];
    (prima as any).attached = 'playwright-cli session "default", workspace /work/app';
    (prima as any).bot.stop = async () => calls.push('bot.stop');
    (prima as any).stopInstance = async (instance: string) => {
      calls.push(`stopInstance:${instance}`);
      return true;
    };

    await prima.stop();
    expect(await prima.browserStop()).toBe(false);
    expect(calls).toEqual(['bot.stop']);
  });
});

describe('Prima.do', () => {
  test('runs a bounded AI loop over the instruction set', async () => {
    const { prima } = fakePrima();
    const prompts: string[] = [];
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls > 1) return { toolExecutions: [] };
        return { toolExecutions: [toolExecution("I.click('Login')"), completedExecution([1, 2], 'the invoice PDF is open')] };
      }, prompts);

    const envelope = await prima.do(['open the first invoice', 'download its PDF']);

    expect(prompts.join('\n')).toContain('open the first invoice');
    expect(prompts.join('\n')).toContain('download its PDF');
    expect(prompts.join('\n')).toContain('button "Sign in"');
    expect(envelope.used).toEqual(["I.click('Login')"]);
    expect(envelope.ok).toBe(true);
    expect(calls).toBe(1);
  });

  test('every instruction is reported in order with the actions that proved it', async () => {
    const { prima } = fakePrima();
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) return { toolExecutions: [toolExecution("I.click('Invoices')"), completedExecution([1], 'the invoice list is open')] };
        return { toolExecutions: [toolExecution("I.click('Download')"), completedExecution([2], 'the PDF opened in a new tab')] };
      });

    const envelope = await prima.do(['open the invoices page', 'download the PDF']);

    expect(envelope.ok).toBe(true);
    expect(envelope.steps).toEqual([
      { label: 'open the invoices page', ok: true, proof: "the invoice list is open\nI.click('Invoices')" },
      { label: 'download the PDF', ok: true, proof: "the PDF opened in a new tab\nI.click('Download')" },
    ]);
  });

  test('an instruction reported without any action behind it says so rather than being rejected', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () => fakeProvider(async () => ({ toolExecutions: [completedExecution([1], 'no cookie banner is present on this page')] }));

    const envelope = await prima.do(['dismiss the cookie banner if one appeared']);

    expect(envelope.ok).toBe(true);
    expect(envelope.steps).toEqual([{ label: 'dismiss the cookie banner if one appeared', ok: true, proof: 'no cookie banner is present on this page' }]);
  });

  test('the remaining instructions are re-stated as the ledger closes, and finished ones are not', async () => {
    const { prima } = fakePrima();
    const prompts: string[] = [];
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) return { toolExecutions: [toolExecution("I.click('Invoices')"), completedExecution([1], 'list is open')] };
        return { toolExecutions: [toolExecution("I.click('Download')"), completedExecution([2], 'pdf is open')] };
      }, prompts);

    await prima.do(['open the invoices page', 'download the PDF']);

    const progress = prompts.find((prompt) => prompt.startsWith('<progress>'));
    expect(progress).toContain('1. done — open the invoices page (list is open)');
    expect(progress).toContain('2. open — download the PDF');
  });

  test('a model that narrates instead of reporting is asked once for the ledger', async () => {
    const { prima } = fakePrima();
    const prompts: string[] = [];
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) return { toolExecutions: [toolExecution("I.click('Invoices')")] };
        if (calls === 2) return { toolExecutions: [], response: { text: 'I opened the invoices page.' } };
        return { toolExecutions: [completedExecution([1], 'the invoice list is open')] };
      }, prompts);

    const envelope = await prima.do(['open the invoices page']);

    expect(prompts.join('\n')).toContain('still unreported');
    expect(envelope.ok).toBe(true);
    expect(calls).toBe(3);
  });

  test('a model that will not report even when asked stops rather than looping', async () => {
    const { prima } = fakePrima();
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) return { toolExecutions: [toolExecution("I.click('Invoices')")] };
        return { toolExecutions: [], response: { text: 'I opened the invoices page.' } };
      });

    const envelope = await prima.do(['open the invoices page']);

    expect(envelope.ok).toBe(false);
    expect(calls).toBe(4);
  });

  test('instructions left unreported are settled from what the run actually did', async () => {
    const { prima } = fakePrima();
    const prompts: string[] = [];
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) return { toolExecutions: [toolExecution("I.click('Invoices')"), toolExecution("I.click('Download')")] };
        if (calls === 2) return { toolExecutions: [], response: { text: 'Both done.' } };
        if (calls === 3) return { toolExecutions: [], response: { text: 'Still both done.' } };
        return { toolExecutions: [completedExecution([1, 2], 'the invoice list opened and the PDF downloaded')] };
      }, prompts);

    const envelope = await prima.do(['open the invoices page', 'download the PDF']);

    expect(envelope.ok).toBe(true);
    expect(prompts.join('\n')).toContain('The run is over and these instructions were never reported');
    expect(envelope.steps?.every((step) => step.ok)).toBe(true);
  });

  test('an instruction the model never reported is named as unaccounted for', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () => fakeProvider(async () => ({ toolExecutions: [toolExecution("I.click('Invoices')"), completedExecution([1], 'list is open')] }));

    const envelope = await prima.do(['open the invoices page', 'download the PDF']);

    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('open: download the PDF');
    expect(envelope.steps?.[1]).toMatchObject({ label: 'download the PDF', ok: false });
    expect(envelope.steps?.[1].proof).toContain('never reported');
  });

  test('a stray failed action does not fail a sequence whose instructions all closed', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => ({
        toolExecutions: [toolExecution("I.click('Invoices')"), completedExecution([1], 'list is open'), toolExecution("I.pressKey('End')", false, 'No element is focused')],
      }));

    const envelope = await prima.do(['open the invoices page']);

    expect(envelope.ok).toBe(true);
  });

  test('caps iterations at the instruction budget', async () => {
    const { prima } = fakePrima();
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        return { toolExecutions: [toolExecution("I.click('Next')")] };
      });

    // one extra call past each cap is the closing pass that asks for the unreported instructions
    await prima.do(['first step', 'second step']);
    expect(calls).toBe(6 + 1);

    calls = 0;
    await prima.do(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(calls).toBe(16 + 1);

    calls = 0;
    await prima.do(Array.from({ length: 20 }, (_, i) => `step ${i}`));
    expect(calls).toBe(24 + 1);
  });

  test('a failed tool execution fails the command instead of reaching for another element', async () => {
    const { prima } = fakePrima();
    let resolved = false;
    (prima as any).bot.getProvider = () => fakeProvider(async () => ({ toolExecutions: [toolExecution("I.click('Login')", false, 'element not found')] }));
    (prima as any).bot.agentNavigator = () => ({
      resolveState: async () => {
        resolved = true;
        return true;
      },
    });

    const envelope = await prima.do(['click the login link']);

    expect(resolved).toBe(false);
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('element not found');
  });

  test('reports a failure when the model performs no action and keeps its explanation', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () => fakeProvider(async () => ({ toolExecutions: [], response: { text: 'This page has no invoice list to open.' } }));

    const envelope = await prima.do(['open the first invoice']);
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('No action was performed');
    expect(envelope.failure?.error).toContain('This page has no invoice list to open.');
  });

  test('re-injects fresh page context when the state changed between iterations', async () => {
    const { prima } = fakePrima();
    const prompts: string[] = [];
    const states = [fakeState(), fakeState({ hash: 'dashboard_h1_dashboard', ariaSnapshot: '- heading "Dashboard"\n- link "Invoices"' })];
    let index = 0;
    let calls = 0;
    (prima as any).bot.stateManager = () => ({ getCurrentState: () => states[index], getVisitCount: () => 1 });
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls > 2) return { toolExecutions: [] };
        index = 1;
        return { toolExecutions: [toolExecution("I.click('Invoices')")] };
      }, prompts);

    await prima.do(['open the invoices page', 'read the first invoice']);

    const contexts = prompts.filter((prompt) => prompt.includes('<page url='));
    expect(contexts.length).toBe(2);
    expect(contexts[0]).toContain('button "Sign in"');
    expect(contexts[1]).toContain('heading "Dashboard"');
  });

  test('keeps the context when the state did not change between iterations', async () => {
    const { prima } = fakePrima();
    const prompts: string[] = [];
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls > 2) return { toolExecutions: [] };
        return { toolExecutions: [toolExecution("I.click('Invoices')")] };
      }, prompts);

    await prima.do(['open the invoices page', 'read the first invoice']);
    expect(prompts.filter((prompt) => prompt.includes('<page url=')).length).toBe(1);
  });

  test('a closed ledger ends the sequence instead of burning the remaining iteration budget', async () => {
    const { prima } = fakePrima();
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) return { toolExecutions: [toolExecution("I.click('Invoices')"), completedExecution([1], 'the invoice list is open')] };
        return { toolExecutions: [completedExecution([2], 'the first invoice is on screen')] };
      });

    const envelope = await prima.do(['open the invoices page', 'read the first invoice']);

    expect(calls).toBe(2);
    expect(envelope.ok).toBe(true);
  });

  test('an instruction the model reports as blocked fails the command and keeps its reason', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => ({
        toolExecutions: [toolExecution("I.click('Invoices')"), completedExecution([1], 'the list is open'), blockedExecution(2, 'no PDF link exists on this page')],
      }));

    const envelope = await prima.do(['open the invoices page', 'download the PDF']);

    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('blocked: download the PDF — no PDF link exists on this page');
  });

  test('a check that never passed fails the command even after later actions succeed', async () => {
    const { prima } = fakePrima();
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) {
          return {
            toolExecutions: [{ toolName: 'verify', input: { assertion: 'unsaved indicator is visible' }, output: { success: false, action: 'verify', message: 'Verification failed' }, wasSuccessful: false }, toolExecution("I.click('Close')")],
          };
        }
        return { toolExecutions: [completedExecution([1, 2], 'the editor is closed')] };
      });

    const envelope = await prima.do(['confirm the unsaved indicator', 'close the editor']);

    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('unproven: unsaved indicator is visible');
    expect(envelope.steps?.[0].proof).toContain('verify: unsaved indicator is visible => FAILED');
  });

  test('a check that passes on a retry does not fail the command', async () => {
    const { prima } = fakePrima();
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        if (calls === 1) return { toolExecutions: [toolExecution("I.click('Delete')"), { toolName: 'verify', input: { assertion: 'the row is gone' }, output: { success: false, action: 'verify', message: 'Verification failed' }, wasSuccessful: false }] };
        return { toolExecutions: [{ toolName: 'verify', input: { assertion: 'the row is gone' }, output: { success: true, action: 'verify', code: "I.dontSee('Item')" }, wasSuccessful: true }, completedExecution([1, 2], 'the row is gone')] };
      });

    const envelope = await prima.do(['delete the row', 'confirm it is gone']);

    expect(envelope.ok).toBe(true);
  });
  test('context() hands back the page tree first and drops to markup only when asked again', async () => {
    const { prima } = fakePrima();
    let captured: any;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async (_conversation: unknown, tools: any) => {
        captured = tools.context;
        return { toolExecutions: [] };
      });

    await prima.do(['open the invoices page']);

    const first = await captured.execute({ reason: 'the control is not in my context' });
    expect(first.context).toContain('button "Refreshed"');
    expect(first.context).not.toContain('ref=');

    const second = await captured.execute({ reason: 'still cannot reach it' });
    expect(second.context).toContain('<form>');
  });
});

describe('Prima.check', () => {
  test('every --expected outcome is reported with its own result', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentTester = () => ({
      test: async (test: any) => {
        test.addNote('the editor opens', TestResult.PASSED);
        test.addNote('the draft is saved', TestResult.FAILED);
        return { success: false };
      },
    });
    (prima as any).bot.agentPilot = () => ({
      settleExpectations: async () => [
        { text: 'the editor opens', status: 'passed' },
        { text: 'the draft is saved', status: 'failed' },
        { text: 'the list refreshes', status: 'unverified' },
      ],
    });

    const envelope = await prima.check('edit and save a skill', ['the editor opens', 'the draft is saved', 'the list refreshes']);

    expect(envelope.expectations).toEqual([
      { text: 'the editor opens', status: 'passed' },
      { text: 'the draft is saved', status: 'failed' },
      { text: 'the list refreshes', status: 'unverified' },
    ]);
  });

  test('steps report the failures and count the rest, leaving verdicts to the outcomes section', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentTester = () => ({
      test: async (test: any) => {
        test.addNote('opened the panel', TestResult.PASSED);
        test.addNote('clicked the row', TestResult.PASSED);
        test.addNote('Failed to open the editor (click)', TestResult.FAILED);
        test.addNote('the editor opens', TestResult.PASSED);
        return { success: false };
      },
    });
    (prima as any).bot.agentPilot = () => ({ settleExpectations: async () => [{ text: 'the editor opens', status: 'passed' }] });

    const envelope = await prima.check('edit a skill', ['the editor opens']);
    const labels = envelope.steps?.map((step) => step.label) || [];

    expect(labels).toContain('Failed to open the editor (click)');
    expect(labels).not.toContain('the editor opens');
    expect(labels).not.toContain('opened the panel');
    expect(labels.at(-1)).toContain('2 further steps ran without failing');
    expect(labels.at(-1)).toContain('prima status');
  });

  test('the scenario stands in as the only outcome when none was given', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentTester = () => ({
      test: async (test: any) => {
        test.addNote('edit and save a skill', TestResult.PASSED);
        return { success: true };
      },
    });
    (prima as any).bot.agentPilot = () => ({ settleExpectations: async () => [{ text: 'edit and save a skill', status: 'passed' }] });

    const envelope = await prima.check('edit and save a skill');

    expect(envelope.ok).toBe(true);
    expect(envelope.expectations).toEqual([{ text: 'edit and save a skill', status: 'passed' }]);
  });
});

describe('Prima.ask, verify, research', () => {
  test('ask defaults to vision via screenshot analysis', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () => ({ hasVision: () => true });
    (prima as any).bot.agentResearcher = () => ({ answerQuestionAboutScreenshot: async () => 'A login page with an email form' });

    const envelope = await prima.ask('what do I see?');
    expect(envelope.answer).toContain('login');
    expect(envelope.changes).toBeUndefined();
    expect(envelope.status).toBeTruthy();
  });

  test('ask with noVision answers from researcher summary', async () => {
    const { prima } = fakePrima({ noVision: true });
    (prima as any).bot.agentResearcher = () => ({ summary: async () => 'Login form with email and password' });
    const prompts: string[] = [];
    (prima as any).bot.getProvider = () => ({
      chat: async (messages: any[]) => {
        prompts.push(messages[0].content);
        return { text: 'A login page with an email form' };
      },
    });

    const envelope = await prima.ask('what do I see?');
    expect(envelope.answer).toContain('login');
    expect(envelope.answer).not.toContain('vision');
    expect(prompts.join('\n')).toContain('Login form with email and password');
    expect(prompts.join('\n')).toContain('what do I see?');
  });

  test('ask notes the degradation when no vision model is configured', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentResearcher = () => ({ summary: async () => 'Login form' });
    (prima as any).bot.getProvider = () => ({
      hasVision: () => false,
      chat: async () => ({ text: 'A login page' }),
    });

    const envelope = await prima.ask('what do I see?');
    expect(envelope.answer).toContain('A login page');
    expect(envelope.answer).toContain('vision');
  });

  test('verify reports each assertion with its own result and gives no verdict', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentNavigator = () => ({
      verifyState: async () => ({
        verified: false,
        results: [
          { code: "I.see('Dashboard')", passed: true, proof: ['await expect(page).toContainText("Dashboard");'] },
          { code: "I.seeElement('.chart')", passed: false, proof: [] },
        ],
        successfulCodes: ["I.see('Dashboard')"],
        assertionSteps: [],
        totalAttempted: 2,
      }),
    });

    const envelope = await prima.verify('user sees the dashboard');

    expect(envelope).not.toHaveProperty('verdict');
    expect(envelope.assertions).toEqual([
      { code: "I.see('Dashboard')", passed: true, proof: ['await expect(page).toContainText("Dashboard");'] },
      { code: "I.seeElement('.chart')", passed: false, proof: [] },
    ]);
    expect(envelope.ok).toBe(true);
  });

  test('verify with nothing expressible reports no assertions rather than a failure', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentNavigator = () => ({
      verifyState: async () => ({ verified: false, inexpressible: true, results: [], successfulCodes: [], assertionSteps: [], totalAttempted: 0 }),
    });

    const envelope = await prima.verify('the save button is disabled');

    expect(envelope.assertions).toEqual([]);
    expect(envelope.ok).toBe(true);
  });

  test('research returns UI map in envelope', async () => {
    const { prima } = fakePrima();
    const options: any[] = [];
    (prima as any).bot.agentResearcher = () => ({
      research: async (_state: unknown, opts: any) => {
        options.push(opts);
        return '## Section: Login Form\n| Element | ARIA | CSS |';
      },
    });

    const envelope = await prima.research({ data: true });
    expect(envelope.research).toContain('Login Form');
    expect(envelope.ok).toBe(true);
    expect(envelope.changes).toBeUndefined();
    expect(options[0]).toMatchObject({ screenshot: true, data: true });
  });
});

describe('Prima AI availability', () => {
  test('model commands fail with the playwright-cli fallback when ai is unusable', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () => {
      throw new Error('AI connection failed: no credentials');
    };

    const envelopes = [await prima.do(['click the login link']), await prima.ask('what do I see?'), await prima.verify('user is logged in'), await prima.research()];

    for (const envelope of envelopes) {
      expect(envelope.ok).toBe(false);
      expect(envelope.failure?.error).toContain('playwright-cli');
      expect(envelope.failure?.error).toContain('AI connection failed: no credentials');
    }
  });

  test('start survives a failing ai provider bootstrap and do reports the fallback', async () => {
    const { prima } = fakePrima();
    const bot = new ExplorBot({ optionalAi: true });
    (prima as any).discover = () => ({ candidates: [] });
    (prima as any).connectOwnInstance = async () => true;
    (prima as any).bot.start = () => bot.startProviderOnly();
    (prima as any).bot.getProvider = () => bot.getProvider();
    (prima as any).bot.aiFailureReason = () => bot.aiFailureReason();

    await prima.start();
    expect(bot.getProvider()).toBeUndefined();

    const envelope = await prima.do(['click the login link']);
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('playwright-cli');
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

describe('Prima.go', () => {
  test('delegates to navigator.visit and returns envelope', async () => {
    const { prima } = fakePrima();
    const visited: string[] = [];
    (prima as any).bot.agentNavigator = () => ({
      visit: async (destination: string) => {
        visited.push(destination);
      },
    });

    const envelope = await prima.go('billing settings');
    expect(visited).toEqual(['billing settings']);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('go billing settings');
    expect(envelope.page.url).toBeTruthy();
    expect(envelope.used).toEqual([]);
  });

  test('url target reports the executed navigation code as used', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentNavigator = () => ({ visit: async () => {} });

    const envelope = await prima.go('/dashboard');
    expect(envelope.ok).toBe(true);
    expect(envelope.used).toEqual(["I.amOnPage('/dashboard')"]);
    expect(envelope.page.url).toBe('https://app.example.com/dashboard');
  });

  test('url target navigates without an ai model', async () => {
    const { prima } = fakePrima();
    const visited: string[] = [];
    (prima as any).bot.getProvider = () => {
      throw new Error('AI connection failed: no credentials');
    };
    (prima as any).bot.agentNavigator = () => ({
      visit: async (destination: string) => {
        visited.push(destination);
      },
    });

    const envelope = await prima.go('https://app.example.com/billing');
    expect(visited).toEqual(['https://app.example.com/billing']);
    expect(envelope.ok).toBe(true);
  });

  test('intent target without an ai model returns the playwright-cli fallback', async () => {
    const { prima } = fakePrima();
    let navigated = false;
    (prima as any).bot.getProvider = () => {
      throw new Error('AI connection failed: no credentials');
    };
    (prima as any).bot.agentNavigator = () => {
      navigated = true;
      return { visit: async () => {} };
    };

    const envelope = await prima.go('billing settings');
    expect(navigated).toBe(false);
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('playwright-cli');
    expect(envelope.failure?.error).toContain('AI connection failed: no credentials');
  });

  test('failed url navigation without ai degrades to a failure envelope', async () => {
    const { prima } = fakePrima();
    const navigator = Object.create(Navigator.prototype) as any;
    navigator.provider = undefined;
    navigator.config = { playwright: { url: 'https://app.example.com' } };
    navigator.hooksRunner = { runBeforeHook: async () => {}, runAfterHook: async () => {} };
    navigator.explorer = {
      action: () => ({
        execute: async () => {},
        lastError: null,
        actionResult: fakeState(),
        stateManager: { getCurrentState: () => ({ url: '/login', fullUrl: 'https://app.example.com/login' }) },
      }),
    };
    (prima as any).bot.getProvider = () => {
      throw new Error('AI provider is not configured');
    };
    (prima as any).bot.agentNavigator = () => navigator;

    const envelope = await prima.go('/billing');
    expect(envelope.ok).toBe(false);
    expect(envelope).not.toHaveProperty('healed');
    expect(envelope.failure?.error).toContain('AI-assisted recovery is unavailable');
  });

  test('navigation error fails instead of reaching the target another way', async () => {
    const { prima } = fakePrima();
    let resolved = false;
    (prima as any).bot.agentNavigator = () => ({
      visit: async () => {
        throw new Error('Navigation to /billing failed');
      },
      resolveState: async () => {
        resolved = true;
        return true;
      },
    });

    const envelope = await prima.go('/billing');

    expect(resolved).toBe(false);
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('Navigation to /billing failed');
  });

  test('go cannot run before a session exists and never launches a browser', async () => {
    const prima = new Prima({ instance: 'default' });
    let started = false;
    (prima as any).bot = {
      start: async () => {
        started = true;
      },
    };
    (prima as any).discover = () => ({ candidates: [] });

    await expect(prima.start()).rejects.toThrow(/prima browser start/);
    expect(started).toBe(false);
    expect(existsSync(getEndpointFilePath('default'))).toBe(false);
  });
});

describe('Prima browser instances', () => {
  afterEach(() => {
    for (const instance of ['default', 'staging']) {
      rmSync(getEndpointFilePath(instance), { force: true });
    }
  });

  function writeDeadEndpoint(instance: string) {
    const file = getEndpointFilePath(instance);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `ws://127.0.0.1:1/${instance}`, 'utf8');
  }

  test('browserStart launches the configured browser for the instance and keeps the server', async () => {
    const { prima } = fakePrima({ instance: 'staging' });
    const launches: any[] = [];
    let closed = false;
    (prima as any).launchOwnServer = async (opts: any, instance: string) => {
      launches.push({ opts, instance });
      return {
        close: async () => {
          closed = true;
        },
      };
    };

    await prima.browserStart();
    expect(launches).toEqual([{ opts: { browser: 'chromium', show: false }, instance: 'staging' }]);

    await prima.browserStop();
    expect(closed).toBe(true);
  });

  test('browserStop with all clears every registered instance', async () => {
    const { prima } = fakePrima();
    writeDeadEndpoint('default');
    writeDeadEndpoint('staging');
    expect(listInstances().length).toBe(2);

    await prima.browserStop(true);
    expect(listInstances()).toEqual([]);
  });

  test('browserStatus reports the instance, tabs and other instances', async () => {
    const { prima } = fakePrima();
    writeDeadEndpoint('staging');

    const status = await prima.browserStatus();
    expect(status).toContain('instance: default (0 tabs)');
    expect(status).toContain('staging');
    expect(status).toContain('browser: not running');
  });

  test('session file is wired into the browser context options', () => {
    const prima = new Prima({ session: 'output/session.json' });
    expect((prima as any).bot.options.session).toBe('output/session.json');
  });
});

describe('Prima base url', () => {
  function recordConfigLoad() {
    const loadConfig = spyOn(ConfigParser.getInstance(), 'loadConfig').mockImplementation(async () => ({}) as any);
    loadConfig.mockClear();
    return loadConfig;
  }

  test('a url is seeded into every config load, so a config-free run has one', async () => {
    const prima = new Prima({ url: 'https://app.example.com/login' });
    const loadConfig = recordConfigLoad();

    await (prima as any).loadConfig();

    expect((prima as any).bot.options.baseUrl).toBe('https://app.example.com/login');
    expect(loadConfig.mock.calls.at(-1)?.[0].baseUrl).toBe('https://app.example.com/login');
    loadConfig.mockRestore();
  });

  test('a path is left out, so the configured base url stays in charge', async () => {
    const prima = new Prima({ url: '/dashboard' });
    const loadConfig = recordConfigLoad();

    await (prima as any).loadConfig();

    expect((prima as any).bot.options.baseUrl).toBeUndefined();
    expect(loadConfig.mock.calls.at(-1)?.[0].baseUrl).toBeUndefined();
    loadConfig.mockRestore();
  });

  test('a base url only reaches the configuration, never the browser', async () => {
    const { prima } = fakePrima({ baseUrl: 'https://app.example.com/billing' });
    const loadConfig = recordConfigLoad();
    const visited: string[] = [];
    (prima as any).bot.start = async () => {};
    (prima as any).bot.getCurrentState = () => null;
    (prima as any).bot.visit = async (url: string) => visited.push(`start:${url}`);
    (prima as any).bot.agentNavigator = () => ({ visit: async (url: string) => visited.push(`go:${url}`) });
    (prima as any).discover = () => ({ candidates: [] });
    (prima as any).connectOwnInstance = async () => true;

    await prima.start();
    await prima.go('https://app.example.com/billing');

    expect(loadConfig.mock.calls.at(-1)?.[0].baseUrl).toBe('https://app.example.com/billing');
    expect(visited).toEqual(['go:https://app.example.com/billing']);
    loadConfig.mockRestore();
  });

  test('an explicit url is still opened when the session has no page', async () => {
    const { prima } = fakePrima({ url: 'https://app.example.com/billing' });
    const loadConfig = recordConfigLoad();
    const visited: string[] = [];
    (prima as any).bot.start = async () => {};
    (prima as any).bot.getCurrentState = () => null;
    (prima as any).bot.visit = async (url: string) => visited.push(`start:${url}`);
    (prima as any).discover = () => ({ candidates: [] });
    (prima as any).connectOwnInstance = async () => true;

    await prima.start();

    expect(visited).toEqual(['start:https://app.example.com/billing']);
    loadConfig.mockRestore();
  });
});
