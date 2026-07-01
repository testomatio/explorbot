import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { createAgentTools } from '../../src/ai/tools.ts';

describe('createAgentTools experience', () => {
  it('adds learnExperience when experience tracker and state reader are provided', async () => {
    const state = new ActionResult({
      url: '/page',
      title: 'Page',
      html: '<html></html>',
      ariaSnapshot: '',
    });
    const tools = createAgentTools({
      explorer: {} as any,
      researcher: {} as any,
      navigator: {} as any,
      getState: () => state,
      experienceTracker: {
        getExperienceSection: (fileTag: string, sectionIndex: number, currentState: ActionResult) => ({
          title: `section ${fileTag}.${sectionIndex}`,
          url: currentState.url,
          content: '## FLOW: use prior success',
        }),
      } as any,
    });

    expect(tools.learnExperience).toBeDefined();

    const result = await tools.learnExperience.execute({ fileTag: 'A', sectionIndex: 1 });

    expect(result).toEqual({
      title: 'section A.1',
      url: '/page',
      content: '## FLOW: use prior success',
    });
  });
});
