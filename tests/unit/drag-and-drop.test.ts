import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools, dragPoints } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

const ANALYSIS = 'The first card and the Done column are visible. grab 10X, 20Y; drop 30X, 40Y';

function fakeDeps() {
  const holder: { state: any } = {
    state: { url: '/board', html: '<html><body></body></html>', ariaSnapshot: '- listitem "First"', id: 'before' },
  };
  const action: any = {
    lastError: null,
    executedSteps: [] as Array<{ command: string; success: boolean }>,
    ran: [] as string[],
    saveScreenshot: async () => undefined,
    attempt: async (command: string) => {
      action.ran.push(command);
      return false;
    },
  };
  const researcher: any = {
    checkDragPoints: async () => ANALYSIS,
  };
  const deps: any = {
    explorer: { action: () => action, capture: async () => ({ screenshot: Buffer.from('png') }) },
    stateManager: { getCurrentState: () => holder.state },
    ai: {},
    researcher,
  };
  return { deps, action, holder, researcher };
}

function fakeTask(): any {
  return { startNote: () => ({ commit: () => {}, screenshot: undefined }) };
}

function succeedWithReorder(action: any, holder: { state: any }) {
  action.attempt = async (command: string) => {
    action.ran.push(command);
    action.lastError = null;
    action.executedSteps = command.split('\n').map((line) => ({ command: line, success: true }));
    holder.state = { ...holder.state, ariaSnapshot: '- listitem "Second"\n- listitem "First"', id: 'after' };
    return true;
  };
}

describe('dragPoints parsing', () => {
  it('reads both points from the vision analysis', () => {
    expect(dragPoints('grab 10X, 20Y; drop 30X, 40Y')).toEqual({
      from: { x: 10, y: 20 },
      to: { x: 30, y: 40 },
    });
  });

  it('reads the points from a sentence', () => {
    expect(dragPoints('The card is in the first column. grab 5X, 6Y; drop 7X, 8Y')).toEqual({
      from: { x: 5, y: 6 },
      to: { x: 7, y: 8 },
    });
  });

  it('returns null when a point is missing', () => {
    expect(dragPoints('The drop target was not found')).toBeNull();
    expect(dragPoints('grab 10X, 20Y')).toBeNull();
  });
});

describe('dragAndDrop tool', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('drags between the located points with a real mouse and records replayable code', async () => {
    const { deps, action, holder } = fakeDeps();
    succeedWithReorder(action, holder);
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ from: 'first card', to: 'Done column', explanation: 'move the card' }, {} as any);

    expect(result.success).toBe(true);
    expect(action.ran).toHaveLength(1);
    expect(action.ran[0]).toContain('I.usePlaywrightTo');
    expect(action.ran[0]).toContain('page.mouse.move(10, 20)');
    expect(action.ran[0]).toContain('page.mouse.move(30, 40, { steps: 10 })');
    expect(result.code).toBe(action.ran[0]);
    expect(result.points).toEqual({ from: { x: 10, y: 20 }, to: { x: 30, y: 40 } });
  });

  it('wraps the drag between pressKeyDown and pressKeyUp for a modifier', async () => {
    const { deps, action, holder } = fakeDeps();
    succeedWithReorder(action, holder);
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ from: 'first card', to: 'Done column', modifier: 'Control', explanation: 'copy the card' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.code).toBe(action.ran[0]);
    expect(result.code.startsWith('I.pressKeyDown("Control")\n')).toBe(true);
    expect(result.code.endsWith('I.pressKeyUp("Control")')).toBe(true);
  });

  it('fails without browser action when vision cannot locate both points', async () => {
    const { deps, action } = fakeDeps();
    deps.researcher.checkDragPoints = async () => 'The drop target was not found';
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ from: 'first card', to: 'Done column', explanation: 'move the card' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Drag points not found');
    expect(action.ran).toEqual([]);
  });

  it('escalates a silent mouse drag to HTML5 drag events', async () => {
    const { deps, action, holder } = fakeDeps();
    action.attempt = async (command: string) => {
      action.ran.push(command);
      action.lastError = null;
      action.executedSteps = command.split('\n').map((line) => ({ command: line, success: true }));
      return true;
    };
    let syntheticDone = false;
    deps.explorer = {
      action: () => action,
      capture: async () => {
        if (syntheticDone) holder.state = { ...holder.state, ariaSnapshot: '- moved', id: 'after' };
        return { screenshot: Buffer.from('png') };
      },
      withPage: async () => {
        syntheticDone = true;
        return true;
      },
    };
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ from: 'first card', to: 'Done column', explanation: 'move the card' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.message).toContain('HTML5 drag events');
    expect(result.attempts.map((attempt: any) => attempt.success)).toEqual([true, true]);
    expect(result.attempts[1]?.command).toContain('HTML5 drag events');
  });

  it('releases the modifier and fails when no mechanism changes the page', async () => {
    const { deps, action } = fakeDeps();
    action.attempt = async (command: string) => {
      action.ran.push(command);
      return command.startsWith('I.pressKeyUp');
    };
    deps.explorer.withPage = async () => false;
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ from: 'first card', to: 'Done column', modifier: 'Control', explanation: 'copy the card' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('changed nothing');
    expect(action.ran[action.ran.length - 1]).toBe('I.pressKeyUp("Control")');
  });

  it('reports drag as unavailable when there is no researcher', async () => {
    const { deps, action } = fakeDeps();
    const tools = createCodeceptJSTools({ ...deps, researcher: undefined }, fakeTask());

    const result = await tools.dragAndDrop.execute({ from: 'first card', to: 'Done column', explanation: 'move the card' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('cannot be located');
    expect(action.ran).toEqual([]);
  });
});
