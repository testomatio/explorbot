import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { createAgentTools } from '../../src/ai/tools.ts';

describe('createAgentTools experience', () => {
  it('adds learnExperience by default and reads from the shared experience tracker', async () => {
    const state = new ActionResult({
      url: '/page',
      title: 'Page',
      html: '<html></html>',
      ariaSnapshot: '',
    });
    const experienceTracker = {
      getExperienceSection: (fileTag: string, sectionIndex: number, currentState: ActionResult) => ({
        title: `section ${fileTag}.${sectionIndex}`,
        url: currentState.url,
        content: '## FLOW: use prior success',
      }),
    };
    const explorer = {
      getStateManager: () => ({
        getCurrentState: () => state,
        getExperienceTracker: () => experienceTracker,
      }),
    } as any;

    const tools = createAgentTools({ explorer, researcher: {} as any, navigator: {} as any });

    expect(tools.learnExperience).toBeDefined();

    const result = await tools.learnExperience.execute({ fileTag: 'A', sectionIndex: 1 });

    expect(result).toEqual({
      title: 'section A.1',
      url: '/page',
      content: '## FLOW: use prior success',
    });
  });

  it('omits learnExperience when withExperience is false', () => {
    const tools = createAgentTools({ explorer: {} as any, researcher: {} as any, navigator: {} as any, withExperience: false });
    expect(tools.learnExperience).toBeUndefined();
  });
});
