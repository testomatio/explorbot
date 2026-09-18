import { describe, expect, it } from 'bun:test';
import { createJudgeTool } from '../../src/ai/judge-tool.ts';

const stubJudge = (answer: any, capture?: (state: any, questions: any) => void) => ({
  toolEnabled: true,
  directEnabled: true,
  ask: async (state: any, questions: any) => {
    capture?.(state, questions);
    return answer;
  },
});

describe('judge tool', () => {
  it('is absent without a judge', () => {
    expect(createJudgeTool({} as any, async () => ({}))).toEqual({});
  });

  it('is absent when the tool toggle is off', () => {
    const deps = { judge: { ...stubJudge(null), toolEnabled: false } } as any;
    expect(createJudgeTool(deps, async () => ({}))).toEqual({});
  });

  it('returns answer, confidence and probabilities', async () => {
    const deps = { judge: stubJudge({ q: { answer: 'yes', confidence: 0.91, probabilities: { yes: 0.95, no: 0.05 } } }) } as any;
    const tool = createJudgeTool(deps, async () => ({ task: 't', page: 'p', recentActions: [] }));
    const result = await tool.judge.execute({ question: 'The list shows the new row.' });
    expect(result).toMatchObject({ success: true, answer: 'yes', confidence: 0.91 });
  });

  it('merges caller context into the assembled state', async () => {
    let seen: any = null;
    const deps = { judge: stubJudge({ q: { answer: 'a', confidence: 0.5, probabilities: {} } }, (state) => (seen = state)) } as any;
    const tool = createJudgeTool(deps, async () => ({ task: 't', page: 'p', recentActions: [] }));
    await tool.judge.execute({ question: 'Which?', options: { a: 'First', b: 'Second' }, context: 'extra detail' });
    expect(seen.task).toBe('t');
    expect(seen.context).toBe('extra detail');
  });

  it('reports a failure the caller can act on when judge declines', async () => {
    const deps = { judge: stubJudge(null) } as any;
    const tool = createJudgeTool(deps, async () => ({}));
    const result = await tool.judge.execute({ question: 'x' });
    expect(result.success).toBe(false);
  });
});
