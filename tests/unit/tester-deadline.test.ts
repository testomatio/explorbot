import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { clearActivity } from '../../src/activity.ts';
import { Tester } from '../../src/ai/tester.ts';
import { ConfigParser } from '../../src/config.ts';
import { Test, TestResult } from '../../src/test-plan.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
  clearActivity(true);
});

function createState() {
  return {
    url: '/dashboard',
    fullUrl: '/dashboard',
    title: 'Dashboard',
    html: '<html><body><h1>Dashboard</h1></body></html>',
    ariaSnapshot: '',
  };
}

function createConversation() {
  return {
    messages: [],
    addUserText: mock(() => {}),
    markLastMessageCacheable: mock(() => {}),
    protectPrefix: mock(() => {}),
    cleanupTag: mock(() => {}),
    compactToolResults: mock(() => {}),
  };
}

function setupTester() {
  const currentState = createState();
  const stopTest = mock(async () => {});
  const invokeConversation = mock(async () => ({ response: { text: '' }, toolExecutions: [] }));
  const finalReview = mock(async () => false);
  const saveSession = mock(async () => {});

  const explorer: any = {
    beginTest: mock(async () => ({ started: true, stop: stopTest })),
    visit: mock(async () => {}),
    recover: mock(async () => ({ ok: true })),
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
  const deps: any = {
    explorer,
    ai: provider,
    config: {},
    stateManager: {
      getCurrentState: () => currentState,
      clearHistory: () => {},
      onStateChange: () => () => {},
      isInDeadLoop: () => false,
      otherTabs: [],
      getExperienceTracker: () => ({
        getExperienceTableOfContents: () => [],
        renderExperienceFor: () => '',
        renderExperienceTocFor: () => '',
      }),
    },
    knowledgeTracker: {
      getRelevantKnowledge: () => [],
      renderRelevantKnowledge: () => '',
      renderRelevantContext: () => '',
    },
    requestStore: { clear: () => {}, onFailedRequest: () => () => {}, getFailedRequests: () => [] },
    playwrightRecorder: {},
  };

  const tester = new Tester(deps, researcher, navigator);
  tester.setPilot({ reset: () => {}, planTest: async () => null, finalReview } as any);
  tester.setHistorian({ saveSession } as any);
  return { tester, invokeConversation, finalReview, saveSession, stopTest };
}

describe('Tester deadline', () => {
  test('past deadline stops the loop before any AI call and still finalizes the test', async () => {
    const { tester, invokeConversation, finalReview, saveSession, stopTest } = setupTester();
    const task = new Test('check dashboard', 'normal', 'dashboard works', '/dashboard');

    const result = await tester.test(task, { deadline: Date.now() - 1 });

    expect(result.success).toBe(false);
    expect(task.result).toBe(TestResult.FAILED);
    expect(Object.values(task.notes).some((note) => note.message === 'Time budget reached. Stopped')).toBe(true);
    expect(invokeConversation).not.toHaveBeenCalled();
    expect(finalReview).not.toHaveBeenCalled();
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(stopTest).toHaveBeenCalledTimes(1);
  });

  test('past deadline does not pass a test with unmet expectations left', async () => {
    const { tester } = setupTester();
    const task = new Test('check dashboard', 'normal', ['dashboard works', 'widgets render'], '/dashboard');
    task.addNote('dashboard works', TestResult.PASSED);

    await tester.test(task, { deadline: Date.now() - 1 });

    expect(task.result).toBe(TestResult.FAILED);
    expect(Object.values(task.notes).some((note) => note.message === 'Time budget reached. Stopped')).toBe(true);
  });

  test('without a deadline the loop runs and the pilot final review happens', async () => {
    const { tester, invokeConversation, finalReview, saveSession } = setupTester();
    const task = new Test('check dashboard', 'normal', 'dashboard works', '/dashboard');

    await tester.test(task);

    expect(invokeConversation.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(finalReview).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledTimes(1);
  });
});
