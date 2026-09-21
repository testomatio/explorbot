import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Tester } from '../../src/ai/tester.ts';

function buildTester(): Tester {
  const provider: any = {
    getSystemPromptForAgent: () => '',
  };
  const researcher: any = {
    research: async () => '',
    researchOverlay: async () => null,
  };
  const navigator: any = {};
  const deps: any = {
    explorer: {},
    ai: provider,
    config: {},
    stateManager: {
      getCurrentState: () => null,
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
  return new Tester(deps, researcher, navigator);
}

function buildState(): ActionResult {
  return new ActionResult({ url: '/page', title: 'Page', html: '<html><body><h1>Page</h1></body></html>', ariaSnapshot: '' });
}

describe('Tester.getReviewTrigger', () => {
  it('reports a reactive trigger on a region transition, ahead of the schedule', () => {
    const tester = buildTester();
    (tester as any).regionTransitioned = true;
    expect((tester as any).getReviewTrigger(1, buildState())).toBe('reactive');
  });

  it('reports a reactive trigger on repeated failures, ahead of the schedule', () => {
    const tester = buildTester();
    (tester as any).consecutiveFailures = 3;
    expect((tester as any).getReviewTrigger(1, buildState())).toBe('reactive');
  });

  it('reports a reactive trigger on repeated empty results, ahead of the schedule', () => {
    const tester = buildTester();
    (tester as any).consecutiveEmptyResults = 2;
    expect((tester as any).getReviewTrigger(1, buildState())).toBe('reactive');
  });

  it('reports a scheduled trigger on the interval, with no reactive signal present', () => {
    const tester = buildTester();
    const interval = (tester as any).progressCheckInterval;
    expect((tester as any).getReviewTrigger(interval, buildState())).toBe('scheduled');
  });

  it('reports no trigger off the interval', () => {
    const tester = buildTester();
    const interval = (tester as any).progressCheckInterval;
    expect((tester as any).getReviewTrigger(interval + 1, buildState())).toBeNull();
  });

  it('reports no trigger when the scheduled state was already analyzed', () => {
    const tester = buildTester();
    const interval = (tester as any).progressCheckInterval;
    const state = buildState();
    (tester as any).lastAnalyzedStateHash = state.hash;
    expect((tester as any).getReviewTrigger(interval, state)).toBeNull();
  });
});
