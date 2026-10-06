import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';
import { codeceptJSSandbox } from '../../src/utils/web-sandbox.ts';

function fakeDeps() {
  const holder: { state: any } = {
    state: { url: '/board', html: '<html><body></body></html>', ariaSnapshot: '- listitem "First"', id: 'before' },
  };
  const action: any = {
    lastError: null,
    executedSteps: [] as Array<{ command: string; success: boolean }>,
    ran: [] as string[],
    saveScreenshot: async () => undefined,
    attempt: async (_command: string) => false,
  };
  const deps: any = {
    explorer: { action: () => action },
    stateManager: { getCurrentState: () => holder.state },
    ai: {},
  };
  return { deps, action, holder };
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

describe('dragAndDrop validation', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('rejects empty commands without touching the browser', async () => {
    const { deps, action } = fakeDeps();
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ commands: [], explanation: 'nothing' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No commands provided');
    expect(action.ran).toEqual([]);
  });

  it('rejects non-dragAndDrop commands as invalid', async () => {
    const { deps, action } = fakeDeps();
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ commands: ['I.click("Save")', 'I.dragAndDrop("A", "B")'], explanation: 'drag' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid commands');
    expect(result.message).toContain('I.click("Save")');
    expect(action.ran).toEqual([]);
  });
});

describe('dragAndDrop modifier', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  const block = 'I.pressKeyDown("Control")\nI.dragAndDrop("First", "Second")\nI.pressKeyUp("Control")';

  it('wraps the drag between pressKeyDown and pressKeyUp and reports the block as code', async () => {
    const { deps, action, holder } = fakeDeps();
    succeedWithReorder(action, holder);
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ commands: ['I.dragAndDrop("First", "Second")'], modifier: 'Control', explanation: 'copy the item' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.code).toBe(block);
    expect(result.attempts).toEqual([{ command: block, success: true }]);
    expect(action.ran).toEqual([block]);
  });

  it('releases the modifier after a failed drag attempt', async () => {
    const { deps, action } = fakeDeps();
    action.attempt = async (command: string) => {
      action.ran.push(command);
      action.lastError = null;
      return command === 'I.pressKeyUp("Control")';
    };
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ commands: ['I.dragAndDrop("First", "Second")'], modifier: 'Control', explanation: 'copy the item' }, {} as any);

    expect(result.success).toBe(false);
    expect(action.ran).toEqual([block, 'I.pressKeyUp("Control")']);
  });

  it('executes the block in order through the CodeceptJS sandbox', () => {
    const calls: string[] = [];
    const actor: any = new Proxy(
      {},
      {
        get:
          (_t, prop) =>
          (...args: any[]) =>
            calls.push(`${String(prop)}:${JSON.stringify(args[0])}`),
      }
    );

    codeceptJSSandbox(actor, block);

    expect(calls).toEqual(['pressKeyDown:"Control"', 'dragAndDrop:"First"', 'pressKeyUp:"Control"']);
  });
});

describe('dragAndDrop fallbacks', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('escalates a silent no-op to the native HTML5 drag and reports it as code', async () => {
    const { deps, action, holder } = fakeDeps();
    action.attempt = async (command: string) => {
      action.ran.push(command);
      action.lastError = null;
      action.executedSteps = command.split('\n').map((line) => ({ command: line, success: true }));
      if (command.includes('force')) holder.state = { ...holder.state, ariaSnapshot: '- moved', id: 'after' };
      return true;
    };
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ commands: ['I.dragAndDrop("First", "Second")'], explanation: 'reorder' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.code).toBe('I.dragAndDrop("First", "Second", { force: true })');
    expect(result.attempts).toEqual([
      { command: 'I.dragAndDrop("First", "Second")', success: true },
      { command: 'I.dragAndDrop("First", "Second", { force: true })', success: true },
    ]);
  });

  it('tries the next locator when a drag command fails', async () => {
    const { deps, action, holder } = fakeDeps();
    action.attempt = async (command: string) => {
      action.ran.push(command);
      if (command.includes('.card')) {
        action.lastError = Object.assign(new Error('element (.card) was not found by text|CSS|XPath'), { name: 'ElementNotFound' });
        return false;
      }
      action.lastError = null;
      action.executedSteps = command.split('\n').map((line) => ({ command: line, success: true }));
      holder.state = { ...holder.state, ariaSnapshot: '- moved', id: 'after' };
      return true;
    };
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ commands: ['I.dragAndDrop(".card", ".column")', 'I.dragAndDrop("First", "Second")'], explanation: 'reorder' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.code).toBe('I.dragAndDrop("First", "Second")');
    expect(result.notExecuted).toBeUndefined();
  });

  it('falls back to synthetic drag events when both drag mechanisms change nothing', async () => {
    const { deps, action, holder } = fakeDeps();
    action.attempt = async (command: string) => {
      action.ran.push(command);
      action.lastError = null;
      action.executedSteps = command.split('\n').map((line) => ({ command: line, success: true }));
      return true;
    };
    deps.explorer = {
      action: () => action,
      withPage: async () => {
        holder.state = { ...holder.state, ariaSnapshot: '- moved', id: 'after' };
        return true;
      },
    };
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.dragAndDrop.execute({ commands: ['I.dragAndDrop("text=Item 2", "text=Item 1")'], explanation: 'reorder' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.attempts.map((attempt) => attempt.success)).toEqual([true, true, true]);
    expect(result.attempts[2]?.command).toContain('synthetic drag events');
    expect(result.message).toContain('synthetic drag events');
    expect(result.code).toBe('I.dragAndDrop("text=Item 2", "text=Item 1")');
  });
});
