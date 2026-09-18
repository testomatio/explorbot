import { describe, expect, it } from 'bun:test';
import { Navigator } from '../../src/ai/navigator.ts';

function createNavigator(judge: any, invokeConversation: () => Promise<any>) {
  const navigator = Object.create(Navigator.prototype) as any;
  navigator.systemPrompt = 'system';
  navigator.knowledgeTracker = { renderRelevantContext: () => '' };
  navigator.experienceTracker = { renderExperienceTocFor: () => '' };
  navigator.stateManager = { updateState: () => {} };
  navigator.config = { playwright: {}, ai: { agents: { navigator: { verifyAttempts: 3, verifyTimeout: 1000 } } } };
  navigator.judge = judge;
  navigator.explorer = {
    page: null,
    action: () => ({
      assertionSteps: [],
      exitIframe: async () => {},
      attempt: async () => true,
    }),
  };
  navigator.buildExperienceTools = () => ({});
  navigator.provider = {
    startConversation: () => ({ addUserText: () => {} }),
    invokeConversation,
  };
  return navigator as Navigator;
}

function createActionResult(verifications: Record<string, boolean>) {
  const addVerificationCalls: Array<[string, boolean]> = [];
  return {
    url: '/widgets',
    isInsideIframe: false,
    verifications,
    getVerification: (message: string) => (message in verifications ? verifications[message] : null),
    addVerification: (message: string, passed: boolean) => {
      addVerificationCalls.push([message, passed]);
      verifications[message] = passed;
    },
    toAiContext: () => '<url>/widgets</url>',
    combinedHtml: async () => '<html></html>',
    addVerificationCalls,
  } as any;
}

describe('Navigator.verifyState judge dedup', () => {
  it('skips the prompt and does not cache a new entry when the judge matches a claim already verified true', async () => {
    const judge = {
      directEnabled: true,
      ask: async () => ({ same: { answer: 'c1', confidence: 0.9, probabilities: {} } }),
    };
    let invoked = false;
    const navigator = createNavigator(judge, async () => {
      invoked = true;
      return { response: { text: '```js\nI.see("Row")\n```' } };
    });
    const actionResult = createActionResult({ 'The row is listed': true });

    const result = await navigator.verifyState('the row appears', actionResult);

    expect(result.verified).toBe(true);
    expect(result.inexpressible).toBe(false);
    expect(invoked).toBe(false);
    expect(actionResult.addVerificationCalls).toEqual([]);
    expect(actionResult.verifications).toEqual({ 'The row is listed': true });
  });

  it('runs the full verification loop when the judge matches a claim already verified false', async () => {
    const judge = {
      directEnabled: true,
      ask: async () => ({ same: { answer: 'c1', confidence: 0.9, probabilities: {} } }),
    };
    let invoked = false;
    const navigator = createNavigator(judge, async () => {
      invoked = true;
      return { response: { text: '```js\nI.see("Row")\n```' } };
    });
    const actionResult = createActionResult({ 'The row is listed': false });

    const result = await navigator.verifyState('the row appears', actionResult);

    expect(invoked).toBe(true);
    expect(result.verified).toBe(true);
    expect(actionResult.addVerificationCalls).toEqual([['the row appears', true]]);
  });
});

describe('navigator judge questions', () => {
  it('treats a confident match as already verified', async () => {
    const judge = {
      directEnabled: true,
      ask: async () => ({ same: { answer: 'c1', confidence: 0.88, probabilities: { c1: 0.88, none: 0.12 } } }),
    };
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(judge as any, 'the row is listed', { 'The new row appears in the list': true })).toBe('The new row appears in the list');
  });

  it('returns null when uncertain', async () => {
    const judge = { directEnabled: true, ask: async () => ({ same: { answer: 'c1', confidence: 0.3, probabilities: {} } }) };
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(judge as any, 'x', { y: true })).toBeNull();
  });

  it('returns null with no judge and with no prior claims', async () => {
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(undefined, 'x', { y: true })).toBeNull();
    expect(await judgeAlreadyVerified({ directEnabled: true, ask: async () => null } as any, 'x', {})).toBeNull();
  });
});
