import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

const PAGE = '<html><body><main><h1>Plan</h1><button disabled>Launch</button></main></body></html>';
const PAGE_WITH_TOOLTIP = '<html><body><main><h1>Plan</h1><button disabled>Launch</button></main><div role="tooltip"><p>Configure CI in project settings to launch</p></div></body></html>';

function disabledError(): Error {
  return new Error('TimeoutError: locator.click: Timeout 3000ms exceeded.\n  - element is not enabled');
}

function fakeDeps(onHover: (state: any) => void) {
  let state: any = { url: '/plans/1', html: PAGE, ariaSnapshot: '- button "Launch" [disabled]', id: 1 };
  const action: any = {
    lastError: null,
    executedSteps: [],
    ran: [] as string[],
    saveScreenshot: async () => undefined,
    attempt: async (command: string) => {
      action.ran.push(command);
      if (command.startsWith('I.moveCursorTo')) {
        action.lastError = null;
        state = { ...state, id: 2 };
        onHover(state);
        return true;
      }
      action.lastError = disabledError();
      return false;
    },
  };
  const deps: any = {
    explorer: { action: () => action },
    stateManager: { getCurrentState: () => state },
    ai: { getModelForAgent: () => ({}) },
  };
  return { deps, action };
}

function fakeTask(): any {
  return { startNote: () => ({ commit: () => {}, screenshot: undefined }) };
}

describe('click on a disabled element', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('hovers it and reports the text the app showed', async () => {
    const { deps, action } = fakeDeps((state) => {
      state.html = PAGE_WITH_TOOLTIP;
    });
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"button","text":"Launch"})`], explanation: 'Launch the plan' }, {} as any);

    expect(result.success).toBe(false);
    expect(action.ran).toEqual([`I.click({"role":"button","text":"Launch"})`, `I.moveCursorTo({"role":"button","text":"Launch"})`]);
    expect(result.disabledReason.join(' ')).toContain('Configure CI in project settings');
    expect(result.suggestion).toContain('Hovering it showed');
  });

  it('adds no reason when hovering reveals nothing', async () => {
    const { deps } = fakeDeps(() => {});
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click("Launch", ".detail")`], explanation: 'Launch the plan' }, {} as any);

    expect(result.disabledReason).toBeUndefined();
    expect(result.suggestion).toContain('precondition');
  });
});
