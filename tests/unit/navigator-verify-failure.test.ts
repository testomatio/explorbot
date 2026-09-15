import { describe, expect, it } from 'bun:test';
import { Navigator } from '../../src/ai/navigator.ts';

function createNavigator(invokeConversation: () => Promise<any>) {
  const navigator = Object.create(Navigator.prototype) as any;
  navigator.systemPrompt = 'system';
  navigator.knowledgeTracker = { renderRelevantContext: () => '' };
  navigator.experienceTracker = { renderExperienceTocFor: () => '' };
  navigator.stateManager = { updateState: () => {} };
  navigator.config = { playwright: {}, ai: { agents: { navigator: { verifyAttempts: 3, verifyTimeout: 1000 } } } };
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

function createActionResult() {
  return {
    url: '/widgets',
    isInsideIframe: false,
    verifications: {},
    getVerification: () => null,
    addVerification: () => {},
    toAiContext: () => '<url>/widgets</url>',
    combinedHtml: async () => '<html></html>',
  } as any;
}

describe('Navigator.verifyState', () => {
  it('reports a failed AI call as a failure instead of an unexpressible claim', async () => {
    const navigator = createNavigator(async () => {
      throw new Error('Rate limit reached for model on tokens per minute (TPM)');
    });

    const promise = navigator.verifyState('Widget is visible in the list', createActionResult());

    expect(promise).rejects.toThrow('Rate limit reached');
  });

  it('reports an unexpressible claim when the model answers without assertion code', async () => {
    const navigator = createNavigator(async () => ({ response: { text: 'I cannot express that as an assertion.' } }));

    const result = await navigator.verifyState('Widget is visible in the list', createActionResult());

    expect(result.inexpressible).toBe(true);
    expect(result.verified).toBe(false);
  });
});
