import { beforeEach, describe, expect, test } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { successToolResult } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';
import { htmlDiff, liveRegionMessages } from '../../src/utils/html-diff.ts';

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

  test('reports live region text across a navigation and leaves the new page content out', async () => {
    const before = page('<h1>Sign in</h1><button>Sign in</button>');
    const after = page('<div role="alert">Welcome back, admin</div><h1>Dashboard</h1><p>Nothing scheduled for today</p>');

    expect(liveRegionMessages(before, after)).toEqual(['Welcome back, admin']);
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

  test('keeps the content of a page it navigated to out of the messages', async () => {
    const previous = new ActionResult({ id: 1, url: '/runs', html: page('<h1>Runs</h1><a href="/projects">Projects</a>') });
    const current = new ActionResult({
      id: 2,
      url: '/projects',
      html: page('<div role="alert">Project archived</div><h1>Projects list</h1><p>Choose a project to continue</p>'),
    });

    const { pageDiff } = await current.toToolResult(previous, 'Projects');

    expect(pageDiff?.urlChanged).toBe(true);
    expect(pageDiff?.messages).toEqual(['Project archived']);
  });

  test('does not compare elements across two pages', async () => {
    const previous = new ActionResult({ id: 1, url: '/runs', html: page('<h1>Runs</h1>'), ariaSnapshot: '- button "New run"\n- link "Projects"' });
    const current = new ActionResult({ id: 2, url: '/projects', html: page('<h1>Projects list</h1>'), ariaSnapshot: '- button "Create project"\n- searchbox "Filter projects"' });

    const { pageDiff } = await current.toToolResult(previous, 'Projects');

    expect(pageDiff?.ariaChanges).toBeUndefined();
    expect(pageDiff?.htmlParts).toBeUndefined();
  });

  test('omits evidence the action did not produce', async () => {
    const previous = new ActionResult({ id: 1, url: '/runs', html: page('<button>Save</button>') });
    const current = new ActionResult({ id: 2, url: '/runs', html: page('<button>Save</button>') });

    const { pageDiff } = await current.toToolResult(previous, 'Save');

    expect(pageDiff?.messages).toBeUndefined();
    expect(pageDiff?.requests).toBeUndefined();
    expect(pageDiff?.consoleErrors).toBeUndefined();
  });

  test('survives the state rebuild every tool does before reading the diff', async () => {
    const previous = new ActionResult({ id: 1, url: '/runs', html: page('<button>Save</button>') });
    const current = new ActionResult({
      id: 2,
      url: '/runs',
      html: page('<button>Save</button>'),
      networkRequests: [{ method: 'POST', path: '/api/runs', status: 400 }],
    });

    const { pageDiff } = await ActionResult.fromState(current).toToolResult(previous, 'Save');

    expect(pageDiff?.requests).toEqual([{ method: 'POST', path: '/api/runs', status: 400 }]);
  });

  test('drops parts of a re-render that carry no added or removed element', async () => {
    const rows = (ids: string[]) => page(ids.map((id) => `<li><span><input id="${id}" type="checkbox"></span></li>`).join(''));
    const before = rows(Array.from({ length: 12 }, (_, i) => `row-before-${i}`));
    const after = rows(Array.from({ length: 12 }, (_, i) => `row-after-${i}`));

    const previous = new ActionResult({ id: 1, url: '/plans/new', html: before });
    const current = new ActionResult({ id: 2, url: '/plans/new', html: after });

    const { pageDiff } = await current.toToolResult(previous, 'Select from list');

    expect(pageDiff?.htmlParts).toBeUndefined();
    expect(successToolResult('click', { pageDiff }).suggestion).toContain('no observable change');
  });

  test('keeps parts of a re-render that added elements', async () => {
    const rows = (extra: string) => page(Array.from({ length: 12 }, (_, i) => `<li><span><input id="row-${i}" type="checkbox">${extra}</span></li>`).join(''));

    const previous = new ActionResult({ id: 1, url: '/plans/new', html: rows('') });
    const current = new ActionResult({ id: 2, url: '/plans/new', html: rows('<button>Remove</button>') });

    const { pageDiff } = await current.toToolResult(previous, 'Select from list');

    expect(pageDiff?.htmlParts?.length).toBe(12);
    expect(successToolResult('click', { pageDiff }).suggestion).not.toContain('no observable change');
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
      pageDiff: { urlChanged: false, currentUrl: '/runs', ariaChanges: 'ariaDiff:\n  added:\n    - alert "Run started"', requests: [{ method: 'GET', path: '/api/runs', status: 200 }] },
    });

    expect(result.suggestion).toStartWith('Analyze page diff.');
  });

  test('says why an action that left the page carries no element diff', () => {
    const result = successToolResult('click', { pageDiff: { urlChanged: true, previousUrl: '/runs', currentUrl: '/projects' } });

    expect(result.suggestion).toStartWith('The action left the page.');
  });
});
