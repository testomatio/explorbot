import { afterEach, describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { createAgentTools, isMajorPageChange, withdrawVisionTools } from '../../src/ai/tools.ts';
import { Stats } from '../../src/stats.ts';

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
    const stateManager = {
      getCurrentState: () => state,
      getExperienceTracker: () => experienceTracker,
    } as any;

    const tools = createAgentTools({ explorer: {} as any, stateManager, ai: {} as any, researcher: {} as any, navigator: {} as any });

    expect(tools.learnExperience).toBeDefined();

    const result = await tools.learnExperience.execute({ fileTag: 'A', sectionIndex: 1 });

    expect(result).toEqual({
      title: 'section A.1',
      url: '/page',
      content: '## FLOW: use prior success',
    });
  });

  it('hands the interact tool the experience its supervisor selected instead of the whole page history', async () => {
    const state = new ActionResult({ url: '/page', title: 'Page', html: '<html></html>', ariaSnapshot: '' });
    const stateManager = { getCurrentState: () => state, getExperienceTracker: () => ({}) } as any;
    let receivedExperience: string | undefined;
    const navigator = {
      resolveState: async (_instruction: string, _actionResult: ActionResult, opts?: { experience?: string }) => {
        receivedExperience = opts?.experience;
        return true;
      },
    } as any;

    const tools = createAgentTools({
      explorer: {} as any,
      stateManager,
      ai: {} as any,
      researcher: {} as any,
      navigator,
      appliedExperience: () => '<experience>selected recipe</experience>',
    });

    await tools.interact.execute({ instruction: 'open the menu' });

    expect(receivedExperience).toBe('<experience>selected recipe</experience>');
  });

  it('omits learnExperience when withExperience is false', () => {
    const tools = createAgentTools({ explorer: {} as any, stateManager: {} as any, ai: {} as any, researcher: {} as any, navigator: {} as any, withExperience: false });
    expect(tools.learnExperience).toBeUndefined();
  });
});

describe('vision tool withdrawal', () => {
  afterEach(() => {
    Stats.visionDisabled = false;
  });

  const buildTools = () => createAgentTools({ explorer: {} as any, stateManager: {} as any, ai: {} as any, researcher: {} as any, navigator: {} as any });

  it('offers vision tools while vision works', () => {
    const tools = buildTools();
    expect(tools.see).toBeDefined();
    expect(tools.visualClick).toBeDefined();
  });

  it('omits vision tools from toolsets built after vision was disabled', () => {
    Stats.visionDisabled = true;
    const tools = buildTools();
    expect(tools.see).toBeUndefined();
    expect(tools.visualClick).toBeUndefined();
  });

  it('withdraws vision tools from an already built toolset', () => {
    const tools = buildTools();
    withdrawVisionTools(tools);
    expect(tools.see).toBeDefined();

    Stats.visionDisabled = true;
    withdrawVisionTools(tools);
    expect(tools.see).toBeUndefined();
    expect(tools.visualClick).toBeUndefined();
    expect(tools.context).toBeDefined();
  });
});

describe('isMajorPageChange', () => {
  it('requires the threshold without URL navigation', () => {
    expect(isMajorPageChange({ currentUrl: '/page', urlChanged: false, ariaChangeCount: 49 })).toBe(false);
    expect(isMajorPageChange({ currentUrl: '/page', urlChanged: false, ariaChangeCount: 50 })).toBe(true);
    expect(isMajorPageChange({ currentUrl: '/next', urlChanged: true, ariaChangeCount: 50 })).toBe(false);
  });
});
