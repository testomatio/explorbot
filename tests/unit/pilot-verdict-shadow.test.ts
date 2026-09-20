import { describe, expect, it, spyOn } from 'bun:test';
import { judgePresumedState, recordJudgeShadow } from '../../src/ai/pilot.ts';

describe('judgePresumedState', () => {
  it('returns the answer and confidence for the trace', async () => {
    const judge = { directEnabled: true, ask: async () => ({ held: { answer: 'no', confidence: 0.62, probabilities: {} } }) };
    expect(await judgePresumedState(judge as any, 'scenario', 'page', ['note'])).toEqual({ answer: 'no', confidence: 0.62 });
  });

  it('returns null without a judge', async () => {
    expect(await judgePresumedState(undefined, 's', 'p', [])).toBeNull();
  });
});

describe('recordJudgeShadow', () => {
  it('emits the observation on a structural failure path, not just a decided verdict', async () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    await recordJudgeShadow({ answer: 'no', confidence: 0.62 }, 'fail');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Judge shadow: presumed-state=no (0.62) verdict=fail'));
    consoleSpy.mockRestore();
  });

  it('does nothing without a presumed state', async () => {
    const consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    await recordJudgeShadow(null, 'fail');

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
