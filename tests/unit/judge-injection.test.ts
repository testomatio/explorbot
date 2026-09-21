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
      Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
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
