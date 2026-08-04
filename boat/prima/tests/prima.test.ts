import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getEndpointFilePath, listInstances } from '../../../src/browser-server.ts';
import { ConfigParser } from '../../../src/config.ts';
import { ExplorBot } from '../../../src/explorbot.ts';
import { Prima } from '../src/prima.ts';

beforeAll(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

afterAll(() => {
  ConfigParser.cleanupAllTestDirectories();
});

function fakeState(over: Record<string, unknown> = {}) {
  return {
    url: 'https://app.example.com/login',
    title: 'Login',
    hash: 'login_h1_login',
    getStateHash: () => 'login_h1_login',
    ariaSnapshot: '- textbox "Email"\n- button "Sign in"',
    combinedHtml: () => '<form></form>',
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

function fakeProvider(invokeConversation: (...args: any[]) => Promise<any>, prompts: string[] = []) {
  return {
    startConversation: () => ({ addUserText: (text: string) => prompts.push(text) }),
    invokeConversation,
  };
}

function fakePrima(options: Record<string, unknown> = {}) {
  const prima = new Prima({ instance: 'default', ...options });
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
    getCurrentState: () => fakeState(),
    requestStore: () => ({ getRequests: () => [] }),
    getProvider: () => ({ chat: async () => '' }),
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
    expect(envelope.failure?.compactAria).toContain('button');
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

describe('Prima heal', () => {
  test('failed pw heals via navigator and reports healed envelope', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getExplorer = failingExplorer;
    (prima as any).bot.agentNavigator = () => ({
      resolveState: async (_msg: string, _result: unknown, opts: any) => {
        opts?.onAttempt?.({ code: "I.click('Login')", error: 'not visible' });
        opts?.onAttempt?.({ code: "I.click('#login-btn')" });
        return true;
      },
    });
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(envelope.ok).toBe(true);
    expect(envelope.healed).toBe(true);
    expect(envelope.healNote).toBeTruthy();
    expect(envelope.used).toEqual(["I.click('#login-btn')"]);
  });

  test('exhausted heal returns failure envelope with attempts and compact aria', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getExplorer = failingExplorer;
    (prima as any).bot.agentNavigator = () => ({
      resolveState: async (_msg: string, _result: unknown, opts: any) => {
        opts?.onAttempt?.({ code: "I.click('Login')", error: 'not visible' });
        return false;
      },
    });
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain("locator 'text=Login' not found");
    expect(envelope.failure?.attempts).toEqual([{ code: "I.click('Login')", outcome: 'not visible' }]);
    expect(envelope.failure?.reasoning).toBe('not visible');
    expect(envelope.failure?.compactAria).toContain('button');
    expect(envelope.artifacts).toBeTruthy();
  });

  test('heal disabled skips navigator entirely', async () => {
    const { prima } = fakePrima({ heal: false });
    let called = false;
    (prima as any).bot.getExplorer = failingExplorer;
    (prima as any).bot.agentNavigator = () => {
      called = true;
      return { resolveState: async () => true };
    };
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(called).toBe(false);
    expect(envelope.ok).toBe(false);
    expect(envelope.healed).toBeUndefined();
    expect(envelope.failure?.attempts).toEqual([]);
    expect(envelope.failure?.compactAria).toContain('button');
  });

  test('unusable ai provider skips healing and notes it in the envelope', async () => {
    const { prima } = fakePrima();
    let called = false;
    (prima as any).bot.getExplorer = failingExplorer;
    (prima as any).bot.getProvider = () => {
      throw new Error('AI provider is not configured');
    };
    (prima as any).bot.agentNavigator = () => {
      called = true;
      return { resolveState: async () => true };
    };
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(called).toBe(false);
    expect(envelope.ok).toBe(false);
    expect(envelope.healed).toBe(false);
    expect(envelope.healNote).toContain('ai unavailable');
    expect(envelope.healNote).toContain('AI provider is not configured');
    expect(envelope.failure?.error).toContain("locator 'text=Login' not found");
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
    await expect(prima.start()).rejects.toThrow(/not wired yet/);
    expect(started).toBe(false);
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
        return { toolExecutions: [toolExecution("I.click('Login')")] };
      }, prompts);

    const envelope = await prima.do(['open the first invoice', 'download its PDF']);

    expect(prompts.join('\n')).toContain('open the first invoice');
    expect(prompts.join('\n')).toContain('download its PDF');
    expect(prompts.join('\n')).toContain('button "Sign in"');
    expect(envelope.used).toEqual(["I.click('Login')"]);
    expect(envelope.ok).toBe(true);
    expect(calls).toBe(2);
  });

  test('caps iterations at the instruction budget', async () => {
    const { prima } = fakePrima();
    let calls = 0;
    (prima as any).bot.getProvider = () =>
      fakeProvider(async () => {
        calls++;
        return { toolExecutions: [toolExecution("I.click('Next')")] };
      });

    await prima.do(['first step', 'second step']);
    expect(calls).toBe(4);

    calls = 0;
    await prima.do(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(calls).toBe(6);
  });

  test('routes a failed tool execution through heal', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.getProvider = () => fakeProvider(async () => ({ toolExecutions: [toolExecution("I.click('Login')", false, 'element not found')] }));
    (prima as any).bot.agentNavigator = () => ({
      resolveState: async (_msg: string, _result: unknown, opts: any) => {
        opts?.onAttempt?.({ code: "I.click('#login-btn')" });
        return true;
      },
    });

    const envelope = await prima.do(['click the login link']);
    expect(envelope.ok).toBe(true);
    expect(envelope.healed).toBe(true);
    expect(envelope.used).toEqual(["I.click('#login-btn')"]);
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

    expect(prompts.length).toBe(2);
    expect(prompts[0]).toContain('button "Sign in"');
    expect(prompts[1]).toContain('heading "Dashboard"');
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
    expect(prompts.length).toBe(1);
  });

  test('click is a single-instruction alias over do', async () => {
    const { prima } = fakePrima();
    const received: string[][] = [];
    (prima as any).do = async (instructions: string[]) => {
      received.push(instructions);
      return { ok: true };
    };

    await prima.click('the login link');
    expect(received[0].length).toBe(1);
    expect(received[0][0]).toContain('the login link');
  });

  test('fill is a single-instruction alias carrying field and value', async () => {
    const { prima } = fakePrima();
    const received: string[][] = [];
    (prima as any).do = async (instructions: string[]) => {
      received.push(instructions);
      return { ok: true };
    };

    await prima.fill('the email field', 'user@example.com');
    expect(received[0].length).toBe(1);
    expect(received[0][0]).toContain('the email field');
    expect(received[0][0]).toContain('user@example.com');
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
    expect(envelope.artifacts).toBeTruthy();
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

  test('verify returns verdict with assertion code', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentNavigator = () => ({
      verifyState: async () => ({ verified: true, successfulCodes: ["I.see('Dashboard')"], assertionSteps: [], totalAttempted: 1 }),
    });

    const envelope = await prima.verify('user sees the dashboard');
    expect(envelope.verdict?.passed).toBe(true);
    expect(envelope.verdict?.code).toBe("I.see('Dashboard')");
    expect(envelope.ok).toBe(true);
  });

  test('failed verification is reported as a failed verdict', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentNavigator = () => ({
      verifyState: async () => ({ verified: false, successfulCodes: [], assertionSteps: [], totalAttempted: 3 }),
    });

    const envelope = await prima.verify('user sees the dashboard');
    expect(envelope.verdict?.passed).toBe(false);
    expect(envelope.verdict?.evidence).toBeTruthy();
    expect(envelope.ok).toBe(false);
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
    (prima as any).bot.getProvider = () => {
      throw new Error('AI provider is not configured');
    };
    (prima as any).bot.agentNavigator = () => ({
      visit: async () => {
        throw new Error('Navigation to /billing failed: redirected to /login and could not resolve');
      },
    });

    const envelope = await prima.go('/billing');
    expect(envelope.ok).toBe(false);
    expect(envelope.healed).toBe(false);
    expect(envelope.healNote).toContain('ai unavailable');
    expect(envelope.failure?.error).toContain('redirected to /login');
  });

  test('navigation error is routed through heal', async () => {
    const { prima } = fakePrima();
    (prima as any).bot.agentNavigator = () => ({
      visit: async () => {
        throw new Error('Navigation to /billing failed');
      },
      resolveState: async (_message: string, _result: unknown, opts: any) => {
        opts?.onAttempt?.({ code: "I.click('Billing')" });
        return true;
      },
    });

    const envelope = await prima.go('/billing');
    expect(envelope.ok).toBe(true);
    expect(envelope.healed).toBe(true);
    expect(envelope.used).toEqual(["I.click('Billing')"]);
  });

  test('go cannot run before a session exists and never launches a browser', async () => {
    const prima = new Prima({ instance: 'default' });
    let started = false;
    (prima as any).bot = {
      start: async () => {
        started = true;
      },
    };

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
