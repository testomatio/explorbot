import { describe, expect, it } from 'bun:test';
import { shouldSkipReview } from '../../src/ai/pilot.ts';

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
