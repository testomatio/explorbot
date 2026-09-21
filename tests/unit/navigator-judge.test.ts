import { describe, expect, it } from 'bun:test';
import { Decision } from '../../src/ai/judge.ts';
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

function judgeMatchingFirst() {
  return {
    decide: async (_question: string, options: string[]) => {
      if (options.length < 2) return new Decision(null, 0);
      return new Decision(options[0], 0.9);
    },
  };
}

function trackInvocation() {
  const calls = { invoked: false };
  const invoke = async () => {
    calls.invoked = true;
    return { response: { text: '```js\nI.see("Row")\n```' } };
  };
  return { calls, invoke };
}

describe('Navigator.verifyState judge dedup', () => {
  it('skips the prompt and writes no cache entry when the judge matches a claim already verified true', async () => {
    const { calls, invoke } = trackInvocation();
    const actionResult = createActionResult({ 'The row is listed': true });

    const result = await createNavigator(judgeMatchingFirst(), invoke).verifyState('the row appears', actionResult);

    expect(result.verified).toBe(true);
    expect(calls.invoked).toBe(false);
    expect(actionResult.addVerificationCalls).toEqual([]);
  });

  it('never offers a claim verified false, so the full verification loop runs', async () => {
    const { calls, invoke } = trackInvocation();
    const actionResult = createActionResult({ 'The row is listed': false });

    await createNavigator(judgeMatchingFirst(), invoke).verifyState('the row appears', actionResult);

    expect(calls.invoked).toBe(true);
    expect(actionResult.addVerificationCalls).toEqual([['the row appears', true]]);
  });
});
