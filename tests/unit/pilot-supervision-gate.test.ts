import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Decision } from '../../src/ai/judge.ts';
import { Pilot } from '../../src/ai/pilot.ts';
import { ConfigParser } from '../../src/config.ts';
import { Test } from '../../src/test-plan.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

function buildPilotWithJudge(decideSpy: ReturnType<typeof mock>) {
  const invokeConversation = mock(async () => ({ response: { text: 'NEXT: keep going' }, toolExecutions: [] }));
  const conversation: any = {
    addUserText: mock(() => {}),
    markLastMessageCacheable: mock(() => {}),
    cleanupTag: mock(() => {}),
  };
  const deps: any = {
    ai: {
      getAgenticModel: () => 'model',
      startConversation: mock(() => conversation),
      invokeConversation,
    },
    explorer: {},
    stateManager: {
      isInDeadLoop: () => false,
      getCurrentState: () => null,
      otherTabs: [],
    },
    requestStore: { getFailedRequests: () => [] },
    playwrightRecorder: {},
    judge: { decide: decideSpy },
  };
  const researcher: any = {};
  return new Pilot(deps, {}, researcher);
}

function buildState(): ActionResult {
  return new ActionResult({ url: '/page', title: 'Page', html: '<html><body><h1>Page</h1></body></html>', ariaSnapshot: '' });
}

function buildTestTask(): Test {
  return new Test('check page', 'normal', 'page works', '/page');
}

const healthy = async () => new Decision('yes', 0.9);
const unsure = async () => new Decision(null, 0.6);
const actingTester: any = { getToolExecutions: () => [{ toolName: 'click', wasSuccessful: true, output: {} }] };

describe('Pilot.analyzeProgress — judge gate', () => {
  it('skips the review silently when the judge approves the run as healthy', async () => {
    const decideSpy = mock(healthy);
    const guidance = await buildPilotWithJudge(decideSpy).analyzeProgress(buildTestTask(), buildState(), actingTester);
    expect(guidance).toBe('');
    expect(decideSpy).toHaveBeenCalledTimes(1);
  });

  it('reviews when the judge rejects', async () => {
    const guidance = await buildPilotWithJudge(mock(unsure)).analyzeProgress(buildTestTask(), buildState(), actingTester);
    expect(guidance).toBe('NEXT: keep going');
  });
});
