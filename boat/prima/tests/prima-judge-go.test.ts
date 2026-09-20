import { describe, expect, it } from 'bun:test';
import { judgeNavigationRef } from '../src/prima.ts';

const snapshot = '- link "Plans" [ref=e4]\n- link "Suites" [ref=e7]\n- button "New" [ref=e9]';

describe('judgeNavigationRef', () => {
  it('returns the ref when confident', async () => {
    const judge = { directEnabled: true, ask: async () => ({ target: { answer: 'e7', confidence: 0.9, probabilities: {} } }) };
    expect(await judgeNavigationRef(judge as any, 'the suites page', snapshot)).toBe('e7');
  });

  it('returns null when uncertain', async () => {
    const judge = { directEnabled: true, ask: async () => ({ target: { answer: 'e7', confidence: 0.3, probabilities: {} } }) };
    expect(await judgeNavigationRef(judge as any, 'the suites page', snapshot)).toBeNull();
  });

  it('returns null when nothing on the page leads there', async () => {
    const judge = { directEnabled: true, ask: async () => ({ target: { answer: 'none', confidence: 0.95, probabilities: {} } }) };
    expect(await judgeNavigationRef(judge as any, 'the billing page', snapshot)).toBeNull();
  });

  it('returns null without a judge or with no refs', async () => {
    expect(await judgeNavigationRef(undefined, 't', snapshot)).toBeNull();
    expect(await judgeNavigationRef({ directEnabled: true, ask: async () => null } as any, 't', 'no refs here')).toBeNull();
  });

  it('parses a genuine ariaRefSnapshot (mode: "ai") capture, not the shape assumed in the brief', async () => {
    const genuine = [
      '- generic [active] [ref=f1e1]:',
      '  - navigation [ref=f1e2]:',
      '    - link "Plans" [ref=f1e3] [cursor=pointer]:',
      '      - /url: /plans',
      '    - link "Suites" [ref=f1e4] [cursor=pointer]:',
      '      - /url: /suites',
      '  - button "New" [disabled] [ref=f1e5]',
      '  - checkbox [checked] [ref=f1e6]',
    ].join('\n');

    let seenOptions: Record<string, string> = {};
    const judge = {
      directEnabled: true,
      ask: async (_state: unknown, questions: Record<string, { options?: Record<string, string> }>) => {
        seenOptions = questions.target.options || {};
        return { target: { answer: 'f1e4', confidence: 0.9, probabilities: {} } };
      },
    };

    const ref = await judgeNavigationRef(judge as any, 'the suites page', genuine);

    expect(ref).toBe('f1e4');
    expect(seenOptions).toHaveProperty('f1e3');
    expect(seenOptions).toHaveProperty('f1e4');
    expect(seenOptions).toHaveProperty('f1e5');
    expect(seenOptions).not.toHaveProperty('f1e1');
    expect(seenOptions).not.toHaveProperty('f1e2');
    expect(seenOptions).not.toHaveProperty('f1e6');
  });
});
