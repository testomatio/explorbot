import { describe, expect, it } from 'bun:test';
import { Navigator } from '../../src/ai/navigator.ts';

const BASE_URL = 'http://localhost:3000';

function fakeActionResult(url = '/login', hash = 'start') {
  return {
    url,
    fullUrl: `${BASE_URL}${url}`,
    isInsideIframe: false,
    toAiContext: () => 'page context',
    combinedHtml: async () => '<html></html>',
    getStateHash: () => hash,
  } as any;
}

function createHarness(
  options: {
    responses?: string[];
    knowledge?: string;
    ariaChanged?: string;
    stopAt?: number;
    stopReason?: string;
    attempt?: (code: string, page: { url: string; hash: string }) => boolean;
    onWait?: (page: { url: string; hash: string }) => void;
  } = {}
) {
  const page = { url: '/login', hash: 'start' };
  const sent: string[] = [];
  const attempts: string[] = [];
  const flows: string[] = [];
  let responseIndex = 0;

  const state = () => ({
    url: page.url,
    fullUrl: `${BASE_URL}${page.url}`,
    getStateHash: () => page.hash,
    diff: async () => ({ ariaChanged: options.ariaChanged ?? null }),
  });

  const action: any = {
    lastError: null,
    actionResult: null,
    exitIframe: async () => {},
    attempt: async (code: string) => {
      attempts.push(code);
      const ok = options.attempt ? options.attempt(code, page) : true;
      action.lastError = ok ? null : new Error('element not visible\n    at Object.<anonymous>');
      return ok;
    },
    stateManager: { getCurrentState: state },
    getActor: () => ({ wait: async () => options.onWait?.(page) }),
  };

  const navigator = Object.create(Navigator.prototype) as any;
  navigator.MAX_ATTEMPTS = 5;
  navigator.config = { playwright: { url: BASE_URL } };
  navigator.knowledgeTracker = { renderRelevantContext: () => options.knowledge ?? '' };
  navigator.experienceTracker = {
    getSuccessfulExperience: () => [],
    writeFlow: (_actionResult: any, body: string) => flows.push(body),
  };
  navigator.provider = {
    startConversation: () => ({ addUserText: (text: string) => sent.push(text) }),
    invokeConversation: async (_conversation: any, tools: any) => {
      const index = responseIndex++;
      if (options.stopAt === index) await tools.stop.execute({ reason: options.stopReason ?? 'blocked' });
      return { response: { text: options.responses?.[index] ?? '' } };
    },
  };
  navigator.explorer = { action: () => action, capture: async () => state() };
  navigator.stateManager = action.stateManager;

  return { navigator, page, sent, attempts, flows };
}

describe('Navigator resolveState', () => {
  it('resolves when a proposed step reaches the expected URL', async () => {
    const harness = createHarness({
      responses: ["```js\nI.amOnPage('/login')\nI.click('#login-btn')\n```"],
      attempt: (_code, page) => {
        page.url = '/defects';
        page.hash = 'defects';
        return true;
      },
    });

    const resolved = await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(resolved).toBe(true);
    expect(harness.flows[0]).toContain('## FLOW: reach /defects from /login');
    expect(harness.flows[0]).toContain("I.click('#login-btn')");
    expect(harness.flows[0]).not.toContain('amOnPage');
  });

  it('resolves on a successful step when no URL is expected', async () => {
    const harness = createHarness({ responses: ["```js\nI.click('Save')\n```"] });

    const resolved = await harness.navigator.resolveState('click Save', fakeActionResult());

    expect(resolved).toBe(true);
  });

  it('treats code blocks as alternatives when no URL is expected', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('a')\n```\n\n```js\nI.click('b')\n```"],
      attempt: (code) => code.includes('a'),
    });

    const resolved = await harness.navigator.resolveState('click something', fakeActionResult());

    expect(resolved).toBe(true);
    expect(harness.attempts).toEqual(["I.click('a')"]);
  });

  it('spends the loop budget on the AI call and every executed step', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('a')\n```\n\n```js\nI.click('b')\n```\n\n```js\nI.click('c')\n```"],
      attempt: () => false,
    });
    harness.navigator.MAX_ATTEMPTS = 1;

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(harness.attempts).toEqual(["I.click('a')", "I.click('b')"]);
  });

  it('measures the state change against the state resolveState started from', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('Retry')\n```"],
      attempt: (_code, page) => {
        page.url = '/defects';
        return true;
      },
    });

    const resolved = await harness.navigator.resolveState('reach /defects', fakeActionResult('/login', 'start'), { expectedUrl: '/defects' });

    expect(harness.sent[1]).toContain('URL did not change (still /defects)');
    expect(resolved).toBe(true);
  });

  it('reports a successful step to the attempt hook even when the URL check fails', async () => {
    const reported: Array<{ code: string; error?: string }> = [];
    const harness = createHarness({
      responses: ["```js\nI.click('Sign in')\n```"],
      attempt: (_code, page) => {
        page.hash = 'after-submit';
        return true;
      },
    });

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), {
      expectedUrl: '/defects',
      onAttempt: (attempt: { code: string; error?: string }) => reported.push(attempt),
    });

    expect(reported).toHaveLength(1);
    expect(reported[0].error).toBeUndefined();
  });

  it('feeds a reacting page back to the AI together with its ARIA diff', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('Sign in')\n```"],
      ariaChanged: '+ alert "Invalid email or password"',
      attempt: (_code, page) => {
        page.hash = 'after-submit';
        return true;
      },
    });

    const resolved = await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(resolved).toBe(false);
    const retry = harness.sent[1];
    expect(retry).toContain('<previous_failures>');
    expect(retry).toContain('URL did not change (still /login)');
    expect(retry).toContain('Invalid email or password');
    expect(retry).toContain('Full HTML context');
    expect(retry).toContain('Choose exactly ONE path');
  });

  it('asks for different strategies when nothing on the page reacted', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('Sign in')\n```"],
      attempt: () => false,
    });

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    const retry = harness.sent[1];
    expect(retry).toContain('element not visible');
    expect(retry).toContain('intercepts pointer events');
    expect(retry).not.toContain('Choose exactly ONE path');
  });

  it('adds the full HTML context to the retry prompt only once', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('a')\n```", "```js\nI.click('b')\n```", "```js\nI.click('c')\n```"],
      attempt: () => false,
    });

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    const retries = harness.sent.slice(1);
    expect(retries.length).toBeGreaterThan(1);
    expect(retries.filter((text) => text.includes('Full HTML context'))).toHaveLength(1);
  });

  it('stops without executing anything when the AI reports a blocker', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('Sign in')\n```"],
      stopAt: 0,
      stopReason: 'the sign-in form rejected every attempt and no credentials were provided',
      knowledge: '<knowledge>base facts</knowledge>',
    });

    const resolved = await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(resolved).toBe(false);
    expect(harness.attempts).toEqual([]);
    expect(harness.navigator.lastFailureReason).toContain('no credentials were provided');
  });

  it('names the missing knowledge for the page when none is configured', async () => {
    const harness = createHarness({ responses: [''], knowledge: '' });

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(harness.navigator.lastFailureReason).toContain('no knowledge is set for /login');
    expect(harness.navigator.lastFailureReason).toContain('learn "/login"');
  });

  it('joins every known reason', async () => {
    const harness = createHarness({
      stopAt: 0,
      stopReason: 'a human verification step blocks the flow',
      knowledge: '',
    });

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(harness.navigator.lastFailureReason.startsWith('a human verification step blocks the flow; ')).toBe(true);
    expect(harness.navigator.lastFailureReason).toContain('no knowledge is set for /login');
  });

  it('explains the failure when the AI never reported a blocker', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('Sign in')\n```"],
      knowledge: '<knowledge>base facts</knowledge>',
      attempt: () => false,
    });

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(harness.navigator.lastFailureReason).toContain('element not visible');
  });

  it('explains the failure when the AI proposed no steps at all', async () => {
    const harness = createHarness({ responses: [''], knowledge: '<knowledge>base facts</knowledge>' });

    await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(harness.navigator.lastFailureReason).toBeTruthy();
  });

  it('aborts instead of burning attempts when the browser cannot be recovered', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('a')\n```", "```js\nI.click('b')\n```"],
      attempt: () => {
        throw new Error('Target page, context or browser has been closed');
      },
    });

    await expect(harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' })).rejects.toThrow(/browser has been closed/);
    expect(harness.attempts).toHaveLength(1);
  });

  it('keeps retrying when a step fails for an ordinary reason', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('a')\n```", "```js\nI.click('b')\n```"],
      attempt: () => {
        throw new Error('locator resolved to 3 elements');
      },
    });

    const resolved = await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(resolved).toBe(false);
    expect(harness.attempts.length).toBeGreaterThan(1);
  });

  it('accepts a redirect that lands after the loop gave up', async () => {
    const harness = createHarness({
      responses: ["```js\nI.click('Sign in')\n```"],
      attempt: (_code, page) => {
        page.hash = 'submitting';
        return true;
      },
      onWait: (page) => {
        page.url = '/defects';
      },
    });

    const resolved = await harness.navigator.resolveState('reach /defects', fakeActionResult(), { expectedUrl: '/defects' });

    expect(resolved).toBe(true);
    expect(harness.navigator.lastFailureReason).toBeNull();
  });
});
