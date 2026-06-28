import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import type { ToolExecution } from '../../src/ai/conversation.ts';
import { Historian } from '../../src/ai/historian.ts';

function makeHistorian(writes: any[]) {
  const fakeExperienceTracker = {
    getRelevantExperience: () => [],
    writeFlow: () => {},
    writeAction: (state: ActionResult, action: any) => writes.push({ state, action }),
  } as any;
  const fakeStateManager = {
    getLastVisitToPath: () => null,
  } as any;
  const fakeRecorder = {
    exportChunk: async () => new Map(),
    drainVerifications: () => [],
  } as any;
  return new Historian({} as any, fakeExperienceTracker, undefined, fakeStateManager, undefined, {
    recorder: fakeRecorder,
    helper: undefined,
  });
}

describe('Historian experience retry learning', () => {
  it('saves successful fallback locator attempts as reusable action experience', async () => {
    const writes: any[] = [];
    const historian = makeHistorian(writes);
    const initialState = new ActionResult({
      html: '<html><body>Runs</body></html>',
      url: 'https://example.com/projects/demo/runs',
      title: 'Runs',
    });
    const exec: ToolExecution = {
      toolName: 'click',
      input: { explanation: 'Open first visible run' },
      wasSuccessful: true,
      output: {
        code: 'I.click(\'a[href*="d0820b1a"]\')',
        url: '/projects/demo/runs',
        pageDiff: {
          currentUrl: '/projects/demo/runs/d0820b1a',
        },
        attempts: [
          { command: 'I.click("Star Test Run", ".tree")', success: false, error: 'not found' },
          { command: 'I.click({"role":"link","text":"Star Test Run"}, ".tree")', success: false, error: 'not found' },
          { command: 'I.click(\'a[href*="d0820b1a"]\')', success: true },
        ],
      },
    };

    await (historian as any).detectRetryPatterns([exec], initialState);

    expect(writes).toHaveLength(1);
    expect(writes[0].state.url).toBe('/projects/demo/runs');
    expect(writes[0].action.title).toBe('Open first visible run');
    expect(writes[0].action.code).toBe('I.click(\'a[href*="d0820b1a"]\')');
    expect(writes[0].action.explanation).toContain('I.click("Star Test Run", ".tree")');
  });

  it('does not save non-reusable fallback locators', async () => {
    const writes: any[] = [];
    const historian = makeHistorian(writes);
    const initialState = new ActionResult({
      html: '<html><body>Runs</body></html>',
      url: 'https://example.com/projects/demo/runs',
      title: 'Runs',
    });
    const exec: ToolExecution = {
      toolName: 'click',
      input: { explanation: 'Open visually' },
      wasSuccessful: true,
      output: {
        code: 'I.clickXY(100, 200)',
        url: '/projects/demo/runs',
        attempts: [
          { command: 'I.click("Run")', success: false, error: 'not found' },
          { command: 'I.clickXY(100, 200)', success: true },
        ],
      },
    };

    await (historian as any).detectRetryPatterns([exec], initialState);

    expect(writes).toHaveLength(0);
  });
});
