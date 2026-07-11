import { beforeEach, describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { ConfigParser } from '../../src/config.ts';

const html = '<html><body><h1>Users</h1><form><input name="q"><button>Go</button></form></body></html>';

describe('ActionResult snapshot memoization', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('returns identical combinedHtml across repeated calls', async () => {
    const actionResult = new ActionResult({ html, url: '/users' });
    const first = await actionResult.combinedHtml();
    const second = await actionResult.combinedHtml();
    expect(second).toBe(first);
  });

  it('returns identical simplifiedHtml and textHtml across repeated calls', async () => {
    const actionResult = new ActionResult({ html, url: '/users' });
    expect(await actionResult.simplifiedHtml()).toBe(await actionResult.simplifiedHtml());
    expect(await actionResult.textHtml()).toBe(await actionResult.textHtml());
  });

  it('recomputes after html is reassigned', async () => {
    const actionResult = new ActionResult({ html, url: '/users' });
    const before = await actionResult.combinedHtml();
    actionResult.html = '<html><body><h1>Projects</h1></body></html>';
    const after = await actionResult.combinedHtml();
    expect(after).not.toBe(before);
    expect(after).toContain('Projects');
  });
});
