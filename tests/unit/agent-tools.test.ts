import { afterEach, describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { createAgentTools, isMajorPageChange, withdrawVisionTools } from '../../src/ai/tools.ts';
import { Stats } from '../../src/stats.ts';
import { Test } from '../../src/test-plan.ts';

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

  it('hands the interact tool the recipes selected for the running test, not every recipe on the page', async () => {
    const state = new ActionResult({ url: '/page', title: 'Page', html: '<html></html>', ariaSnapshot: '' });
    const stateManager = { getCurrentState: () => state, getExperienceTracker: () => ({}) } as any;
    let receivedExperience: string | undefined;
    const navigator = {
      resolveState: async (_instruction: string, _actionResult: ActionResult, opts?: { experience?: string }) => {
        receivedExperience = opts?.experience;
        return true;
      },
    } as any;
    const test = new Test('open the menu', 'normal', 'menu opens', '/page');
    test.applyExperience([{ url: '/page', content: '## FLOW: open the menu' }]);
    const explorer = { activeTest: test } as any;

    const tools = createAgentTools({ explorer, stateManager, ai: {} as any, researcher: {} as any, navigator });

    await tools.interact.execute({ instruction: 'open the menu' });

    expect(receivedExperience).toContain('## FLOW: open the menu');
  });

  it('withholds recipes the test picked up on another page', async () => {
    const state = new ActionResult({ url: '/page', title: 'Page', html: '<html></html>', ariaSnapshot: '' });
    const stateManager = { getCurrentState: () => state, getExperienceTracker: () => ({}) } as any;
    let receivedExperience: string | undefined;
    const navigator = {
      resolveState: async (_instruction: string, _actionResult: ActionResult, opts?: { experience?: string }) => {
        receivedExperience = opts?.experience;
        return true;
      },
    } as any;
    const test = new Test('open the menu', 'normal', 'menu opens', '/page');
    test.applyExperience([
      { url: '/other', content: '## FLOW: submit the other form' },
      { url: '/page', content: '## FLOW: open the menu' },
    ]);

    const tools = createAgentTools({ explorer: { activeTest: test } as any, stateManager, ai: {} as any, researcher: {} as any, navigator });

    await tools.interact.execute({ instruction: 'open the menu' });

    expect(receivedExperience).toContain('## FLOW: open the menu');
    expect(receivedExperience).not.toContain('submit the other form');
  });

  it('hands the interact tool nothing when no test is running', async () => {
    const state = new ActionResult({ url: '/page', title: 'Page', html: '<html></html>', ariaSnapshot: '' });
    const stateManager = { getCurrentState: () => state, getExperienceTracker: () => ({}) } as any;
    let receivedExperience: string | undefined;
    const navigator = {
      resolveState: async (_instruction: string, _actionResult: ActionResult, opts?: { experience?: string }) => {
        receivedExperience = opts?.experience;
        return true;
      },
    } as any;

    const tools = createAgentTools({ explorer: { activeTest: null } as any, stateManager, ai: {} as any, researcher: {} as any, navigator });

    await tools.interact.execute({ instruction: 'open the menu' });

    expect(receivedExperience).toBe('');
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
