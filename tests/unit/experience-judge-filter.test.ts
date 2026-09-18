import { describe, expect, it } from 'bun:test';
import { TaskAgent, filterExperienceBlocks } from '../../src/ai/task-agent.ts';

describe('filterExperienceBlocks', () => {
  it('keeps everything without a judge', async () => {
    expect(await filterExperienceBlocks(undefined, ['a', 'b'], 'page')).toEqual(['a', 'b']);
  });

  it('drops only blocks judged irrelevant with confidence', async () => {
    const judge = {
      directEnabled: true,
      ask: async () => ({
        b0: { answer: 'yes', confidence: 0.9, probabilities: {} },
        b1: { answer: 'no', confidence: 0.9, probabilities: {} },
        b2: { answer: 'no', confidence: 0.4, probabilities: {} },
      }),
    };
    expect(await filterExperienceBlocks(judge as any, ['a', 'b', 'c'], 'page')).toEqual(['a', 'c']);
  });

  it('keeps everything when judge declines', async () => {
    const judge = { directEnabled: true, ask: async () => null };
    expect(await filterExperienceBlocks(judge as any, ['a', 'b'], 'page')).toEqual(['a', 'b']);
  });
});

describe('TaskAgent.getExperience', () => {
  it('drops a structurally matched file when the judge says it does not apply', async () => {
    const toc = [
      { fileTag: 'A', fileHash: 'h1', url: '/login', sections: [{ index: 1, level: 2 as const, title: 'HOW to sign in' }] },
      { fileTag: 'B', fileHash: 'h2', url: '/checkout', sections: [{ index: 1, level: 2 as const, title: 'HOW to pay' }] },
    ];
    const taskAgent = Object.create(TaskAgent.prototype) as any;
    taskAgent.judge = {
      directEnabled: true,
      ask: async () => ({
        b0: { answer: 'yes', confidence: 0.9, probabilities: {} },
        b1: { answer: 'no', confidence: 0.9, probabilities: {} },
      }),
    };
    taskAgent.stateManager = { getExperienceTracker: () => ({ getExperienceTableOfContents: () => toc }) };
    const actionResult = { getCompactARIA: () => 'aria snapshot' } as any;

    const rendered = await taskAgent.getExperience(actionResult);

    expect(rendered).toContain('/login');
    expect(rendered).not.toContain('/checkout');
  });
});
