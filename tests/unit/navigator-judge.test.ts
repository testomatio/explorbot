import { describe, expect, it } from 'bun:test';

describe('navigator judge questions', () => {
  it('treats a confident match as already verified', async () => {
    const judge = {
      directEnabled: true,
      ask: async () => ({ same: { answer: 'c1', confidence: 0.88, probabilities: { c1: 0.88, none: 0.12 } } }),
    };
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(judge as any, 'the row is listed', { 'The new row appears in the list': true })).toBe('The new row appears in the list');
  });

  it('returns null when uncertain', async () => {
    const judge = { directEnabled: true, ask: async () => ({ same: { answer: 'c1', confidence: 0.3, probabilities: {} } }) };
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(judge as any, 'x', { y: true })).toBeNull();
  });

  it('returns null with no judge and with no prior claims', async () => {
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(undefined, 'x', { y: true })).toBeNull();
    expect(await judgeAlreadyVerified({ directEnabled: true, ask: async () => null } as any, 'x', {})).toBeNull();
  });
});
