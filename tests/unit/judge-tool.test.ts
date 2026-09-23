import { describe, expect, it } from 'bun:test';
import { Decision } from '../../src/ai/judge.ts';
import { createJudgeTool } from '../../src/ai/judge-tool.ts';

function judgeReturning(decision: Decision, seen: any[] = []) {
  return {
    toolEnabled: true,
    consult: async (question: string, options: any, state: any) => {
      seen.push({ question, options, state });
      return decision;
    },
  };
}

describe('judge tool', () => {
  it('is absent without a judge, and when the tool toggle is off', () => {
    expect(createJudgeTool({} as any, async () => ({}))).toEqual({});
    expect(createJudgeTool({ judge: { ...judgeReturning(new Decision('yes', 0.9)), toolEnabled: false } } as any, async () => ({}))).toEqual({});
  });

  it('reports an approved decision with its answer', async () => {
    const tool = createJudgeTool({ judge: judgeReturning(new Decision('History', 0.85)) } as any, async () => ({ task: 't' }));
    const result = await tool.judge.execute({ question: 'Which tab is active?', options: ['Details', 'History'] });
    expect(result).toMatchObject({ success: true, answer: 'History' });
  });

  it('reports a rejected decision as not confirmed, never as false', async () => {
    const tool = createJudgeTool({ judge: judgeReturning(new Decision(null, 0.6)) } as any, async () => ({}));
    const result = await tool.judge.execute({ question: 'The list shows the new row.' });
    expect(result.success).toBe(false);
    expect(result.message).toContain('Not confirmed');
  });

  it('merges caller context into the assembled state', async () => {
    const seen: any[] = [];
    const tool = createJudgeTool({ judge: judgeReturning(new Decision('yes', 0.9), seen) } as any, async () => ({ task: 't' }));
    await tool.judge.execute({ question: 'x', context: 'extra detail' });
    expect(seen[0].state).toEqual({ task: 't', context: 'extra detail' });
    expect(seen[0].options).toBeNull();
  });
});
