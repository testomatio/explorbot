import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { Tester } from '../../src/ai/tester.ts';
import { clearActivity, getCurrentActivity } from '../../src/activity.ts';
import { ConfigParser } from '../../src/config.ts';
import { Test, TestResult } from '../../src/test-plan.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
  clearActivity(true);
});

function createState(title: string, html: string, url = '/missing', httpStatus?: number) {
  return {
    url,
    fullUrl: url,
    title,
    httpStatus,
    html,
    ariaSnapshot: '',
  };
}

function createConversation() {
  return {
    messages: [],
    addUserText: mock(() => {}),
    markLastMessageCacheable: mock(() => {}),
    protectPrefix: mock(() => {}),
  };
}

describe('Tester error page handling', () => {
  test('stops before creating a conversation when current page is already an error page', async () => {
    const currentState = createState('500 Internal Server Error', '<html><body><h1>500 Internal Server Error</h1></body></html>', '/broken');
    const startConversation = mock(() => createConversation());
    const visit = mock(async () => {});
    const startTest = mock(async () => true);
    const stopTest = mock(async () => {});

    const explorer: any = {
      getConfig: () => ({}),
      getStateManager: () => ({
        getCurrentState: () => currentState,
        clearHistory: () => {},
        getExperienceTracker: () => ({
          getExperienceTableOfContents: () => [],
          renderExperienceTocFor: () => '',
        }),
      }),
      getKnowledgeTracker: () => ({
        getRelevantKnowledge: () => [],
        renderRelevantKnowledge: () => '',
      }),
      getRequestStore: () => null,
      playwrightHelper: {
        page: {
          on: () => {},
          off: () => {},
        },
      },
      startTest,
      stopTest,
      visit,
    };
    const provider: any = {
      getSystemPromptForAgent: () => '',
      startConversation,
      invokeConversation: mock(async () => null),
    };
    const researcher: any = {};
    const navigator: any = {};
    const tester = new Tester(explorer, provider, researcher, navigator);
    const task = new Test('check broken page', 'normal', 'page works', '/broken');

    const result = await tester.test(task);

    expect(result.success).toBe(false);
    expect(task.result).toBe(TestResult.FAILED);
    expect(Object.values(task.notes).some((note) => note.message.includes('Error page detected at /broken'))).toBe(true);
    expect(startConversation).not.toHaveBeenCalled();
    expect(visit).not.toHaveBeenCalled();
    expect(startTest).toHaveBeenCalledTimes(1);
    expect(stopTest).toHaveBeenCalledTimes(1);
    expect(getCurrentActivity()).toBeNull();
  });

  test('stops without AI execution when start URL opens an error page', async () => {
    let currentState = createState('Dashboard', `<html><body>${'x'.repeat(600)}</body></html>`, '/dashboard');
    const invokeConversation = mock(async () => {
      throw new Error('should not invoke AI loop');
    });
    const visit = mock(async () => {
      currentState = createState('Application', '<html><body>Short response</body></html>', '/missing', 404);
    });
    const startTest = mock(async () => true);
    const stopTest = mock(async () => {});

    const explorer: any = {
      getConfig: () => ({}),
      getStateManager: () => ({
        getCurrentState: () => currentState,
        clearHistory: () => {},
        getExperienceTracker: () => ({
          getExperienceTableOfContents: () => [],
          renderExperienceTocFor: () => '',
        }),
      }),
      getKnowledgeTracker: () => ({
        getRelevantKnowledge: () => [],
        renderRelevantKnowledge: () => '',
      }),
      getRequestStore: () => null,
      hasOtherTabs: () => false,
      getOtherTabsInfo: () => [],
      clearOtherTabsInfo: () => {},
      getCurrentIframeInfo: () => null,
      playwrightHelper: {
        page: {
          on: () => {},
          off: () => {},
        },
      },
      startTest,
      stopTest,
      visit,
    };
    const provider: any = {
      getSystemPromptForAgent: () => '',
      startConversation: mock(() => createConversation()),
      invokeConversation,
    };
    const researcher: any = {
      research: mock(async () => ''),
      researchOverlay: mock(async () => null),
    };
    const navigator: any = {};
    const tester = new Tester(explorer, provider, researcher, navigator);
    const task = new Test('check missing page', 'normal', 'page works', '/missing');

    const result = await tester.test(task);

    expect(result.success).toBe(false);
    expect(task.result).toBe(TestResult.FAILED);
    const expectedMessageStart = 'Error page detected at /missing (HTTP 404';
    expect(Object.values(task.notes).some((note) => note.message.includes(expectedMessageStart))).toBe(true);
    expect(visit).toHaveBeenCalledTimes(1);
    expect(startTest).toHaveBeenCalledTimes(1);
    expect(stopTest).toHaveBeenCalledTimes(1);
    expect(invokeConversation).not.toHaveBeenCalled();
    expect(getCurrentActivity()).toBeNull();
  });
});
