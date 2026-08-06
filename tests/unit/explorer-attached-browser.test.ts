import { describe, expect, it } from 'bun:test';
import Explorer from '../../src/explorer.ts';

function fakePage(url: string, events: string[]) {
  return {
    url: () => url,
    isClosed: () => false,
    on: () => {},
    bringToFront: async () => {},
    setDefaultNavigationTimeout: () => {},
    setDefaultTimeout: () => {},
    close: async () => {
      events.push(`page.close:${url}`);
    },
  };
}

function buildAttachedExplorer() {
  const events: string[] = [];
  const lastPage = fakePage('https://app.example.com/dashboard', events);
  const firstPage = fakePage('https://app.example.com/', events);
  const context = {
    pages: () => [firstPage, lastPage],
    newPage: async () => {
      events.push('context.newPage');
      return lastPage;
    },
    close: async () => {
      events.push('context.close');
    },
    storageState: async () => {
      events.push('context.storageState');
    },
    setDefaultTimeout: () => {},
  };
  const browser = {
    contexts: () => [context],
    newContext: async () => {
      events.push('browser.newContext');
      return context;
    },
    close: async () => {
      events.push('browser.close');
    },
  };
  const playwrightHelper: any = {
    options: {},
    page: null,
    browser,
    browserContext: null,
    isRunning: true,
    _createContextPage: async () => {
      events.push('helper._createContextPage');
    },
    _setPage: async (page: unknown) => {
      events.push('helper._setPage');
      playwrightHelper.page = page;
    },
    _stopBrowser: async () => {
      events.push('helper._stopBrowser');
    },
  };

  const explorer = Object.assign(Object.create(Explorer.prototype), {
    config: { playwright: {} },
    options: { attachedBrowser: browser, session: 'output/session.json' },
    playwrightHelper,
    playwrightRecorder: { start: async () => {}, stop: async () => {} },
    reporter: { finishRun: async () => {} },
    xhrCapture: null,
    started: true,
    isSharedBrowser: true,
    observedTestPages: new Set(),
  }) as Explorer;

  return { explorer, events, playwrightHelper, context, lastPage };
}

describe('Explorer attached browser', () => {
  it('adopts the existing context and its last page instead of creating one', async () => {
    const { explorer, events, playwrightHelper, context, lastPage } = buildAttachedExplorer();

    await (explorer as any).openContextPage();

    expect(events).not.toContain('helper._createContextPage');
    expect(events).not.toContain('browser.newContext');
    expect(events).not.toContain('context.newPage');
    expect(playwrightHelper.browserContext).toBe(context);
    expect(playwrightHelper.page).toBe(lastPage);
  });

  it('creates a page only when the attached context has none', async () => {
    const { explorer, events, playwrightHelper, context, lastPage } = buildAttachedExplorer();
    context.pages = () => [];

    await (explorer as any).openContextPage();

    expect(events).toContain('context.newPage');
    expect(playwrightHelper.page).toBe(lastPage);
  });

  it('stop disconnects without closing the attached browser or its context', async () => {
    const { explorer, events } = buildAttachedExplorer();
    await (explorer as any).openContextPage();

    await explorer.stop();

    expect(events).toContain('browser.close');
    expect(events).not.toContain('helper._stopBrowser');
    expect(events).not.toContain('context.close');
  });

  it('releases the adopted context without closing it when the browser restarts', async () => {
    const { explorer, events, playwrightHelper } = buildAttachedExplorer();
    await (explorer as any).openContextPage();

    await (explorer as any).closeBrowserContext();

    expect(events).not.toContain('context.close');
    expect(playwrightHelper.browserContext).toBeNull();
  });

  it('stop skips saving the session of an attached browser', async () => {
    const { explorer, events } = buildAttachedExplorer();
    await (explorer as any).openContextPage();

    await explorer.stop();

    expect(events).not.toContain('context.storageState');
  });

  it('keeps the other tabs of an attached browser open', async () => {
    const { explorer, events } = buildAttachedExplorer();
    await (explorer as any).openContextPage();

    await (explorer as any).closeOtherTabs();

    expect(events.filter((event) => event.startsWith('page.close'))).toEqual([]);
  });
});
