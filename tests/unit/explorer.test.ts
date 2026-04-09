import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, vi } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pageRegistry = new Map<string, string>();

mock.module('codeceptjs', () => {
  const listeners = new Map<string, Array<(payload: any) => void>>();
  const dispatch = {
    on(event: string, handler: (payload: any) => void) {
      const handlers = listeners.get(event) || [];
      listeners.set(event, [...handlers, handler]);
    },
    off(event: string, handler: (payload: any) => void) {
      const handlers = listeners.get(event) || [];
      listeners.set(
        event,
        handlers.filter((fn) => fn !== handler)
      );
    },
    emit(event: string, payload: any) {
      const handlers = listeners.get(event) || [];
      for (const handler of handlers) {
        handler(payload);
      }
    },
  };

  const state = { url: '', html: '', title: '' };

  const loadPage = async (url: string) => {
    const template = pageRegistry.get(url);
    const html = template !== undefined ? template : await (await fetch(url)).text();
    state.url = url;
    state.html = html;
    const title = html.match(/<title>([^<]*)<\/title>/i);
    state.title = title ? title[1] : '';
  };

  let pending: Array<Promise<unknown>> = [];

  const recorder = {
    start: async () => {
      pending = [];
    },
    add: (fn: () => unknown) => {
      const promise = Promise.resolve().then(fn);
      pending.push(promise);
      return promise;
    },
    promise: async (): Promise<void> => {
      if (!pending.length) {
        return;
      }
      const current = pending;
      pending = [];
      await Promise.all(current);
      await recorder.promise();
    },
    reset: async () => {
      pending = [];
    },
    stop: async () => {
      pending = [];
    },
    retry: () => {},
  };

  const ensureOutputDir = () => {
    const dir = (globalThis as any).output_dir || join(process.cwd(), 'output', 'states');
    if (existsSync(dir)) {
      return dir;
    }
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  const actor: any = {
    amOnPage(url: string) {
      recorder.add(async () => {
        await loadPage(url);
      });
    },
    see(text: string) {
      recorder.add(() => {
        if (state.html.includes(text)) {
          return;
        }
        throw new Error(`Expected to see: ${text}`);
      });
    },
    wait(seconds: number) {
      recorder.add(() => sleep(seconds * 1000));
    },
    waitForElement(locator: string) {
      recorder.add(() => {
        if (state.html.includes(locator)) {
          return;
        }
        throw new Error(`Element not found: ${locator}`);
      });
    },
    executeScript() {
      recorder.add(async () => {});
    },
    grabCurrentUrl: () => Promise.resolve(state.url),
    grabSource: () => Promise.resolve(state.html),
    grabTitle: () => Promise.resolve(state.title),
    saveScreenshot: (filename: string) => {
      const dir = ensureOutputDir();
      writeFileSync(join(dir, filename), '');
      return Promise.resolve();
    },
    grabBrowserLogs: () => Promise.resolve([]),
  };

  const page = {
    context: () => ({
      on: () => {},
      pages: () => [page],
    }),
    on: () => {},
    off: () => {},
    mainFrame: () => page,
    url: () => state.url,
    title: async () => state.title,
    waitForLoadState: async () => {},
    bringToFront: async () => {},
    evaluate: async (fn: (...a: any[]) => any, ...args: any[]) => (typeof fn === 'function' ? fn(...args) : 0),
    accessibility: {
      snapshot: async () => null,
    },
    locator: (selector: string) => ({
      ariaSnapshot: async (_opts?: { forAI?: boolean }) => '- heading "Explorer Test" [level=1]',
    }),
  };

  const playwrightHelper = {
    page,
    switchTo: async () => {},
    _startBrowser: async () => {},
    _createContextPage: async () => {},
    _stopBrowser: async () => {},
  };

  const container = {
    create: () => {},
    helpers: (name: string) => {
      if (name === 'Playwright') {
        return playwrightHelper;
      }
      return null;
    },
    support: (name: string) => {
      if (name === 'I') {
        return actor;
      }
      return null;
    },
    started: async () => {},
  };

  return {
    default: {
      container,
      recorder,
      event: { dispatcher: dispatch, step: { passed: 'step.passed', failed: 'step.failed' }, suite: { before: 'suite.before', after: 'suite.after' }, test: { before: 'test.before', after: 'test.after' }, all: { before: 'global.before', after: 'global.after' } },
      output: {},
      helper: {},
      actor,
      store: new Map(),
      pause: () => {},
      within: () => {},
    },
    container,
    recorder,
    event: { dispatcher: dispatch, step: { passed: 'step.passed', failed: 'step.failed' }, suite: { before: 'suite.before', after: 'suite.after' }, test: { before: 'test.before', after: 'test.after' }, all: { before: 'global.before', after: 'global.after' } },
    output: {},
    helper: {},
    actor,
    store: new Map(),
    pause: () => {},
    within: () => {},
  };
});

mock.module('codeceptjs/lib/mocha/test.js', () => ({
  createTest: (title: string) => ({
    title,
    fullTitle: () => title,
    steps: [],
    addStep(step: string) {
      this.steps.push(step);
    },
    addArtifact: () => {},
  }),
}));

mock.module('codeceptjs/lib/listener/steps.js', () => ({
  default: () => {},
}));

mock.module('codeceptjs/lib/listener/store.js', () => ({
  default: () => {},
}));

import { isDynamicSegment, isTemplateMatch } from '../../src/ai/planner/subpages.ts';
import { AIProvider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';
import Explorer from '../../src/explorer.ts';
import { Reporter } from '../../src/reporter.ts';

describe('isDynamicSegment', () => {
  it('detects numeric IDs', () => {
    expect(isDynamicSegment('123')).toBe(true);
    expect(isDynamicSegment('0')).toBe(true);
    expect(isDynamicSegment('999999')).toBe(true);
  });

  it('detects hex IDs', () => {
    expect(isDynamicSegment('abcd')).toBe(true);
    expect(isDynamicSegment('70dae98a')).toBe(true);
    expect(isDynamicSegment('cddb14a6')).toBe(true);
  });

  it('detects UUIDs', () => {
    expect(isDynamicSegment('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('detects ULIDs', () => {
    expect(isDynamicSegment('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
  });

  it('detects hex-prefixed slugs', () => {
    expect(isDynamicSegment('95ef0c94-mobile')).toBe(true);
    expect(isDynamicSegment('cddb14a6-quality-suite-20260408')).toBe(true);
  });

  it('detects short mixed alphanumeric', () => {
    expect(isDynamicSegment('x7f2')).toBe(true);
    expect(isDynamicSegment('abc123')).toBe(true);
    expect(isDynamicSegment('t1')).toBe(true);
  });

  it('rejects regular words', () => {
    expect(isDynamicSegment('login')).toBe(false);
    expect(isDynamicSegment('about')).toBe(false);
    expect(isDynamicSegment('feedback')).toBe(false);
    expect(isDynamicSegment('users')).toBe(false);
    expect(isDynamicSegment('new-test')).toBe(false);
    expect(isDynamicSegment('projects')).toBe(false);
    expect(isDynamicSegment('suite')).toBe(false);
    expect(isDynamicSegment('suites')).toBe(false);
    expect(isDynamicSegment('dashboard')).toBe(false);
  });
});

describe('isTemplateMatch', () => {
  it('detects suite detail template pages', () => {
    expect(isTemplateMatch('/projects/testcaselabs/suite/70dae98a/', '/projects/testcaselabs/suite/95ef0c94-mobile/')).toBe(true);
    expect(isTemplateMatch('/projects/testcaselabs/suite/70dae98a/', '/projects/testcaselabs/suite/cddb14a6-quality-suite-20260408/')).toBe(true);
  });

  it('detects new-test editor template pages', () => {
    expect(isTemplateMatch('/projects/testcaselabs/suites/cddb14a6/new-test/', '/projects/testcaselabs/suites/70dae98a/new-test/')).toBe(true);
  });

  it('detects numeric ID templates', () => {
    expect(isTemplateMatch('/suites/1', '/suites/2')).toBe(true);
    expect(isTemplateMatch('/users/123/profile', '/users/456/profile')).toBe(true);
  });

  it('rejects different page structures', () => {
    expect(isTemplateMatch('/projects/testcaselabs/', '/projects/other/')).toBe(false);
    expect(isTemplateMatch('/login', '/dashboard')).toBe(false);
  });

  it('rejects different path depths', () => {
    expect(isTemplateMatch('/suite/123', '/suite/123/detail')).toBe(false);
  });

  it('rejects when more than one segment differs', () => {
    expect(isTemplateMatch('/users/1/posts/1', '/users/2/posts/2')).toBe(false);
  });
});

describe('Explorer', () => {
  let explorer: Explorer;
  const baseUrl = 'mock://explorer.test/';

  beforeAll(async () => {
    const html = `<!doctype html><html><head><title>Explorer Test</title></head><body><h1>Text on Page</h1><p id="content">Welcome to Explorbot</p></body></html>`;
    pageRegistry.set(baseUrl, html);

    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    const parser = ConfigParser.getInstance();
    const config = parser.getConfig();
    config.playwright.url = baseUrl;
    config.playwright.browser = 'chromium';
    config.playwright.show = false;
    config.playwright.args = ['--no-sandbox'];
    config.action = { delay: 0, retries: 1 };

    for (const dir of ConfigParser.getTestDirectories()) {
      if (!dir) {
        continue;
      }
      if (existsSync(dir)) {
        continue;
      }
      mkdirSync(dir, { recursive: true });
    }

    (globalThis as any).output_dir = config.dirs?.output || join(process.cwd(), 'output', 'states');

    vi.spyOn(Reporter.prototype, 'startRun').mockResolvedValue();
    vi.spyOn(Reporter.prototype, 'finishRun').mockResolvedValue();
    vi.spyOn(Reporter.prototype, 'reportTest').mockResolvedValue();

    explorer = new Explorer(config, new AIProvider(config.ai), { headless: true });
    await explorer.start();
  });

  beforeEach(() => {
    const stateManager = explorer.getStateManager();
    stateManager.updateStateFromBasic(baseUrl, 'Initial', 'manual');
  });

  afterAll(async () => {
    await explorer.stop();
    ConfigParser.cleanupAllTestDirectories();
    vi.restoreAllMocks();
  });

  it('visit loads target page and updates state', async () => {
    const action = await explorer.visit(baseUrl);
    const currentState = explorer.getStateManager().getCurrentState();
    expect(currentState?.fullUrl).toBe(baseUrl);
    expect(currentState?.h1).toBe('Text on Page');
    expect(action.getActionResult()?.html).toContain('Welcome to Explorbot');
  });

  it('createAction executes assertions against current page', async () => {
    await explorer.visit(baseUrl);
    const action = explorer.createAction();
    await action.execute('I.see("Text on Page")');
    expect(action.getActionResult()?.html).toContain('Text on Page');
  });
});
