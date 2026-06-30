import { describe, expect, it } from 'bun:test';
import Explorer from '../../src/explorer.ts';

function buildExplorer(baseUrl: string) {
  return Object.assign(Object.create(Explorer.prototype), {
    config: {
      playwright: { url: baseUrl },
      web: { url: baseUrl },
    },
  }) as Explorer;
}

describe('Explorer recovery URL resolution', () => {
  it('resolves path-only state URLs against the configured base URL', () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');

    expect((explorer as any).resolveBrowserUrl('/')).toBe('https://the-internet.herokuapp.com/');
    expect((explorer as any).resolveBrowserUrl('/add_remove_elements/')).toBe('https://the-internet.herokuapp.com/add_remove_elements/');
  });

  it('keeps absolute state URLs unchanged', () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');

    expect((explorer as any).resolveBrowserUrl('https://example.test/page')).toBe('https://example.test/page');
  });

  it('creates a fresh active page when recovering a closed page', async () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');
    const navigated: string[] = [];
    const boundEvents: string[] = [];
    const newPage = {
      goto: async (url: string) => {
        navigated.push(url);
      },
      bringToFront: async () => {},
      on: (event: string) => {
        boundEvents.push(event);
      },
      mainFrame: () => ({}),
    };
    (explorer as any).playwrightHelper = {
      page: { isClosed: () => true },
      _setPage: async (page: any) => {
        (explorer as any).playwrightHelper.page = page;
      },
      browserContext: {
        newPage: async () => newPage,
      },
    };
    (explorer as any).stateManager = {
      getCurrentState: () => ({ url: '/' }),
      updateStateFromBasic: () => {},
    };

    const recovered = await explorer.recoverFromBrowserError();

    expect(recovered).toBe(true);
    expect((explorer as any).playwrightHelper.page).toBe(newPage);
    expect(navigated).toEqual(['https://the-internet.herokuapp.com/']);
    expect(boundEvents).toContain('framenavigated');
  });

  it('recovers and retries browser operations in Explorer', async () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');
    let attempts = 0;
    let recoveries = 0;
    (explorer as any).playwrightHelper = {
      page: { isClosed: () => false },
    };
    (explorer as any).recoverFromBrowserError = async () => {
      recoveries++;
      return true;
    };

    const result = await explorer.runWithBrowserRecovery('test operation', async () => {
      attempts++;
      if (attempts === 1) throw new Error('Target closed');
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
    expect(recoveries).toBe(1);
  });

  it('falls back to browser recovery when navigation retry exposes a fatal browser error', async () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');
    let attempts = 0;
    let recoveries = 0;
    (explorer as any).playwrightHelper = {
      page: { isClosed: () => false },
    };
    (explorer as any).recoverFromBrowserError = async () => {
      recoveries++;
      return true;
    };

    const result = await explorer.runWithBrowserRecovery('test operation', async () => {
      attempts++;
      if (attempts === 1) throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
      if (attempts === 2) throw new Error('Target closed');
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(attempts).toBe(3);
    expect(recoveries).toBe(1);
  });

  it('recovers and retries action attempts through Explorer', async () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');
    let attempts = 0;
    let recoveries = 0;
    (explorer as any).playwrightHelper = {
      page: { isClosed: () => false },
    };
    (explorer as any).recoverFromBrowserError = async () => {
      recoveries++;
      return true;
    };
    (explorer as any).createAction = () => ({
      attempt: async () => {
        attempts++;
        if (attempts === 1) throw new Error('Target page, context or browser has been closed');
        return true;
      },
    });

    const result = await explorer.attemptAction('I.click("Menu")', undefined, false);

    expect(result).toBe(true);
    expect(attempts).toBe(2);
    expect(recoveries).toBe(1);
  });

  it('stops when an operation fails again after browser recovery', async () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');
    (explorer as any).playwrightHelper = {
      page: { isClosed: () => false },
    };
    (explorer as any).recoverFromBrowserError = async () => true;

    let error: unknown;
    try {
      await explorer.runWithBrowserRecovery('capturePageState', async () => {
        throw new Error('Target page, context or browser has been closed');
      });
    } catch (err) {
      error = err;
    }

    const result = await explorer.handleExecutionError(error);

    expect(result.action).toBe('stop');
    expect(result.message).toContain('failed after browser recovery');
  });

  it('returns a stop decision when browser recovery fails', async () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');
    (explorer as any).recoverFromBrowserError = async () => false;
    (explorer as any).restartBrowser = async () => false;

    const result = await explorer.handleExecutionError(new Error('Target closed'));

    expect(result.action).toBe('stop');
    expect(result.recovered).toBe(false);
  });

  it('returns guidance for non-browser execution errors', async () => {
    const explorer = buildExplorer('https://the-internet.herokuapp.com');

    const result = await explorer.handleExecutionError(new Error('Locator not found'));

    expect(result.action).toBe('continue');
    expect(result.recovered).toBeUndefined();
    expect(result.message).toContain('Previous execution error');
  });
});
