import { describe, expect, it } from 'bun:test';
import { Judge } from '../../src/ai/judge.ts';
import { Navigator } from '../../src/ai/navigator.ts';
import { Pilot } from '../../src/ai/pilot.ts';

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
