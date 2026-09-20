import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Pilot, shouldSkipReview } from '../../src/ai/pilot.ts';
import { ConfigParser } from '../../src/config.ts';
import { Test } from '../../src/test-plan.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

const base = { task: 't', page: 'p', recentActions: ['click - ok'], deadLoop: false, allFailed: false, ariaUnchanged: false, skippedLast: false };
const judgeReturning = (needed: any, progressing: any) => ({
  directEnabled: true,
  ask: async () => ({ pilot_needed: needed, progressing: progressing }),
});

describe('shouldSkipReview', () => {
  it('skips a healthy round', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.85, probabilities: {} }, { answer: 'yes', confidence: 0.9, probabilities: {} });
    expect(await shouldSkipReview(judge as any, base)).toBe(true);
  });

  it('reviews when progress is unclear even if supervision seems unneeded', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.8, probabilities: {} }, { answer: 'yes', confidence: 0.4, probabilities: {} });
    expect(await shouldSkipReview(judge as any, base)).toBe(false);
  });

  it('reviews when supervision is wanted', async () => {
    const judge = judgeReturning({ answer: 'yes', confidence: 0.9, probabilities: {} }, { answer: 'no', confidence: 0.9, probabilities: {} });
    expect(await shouldSkipReview(judge as any, base)).toBe(false);
  });

  it('never skips on a deterministic veto', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.99, probabilities: {} }, { answer: 'yes', confidence: 0.99, probabilities: {} });
    expect(await shouldSkipReview(judge as any, { ...base, deadLoop: true })).toBe(false);
    expect(await shouldSkipReview(judge as any, { ...base, allFailed: true })).toBe(false);
    expect(await shouldSkipReview(judge as any, { ...base, ariaUnchanged: true })).toBe(false);
  });

  it('never skips twice in a row', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.99, probabilities: {} }, { answer: 'yes', confidence: 0.99, probabilities: {} });
    expect(await shouldSkipReview(judge as any, { ...base, skippedLast: true })).toBe(false);
  });

  it('never skips without a judge or when judge declines', async () => {
    expect(await shouldSkipReview(undefined, base)).toBe(false);
    expect(await shouldSkipReview({ directEnabled: true, ask: async () => null } as any, base)).toBe(false);
  });
});

function buildPilotWithJudge(askSpy: ReturnType<typeof mock>) {
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
    judge: { directEnabled: true, ask: askSpy },
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

const healthyAnswers = async () => ({ pilot_needed: { answer: 'no', confidence: 0.9, probabilities: {} }, progressing: { answer: 'yes', confidence: 0.9, probabilities: {} } });

describe('Pilot.analyzeProgress — scheduled gating', () => {
  it('always reviews on a reactive trigger, even when the judge reads the run as healthy', async () => {
    const askSpy = mock(healthyAnswers);
    const pilot = buildPilotWithJudge(askSpy);
    const testerConversation: any = { getToolExecutions: () => [] };

    const guidance = await pilot.analyzeProgress(buildTestTask(), buildState(), testerConversation, false);

    expect(guidance).toBe('NEXT: keep going');
    expect(askSpy).not.toHaveBeenCalled();
  });

  it('consults the judge and can skip on the scheduled trigger', async () => {
    const askSpy = mock(healthyAnswers);
    const pilot = buildPilotWithJudge(askSpy);
    const testerConversation: any = { getToolExecutions: () => [{ toolName: 'click', wasSuccessful: true, output: { pageDiff: { ariaChanges: 'added button' } } }] };

    const guidance = await pilot.analyzeProgress(buildTestTask(), buildState(), testerConversation, true);

    expect(guidance).toBeNull();
    expect(askSpy).toHaveBeenCalledTimes(1);
  });
});
