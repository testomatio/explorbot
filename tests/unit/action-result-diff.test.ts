import { beforeEach, describe, expect, test } from 'bun:test';
import { ActionResult, Diff } from '../../src/action-result.ts';
import { ConfigParser } from '../../src/config.ts';

describe('ActionResult Diff', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });
  test('should create diff with previous state', () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1><button>New Button</button></body></html>',
      ariaSnapshot: 'button "Click me"\nbutton "New Button"',
    });

    const diff = new Diff(current, previous);

    expect(diff.isSameUrl()).toBe(true);
    expect(diff.urlHasChanged()).toBe(false);
  });

  test('should detect URL change', () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
    });

    const current = new ActionResult({
      url: '/page2',
      html: '<html><body><h1>Page 2</h1></body></html>',
    });

    const diff = new Diff(current, previous);

    expect(diff.isSameUrl()).toBe(false);
    expect(diff.urlHasChanged()).toBe(true);
  });

  test('should handle null previous state', () => {
    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
    });

    const diff = new Diff(current, null);

    expect(diff.isSameUrl()).toBe(false);
    expect(diff.urlHasChanged()).toBe(true);
    expect(diff.hasChanges()).toBe(false);
  });

  test('should calculate HTML diff when URLs are same', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1><button>New Button</button></body></html>',
      ariaSnapshot: 'button "Click me"\nbutton "New Button"',
    });

    const diff = await Diff.create(current, previous);

    expect(diff.htmlDiff).not.toBeNull();
    expect(diff.htmlParts.length).toBeGreaterThan(0);
  });

  test('computes HTML diff across URL changes but keeps aria diff same-url only', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: '- button "Click me"',
    });

    const current = new ActionResult({
      url: '/page2',
      html: '<html><body><h1>Page 2</h1></body></html>',
      ariaSnapshot: '- button "Other button"',
    });

    const diff = await Diff.create(current, previous);

    expect(diff.htmlDiff).not.toBeNull();
    expect(diff.pageSize).toBeGreaterThan(0);
    expect(diff.ariaChanged).toBeNull();
    expect(diff.ariaChangeCount).toBe(0);
  });

  test('does not surface navigation htmlParts in tool results', async () => {
    const previous = new ActionResult({
      id: 11,
      url: 'https://app.example.com/page1',
      html: '<html><body><h1>Page 1</h1><a href="/other">Other link</a></body></html>',
    });
    const current = new ActionResult({
      id: 12,
      url: 'https://app.example.com/page2',
      html: '<html><body><h1>Page 2</h1><div><form><input name="one"><input name="two"></form></div></body></html>',
    });

    const result = await current.toToolResult(previous, 'a');
    expect(result.pageDiff?.urlChanged).toBe(true);
    expect(result.pageDiff?.htmlParts).toBeUndefined();
  });

  test('should calculate aria diff', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: '- button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: '- button "Click me"\n- button "New Button"',
    });

    const diff = await Diff.create(current, previous);

    expect(diff.ariaChanged).not.toBeNull();
  });

  test('should detect changes correctly', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1><button>New Button</button></body></html>',
      ariaSnapshot: 'button "Click me"\nbutton "New Button"',
    });

    const diff = await Diff.create(current, previous);

    expect(diff.hasChanges()).toBe(true);
  });

  test('should not detect changes for identical states', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: 'button "Click me"',
    });

    const diff = await Diff.create(current, previous);

    expect(diff.hasChanges()).toBe(false);
  });

  test('ActionResult.diff() is pre-calculated (hasChanges truthful without manual calculate)', async () => {
    const previous = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: '- button "Click me"',
    });

    const current = new ActionResult({
      url: '/page1',
      html: '<html><body><h1>Page 1</h1></body></html>',
      ariaSnapshot: '- button "Click me"\n- button "New Button"',
    });

    const diff = await current.diff(previous);

    expect(diff.hasChanges()).toBe(true);
    expect(diff.ariaChanged).not.toBeNull();
  });
});

describe('diff memoization and areaOfInterest', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  test('returns the same Diff instance for the same previous state', async () => {
    const previous = new ActionResult({ id: 1, url: 'https://app.example.com/users', html: '<html><body><h1>Users</h1></body></html>' });
    const current = new ActionResult({ id: 2, url: 'https://app.example.com/users', html: '<html><body><h1>Users</h1><p>changed</p></body></html>' });
    const first = await current.diff(previous);
    const second = await current.diff(previous);
    expect(second).toBe(first);
  });

  test('reports the appeared region instead of a collapsed dump', async () => {
    const previous = new ActionResult({ id: 1, url: 'https://app.example.com/users', html: '<html><body><h1>Users</h1></body></html>' });
    const current = new ActionResult({
      id: 2,
      url: 'https://app.example.com/users',
      html: '<html><body><h1>Users</h1><aside class="panel"><h2>Edit User</h2></aside></body></html>',
      overlay: { type: 'drawer', name: 'Edit User', root: 'aside.panel', html: '<aside class="panel"><h2>Edit User</h2><form><input name="name"><button>Save</button></form></aside>' },
    });
    const result = await current.toToolResult(previous, 'aside.panel');
    expect(result.pageDiff?.areaOfInterest).toBe('drawer "Edit User" opened, scope: aside.panel');
    expect(result.pageDiff?.htmlParts).toHaveLength(1);
    expect(result.pageDiff?.htmlParts?.[0].container).toBe('aside.panel');
    expect(result.pageDiff?.htmlParts?.[0].subtree).toContain('Edit User');
  });
});
