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

});
