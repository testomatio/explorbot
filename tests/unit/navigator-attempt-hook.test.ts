import { describe, expect, it } from 'bun:test';
import { Navigator } from '../../src/ai/navigator.ts';

describe('Navigator resolveState attempt hook', () => {
  function createNavigator(response: string, succeedsWith: string) {
    const navigator = Object.create(Navigator.prototype) as any;
    navigator.MAX_ATTEMPTS = 5;
    navigator.config = { playwright: { url: 'http://localhost:3000' } };
    navigator.knowledgeTracker = { renderRelevantKnowledge: () => '', renderRelevantContext: () => '' };
    navigator.experienceTracker = { getSuccessfulExperience: () => [], renderExperienceFor: () => '', writeFlow: () => {} };
    navigator.provider = {
      startConversation: () => ({ addUserText: () => {} }),
      invokeConversation: async () => ({ response: { text: response } }),
    };

    const action: any = {
      lastError: null,
      actionResult: null,
      executedSteps: [],
      exitIframe: async () => {},
      attempt: async (code: string) => {
        if (code.includes(succeedsWith)) {
          action.lastError = null;
          return true;
        }
        action.lastError = new Error('element not visible');
        return false;
      },
      stateManager: { getCurrentState: () => ({ url: '/login', fullUrl: 'http://localhost:3000/login' }) },
      getActor: () => ({ wait: async () => {} }),
    };

    navigator.explorer = { action: () => action };
    navigator.stateManager = action.stateManager;
    return navigator;
  }

  function fakeActionResult() {
    return {
      url: '/login',
      isInsideIframe: false,
      toAiContext: () => 'page context',
      combinedHtml: async () => '<html></html>',
      getStateHash: () => 'login_h1',
    } as any;
  }

  it('reports every executed attempt with its code and error', async () => {
    const response = "```js\nI.click('Login')\n```\n\n```js\nI.click('#login-btn')\n```";
    const navigator = createNavigator(response, '#login-btn');
    const attempts: Array<{ code: string; error?: string }> = [];

    const resolved = await navigator.resolveState('click Login', fakeActionResult(), {
      onAttempt: (attempt: { code: string; error?: string }) => attempts.push(attempt),
    });

    expect(resolved).toBe(true);
    expect(attempts.map((attempt) => attempt.code)).toEqual(["I.click('Login')", "I.click('#login-btn')"]);
    expect(attempts[0].error).toContain('element not visible');
    expect(attempts[1].error).toBeUndefined();
  });

  it('resolves without a hook', async () => {
    const response = "```js\nI.click('#login-btn')\n```";
    const navigator = createNavigator(response, '#login-btn');

    const resolved = await navigator.resolveState('click Login', fakeActionResult());

    expect(resolved).toBe(true);
  });

  it('says AI recovery is unavailable when no provider is configured', async () => {
    const navigator = createNavigator('', '#login-btn');
    navigator.provider = undefined;

    await expect(navigator.resolveState('click Login', fakeActionResult())).rejects.toThrow(/AI-assisted recovery is unavailable/);
  });
});
