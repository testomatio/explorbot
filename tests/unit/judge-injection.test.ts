import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Judge } from '../../src/ai/judge.ts';
import { Navigator } from '../../src/ai/navigator.ts';
import { Pilot } from '../../src/ai/pilot.ts';
import { type DecisionModelSettings, resolveDecisionModel } from '../../src/config.ts';

describe('judge injection', () => {
  let savedOpenRouterKey: string | undefined;

  beforeEach(() => {
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (savedOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
      return;
    }
    process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
  });

  it('builds no judge when decisionModel is unset', () => {
    expect(resolveDecisionModel({ model: {} } as any)).toBeNull();
  });

  it('builds a judge from resolved settings', () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const settings = resolveDecisionModel({ model: {}, decisionModel: 'typesafe/jev-1.13' } as any);
    expect(settings).not.toBeNull();
    const judge = new Judge(settings!);
    expect(judge.toolEnabled).toBe(true);
    expect(judge.directEnabled).toBe(true);
  });
});

describe('judge() caching sentinel', () => {
  let savedOpenRouterKey: string | undefined;

  beforeEach(() => {
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (savedOpenRouterKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
      return;
    }
    process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
  });

  function createCachingAccessor(resolve: () => DecisionModelSettings | null) {
    let judgeInstance: Judge | null | undefined;
    let resolveCalls = 0;
    return {
      resolveCalls: () => resolveCalls,
      judge(): Judge | null {
        if (judgeInstance !== undefined) return judgeInstance;
        resolveCalls++;
        const settings = resolve();
        judgeInstance = null;
        if (settings) judgeInstance = new Judge(settings);
        return judgeInstance;
      },
    };
  }

  it('resolves config at most once when there is no decision model', () => {
    const accessor = createCachingAccessor(() => resolveDecisionModel({ model: {} } as any));
    expect(accessor.judge()).toBeNull();
    expect(accessor.judge()).toBeNull();
    expect(accessor.resolveCalls()).toBe(1);
  });

  it('resolves config at most once when a judge is built, and caches the same instance', () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const accessor = createCachingAccessor(() => resolveDecisionModel({ model: {}, decisionModel: 'typesafe/jev-1.13' } as any));
    const first = accessor.judge();
    const second = accessor.judge();
    expect(first).toBeInstanceOf(Judge);
    expect(first).toBe(second);
    expect(accessor.resolveCalls()).toBe(1);
  });
});

describe('agent judge assignment', () => {
  it('Navigator receives the injected judge', () => {
    const fakeJudge = {} as Judge;
    const deps: any = {
      ai: {},
      explorer: {},
      config: {},
      stateManager: { getExperienceTracker: () => ({}) },
      knowledgeTracker: {},
      judge: fakeJudge,
    };
    const navigator = new Navigator(deps);
    expect((navigator as any).judge).toBe(fakeJudge);
  });

  it('Pilot receives the injected judge', () => {
    const fakeJudge = {} as Judge;
    const deps: any = {
      ai: {},
      explorer: {},
      stateManager: {},
      requestStore: {},
      playwrightRecorder: {},
      judge: fakeJudge,
    };
    const pilot = new Pilot(deps, {}, {} as any);
    expect((pilot as any).judge).toBe(fakeJudge);
  });
});
