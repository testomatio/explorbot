import { describe, expect, it } from 'bun:test';
import { Navigator } from '../../src/ai/navigator.ts';

function createNavigator(invokeConversation: () => Promise<any>, attemptError?: Error) {
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
      lastError: attemptError,
      exitIframe: async () => {},
      attempt: async () => !attemptError,
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

  it('keeps the error of an assertion that failed', async () => {
    const navigator = createNavigator(async () => ({ response: { text: "```js\nI.see('Widget', 'main')\n```" } }), new Error('expected main to include "Widget"'));

    const result = await navigator.verifyState('Widget is visible in the list', createActionResult());

    expect(result.verified).toBe(false);
    expect(result.results[0].error).toBe('expected main to include "Widget"');
  });

  describe('when some assertions pass and some fail', () => {
    const twoBlocks = async () => ({ response: { text: "```js\nI.seeElement('.tab.active')\n```\n```js\nI.seeInSource('<a class=\"tab active\">')\n```" } });

    function mixedNavigator() {
      const navigator = createNavigator(twoBlocks) as any;
      let attempts = 0;
      const action: any = { assertionSteps: [], exitIframe: async () => {} };
      action.attempt = async () => {
        attempts++;
        action.lastError = undefined;
        if (attempts === 1) return true;
        action.lastError = new Error('source does not contain it');
        return false;
      };
      navigator.explorer.action = () => action;
      return navigator;
    }

    it('lets the judge decide instead of counting votes', async () => {
      const navigator = mixedNavigator();
      let asked: any;
      navigator.judge = {
        decide: async (_question: string, options: string[], state: any) => {
          if (!options.includes('the claim holds')) return { value: null };
          asked = state;
          return { value: 'the claim holds' };
        },
      };

      const result = await navigator.verifyState('The tab is active', createActionResult());

      expect(result.verified).toBe(true);
      expect(asked.assertions.map((assertion: any) => assertion.passed)).toEqual([true, false]);
      expect(asked.assertions[1].error).toBe('source does not contain it');
    });

    it('asks the agentic model when no judge is configured', async () => {
      const navigator = mixedNavigator();
      navigator.provider.getAgenticModel = () => 'agentic';
      let model: any;
      navigator.provider.generateObject = async (_messages: any, _schema: any, used: any) => {
        model = used;
        return { object: { holds: false, reason: 'the passing assertion matches any tab' } };
      };

      const result = await navigator.verifyState('The tab is active', createActionResult());

      expect(model).toBe('agentic');
      expect(result.verified).toBe(false);
    });
  });

  it('does not ask anyone when every assertion passed', async () => {
    const navigator = createNavigator(async () => ({ response: { text: "```js\nI.see('Widget')\n```\n```js\nI.seeElement('.widget')\n```" } })) as any;
    navigator.judge = {
      decide: async (_question: string, options: string[]) => {
        if (options.includes('the claim holds')) throw new Error('should not be asked');
        return { value: null };
      },
    };

    const result = await navigator.verifyState('Widget is visible in the list', createActionResult());

    expect(result.verified).toBe(true);
  });
});
