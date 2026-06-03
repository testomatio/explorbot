import { describe, expect, it } from 'bun:test';
import { Tester } from '../../src/ai/tester.ts';
import { TestResult } from '../../src/test-plan.ts';

function buildTester(captain?: any, page: any = { id: 'recovered-page' }, explorerOverrides: Record<string, any> = {}): Tester {
  const explorer: any = {
    getConfig: () => ({}),
    playwrightHelper: {
      page,
    },
    createAction: () => ({
      capturePageState: async () => ({
        url: '/',
        title: 'Recovered',
        hash: 'recovered',
        ariaSnapshot: '',
        getInteractiveARIA: () => '',
        isInsideIframe: false,
      }),
    }),
    hasOtherTabs: () => false,
    getCurrentIframeInfo: () => null,
    stopTest: async () => {},
    ...explorerOverrides,
  };
  const researcher = {
    research: async () => '',
  };
  const tester = new Tester(explorer, {} as any, researcher as any, {} as any);
  if (captain) tester.setCaptain(captain);
  return tester;
}

function buildTask() {
  const notes: string[] = [];
  return {
    hasFinished: false,
    result: null,
    addNote: (message: string) => notes.push(message),
    finish(result: any) {
      this.hasFinished = true;
      this.result = result;
    },
    get isSuccessful() {
      return this.result === TestResult.PASSED;
    },
    get isSkipped() {
      return this.result === TestResult.SKIPPED;
    },
    get hasFailed() {
      return this.result === TestResult.FAILED;
    },
    notes,
    scenario: 'startup recovery test',
  };
}

function buildConversation() {
  const messages: string[] = [];
  return {
    addUserText: (message: string) => messages.push(message),
    messages,
  };
}

describe('Tester execution recovery', () => {
  it('continues after Captain recovers the browser', async () => {
    const captain = {
      processExecutionError: async () => ({
        action: 'continue',
        recovered: true,
        message: 'Recovered browser, continue from restored page',
      }),
    };
    const recoveredPage = { id: 'recovered-page' };
    const tester = buildTester(captain, { isClosed: () => true });
    (tester as any).explorer.playwrightHelper.page = recoveredPage;
    const task = buildTask();
    const conversation = buildConversation();
    const watchedPages: any[] = [];
    let stopped = false;

    await (tester as any).handleExecutionError(
      task,
      conversation,
      new Error('Target closed'),
      () => {
        stopped = true;
      },
      (page: any) => watchedPages.push(page)
    );

    expect(stopped).toBe(false);
    expect(task.hasFinished).toBe(false);
    expect(watchedPages).toHaveLength(1);
    expect(conversation.messages[0]).toContain('Recovered browser');
    expect(conversation.messages[0]).toContain('<browser_recovery>');
  });

  it('stops the test when Captain cannot recover', async () => {
    const captain = {
      processExecutionError: async () => ({
        action: 'stop',
        recovered: false,
        message: 'Recovery failed',
      }),
    };
    const tester = buildTester(captain);
    const task = buildTask();
    const conversation = buildConversation();
    let stopped = false;

    await (tester as any).handleExecutionError(
      task,
      conversation,
      new Error('Target closed'),
      () => {
        stopped = true;
      },
      () => {}
    );

    expect(stopped).toBe(true);
    expect(task.hasFinished).toBe(true);
    expect(task.result).toBe(TestResult.FAILED);
    expect(conversation.messages).toHaveLength(0);
  });

  it('falls back to retry guidance when Captain is unavailable', async () => {
    const tester = buildTester();
    const task = buildTask();
    const conversation = buildConversation();
    let stopped = false;

    await (tester as any).handleExecutionError(
      task,
      conversation,
      new Error('Locator not found'),
      () => {
        stopped = true;
      },
      () => {}
    );

    expect(stopped).toBe(false);
    expect(conversation.messages[0]).toContain('Previous AI call failed');
  });

  it('recovers when the browser page is already closed before the next step', async () => {
    const tester = buildTester(undefined, { isClosed: () => true });
    const recoveredPage = { id: 'recovered-page' };
    const captain = {
      processExecutionError: async () => {
        (tester as any).explorer.playwrightHelper.page = recoveredPage;
        return {
          action: 'continue',
          recovered: true,
          message: 'Recovered closed page',
        };
      },
    };
    tester.setCaptain(captain as any);
    const task = buildTask();
    const conversation = buildConversation();
    const watchedPages: any[] = [];
    let stopped = false;

    const available = await (tester as any).ensureBrowserPageAvailable(
      task,
      conversation,
      () => {
        stopped = true;
      },
      (page: any) => watchedPages.push(page)
    );

    expect(available).toBe(true);
    expect(stopped).toBe(false);
    expect(watchedPages).toHaveLength(1);
    expect(conversation.messages[0]).toContain('Recovered closed page');
    expect(conversation.messages[0]).toContain('<browser_recovery>');
  });

  it('retries initial navigation after Captain recovers the browser', async () => {
    let visits = 0;
    const tester = buildTester(
      undefined,
      { isClosed: () => false },
      {
        visit: async () => {
          visits++;
          if (visits === 1) throw new Error('Cannot navigate: page has been closed');
        },
        isFatalBrowserError: () => true,
      }
    );
    const captain = {
      processExecutionError: async () => ({
        action: 'continue',
        recovered: true,
        message: 'Recovered before initial navigation',
      }),
    };
    tester.setCaptain(captain as any);
    const task = buildTask();
    task.startUrl = '/';
    const conversation = buildConversation();
    const watchedPages: any[] = [];

    const navigated = await (tester as any).visitStartUrlWithRecovery(task, conversation, (page: any) => watchedPages.push(page));

    expect(navigated).toBe(true);
    expect(visits).toBe(2);
    expect(task.hasFinished).toBe(false);
    expect(watchedPages).toHaveLength(1);
  });

  it('cleans up started test lifecycle on early startup failure', async () => {
    let stopped = false;
    const tester = buildTester(
      undefined,
      { isClosed: () => false },
      {
        stopTest: async () => {
          stopped = true;
        },
      }
    );
    const task = buildTask();
    task.startUrl = '/';

    await (tester as any).cleanupStartedTest(task);

    expect(stopped).toBe(true);
  });
});
