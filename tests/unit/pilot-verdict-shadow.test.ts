import { describe, expect, it } from 'bun:test';
import { judgePresumedState } from '../../src/ai/pilot.ts';

describe('judgePresumedState', () => {
  it('returns the answer and confidence for the trace', async () => {
    const judge = { directEnabled: true, ask: async () => ({ held: { answer: 'no', confidence: 0.62, probabilities: {} } }) };
    expect(await judgePresumedState(judge as any, 'scenario', 'page', ['note'])).toEqual({ answer: 'no', confidence: 0.62 });
  });

  it('returns null without a judge', async () => {
    expect(await judgePresumedState(undefined, 's', 'p', [])).toBeNull();
  });
});
