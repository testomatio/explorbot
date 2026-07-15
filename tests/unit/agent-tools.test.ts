import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { createAgentTools, createCodeceptJSTools } from '../../src/ai/tools.ts';

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

describe('createCodeceptJSTools page change suggestions', () => {
  it('reports major page changes only when the URL stays the same', async () => {
    for (const urlChanged of [false, true]) {
      const previous = {
        url: '/detail',
        html: '<main></main>',
        ariaSnapshot: Array.from({ length: 60 }, (_, index) => `- button "Old ${index}"`).join('\n'),
      };
      const current = {
        url: urlChanged ? '/list' : '/detail',
        html: '<main></main>',
        ariaSnapshot: Array.from({ length: 60 }, (_, index) => `- button "New ${index}"`).join('\n'),
      };
      let state = previous;
      const tools = createCodeceptJSTools(
        {
          getStateManager: () => ({ getCurrentState: () => state }),
          createAction: () => ({
            attempt: async () => {
              state = current;
              return true;
            },
            saveScreenshot: async () => undefined,
          }),
        } as any,
        {
          startNote: () => ({ commit: () => undefined }),
        } as any
      );

      const result = await tools.click.execute({ commands: ['I.click("Continue")'], explanation: 'Continue' });

      expect(result.pageDiff.ariaChangeCount).toBe(120);
      expect(result.suggestion.includes('MAJOR PAGE CHANGE')).toBe(!urlChanged);
    }
  });
});
