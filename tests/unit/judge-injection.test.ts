import { describe, expect, it } from 'bun:test';
import { Judge } from '../../src/ai/judge.ts';
import { resolveDecisionModel } from '../../src/config.ts';

describe('judge injection', () => {
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
