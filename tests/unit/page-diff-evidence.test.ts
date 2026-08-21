import { beforeEach, describe, expect, test } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { successToolResult } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';
import { htmlDiff } from '../../src/utils/html-diff.ts';

const page = (body: string) => `<html><body><div class="app">${body}</div></body></html>`;

describe('html diff messages', () => {
  test('reports a notification that carries no aria role', async () => {
    const before = page('<div class="notify-container"></div><button>Launch</button>');
    const after = page('<div class="notify-container"><div class="callout error"><span>Operation against a key holding the wrong kind of value</span></div></div><button>Launch</button>');

    const diff = await htmlDiff(before, after);

    expect(diff.messages).toContain('Operation against a key holding the wrong kind of value');
  });

  test('reports live region text and keeps it out of the list once it stops changing', async () => {
    const before = page('<div role="alert"></div>');
    const after = page('<div role="alert">Payment declined</div>');

    expect((await htmlDiff(before, after)).messages).toEqual(['Payment declined']);
    expect((await htmlDiff(after, after)).messages).toEqual([]);
  });

  test('reads aria-live regions and output elements', async () => {
    const before = page('<div aria-live="polite"></div><output></output>');
    const after = page('<div aria-live="polite">Saved</div><output>3 results</output>');

    expect((await htmlDiff(before, after)).messages).toEqual(['Saved', '3 results']);
  });

  test('reports nothing when the page did not change', async () => {
    const html = page('<div role="status">Idle</div>');

    expect((await htmlDiff(html, html)).messages).toEqual([]);
  });
});

describe('pageDiff evidence', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  test('carries messages, requests and console errors of the action', async () => {
    const previous = new ActionResult({ id: 1, url: '/runs', html: page('<form><button>Save</button></form>') });
    const current = new ActionResult({
      id: 2,
      url: '/runs',
      html: page('<form><button>Save</button></form><div class="callout error">Save failed</div>'),
      networkRequests: [{ method: 'POST', path: '/api/runs', status: 400 }],
      browserLogs: [
        { type: 'error', text: 'POST /api/runs returned a 400' },
        { type: 'info', text: 'noise' },
      ],
    });

    const { pageDiff } = await current.toToolResult(previous, 'Save');

    expect(pageDiff?.messages).toContain('Save failed');
    expect(pageDiff?.requests).toEqual([{ method: 'POST', path: '/api/runs', status: 400 }]);
    expect(pageDiff?.consoleErrors).toEqual(['POST /api/runs returned a 400']);
  });

  test('omits evidence the action did not produce', async () => {
    const previous = new ActionResult({ id: 1, url: '/runs', html: page('<button>Save</button>') });
    const current = new ActionResult({ id: 2, url: '/runs', html: page('<button>Save</button>') });

    const { pageDiff } = await current.toToolResult(previous, 'Save');

    expect(pageDiff?.messages).toBeUndefined();
    expect(pageDiff?.requests).toBeUndefined();
    expect(pageDiff?.consoleErrors).toBeUndefined();
  });

  test('reports requests of a first-ever capture with no previous state', async () => {
    const current = new ActionResult({
      id: 1,
      url: '/runs',
      html: page('<button>Save</button>'),
      networkRequests: [{ method: 'GET', path: '/api/runs', status: 200 }],
    });

    const { pageDiff } = await current.toToolResult(null, 'Save');

    expect(pageDiff?.requests).toEqual([{ method: 'GET', path: '/api/runs', status: 200 }]);
  });
});

describe('tool suggestion for rejected requests', () => {
  test('leads with the server rejection when a request failed', () => {
    const result = successToolResult('click', {
      pageDiff: { urlChanged: false, currentUrl: '/runs', requests: [{ method: 'POST', path: '/api/runs', status: 500 }] },
    });

    expect(result.suggestion).toStartWith('The server rejected a request made by this action');
  });

  test('keeps the plain page diff suggestion when every request succeeded', () => {
    const result = successToolResult('click', {
      pageDiff: { urlChanged: true, currentUrl: '/runs', requests: [{ method: 'GET', path: '/api/runs', status: 200 }] },
    });

    expect(result.suggestion).toStartWith('Analyze page diff.');
  });
});
