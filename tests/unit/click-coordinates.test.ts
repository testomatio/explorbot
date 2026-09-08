import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

function fakeDeps(idAfterClick?: string) {
  const state = { url: '/runs', html: '<html><body><div>runs</div></body></html>', ariaSnapshot: '- list', id: 'before' };
  const action: any = {
    lastError: null,
    executedSteps: [],
    ran: [] as string[],
    saveScreenshot: async () => undefined,
    attempt: async (command: string) => {
      action.ran.push(command);
      action.lastError = null;
      if (idAfterClick) state.id = idAfterClick;
      return true;
    },
  };
  const deps: any = {
    explorer: { action: () => action },
    stateManager: { getCurrentState: () => state },
    ai: { getModelForAgent: () => ({}), generateObject: async () => ({ object: { position: 1 } }) },
  };
  return { deps, action };
}

function fakeTask(): any {
  return { startNote: () => ({ commit: () => {}, screenshot: undefined }) };
}

describe('click with coordinates', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('refuses a coordinate command without touching the page', async () => {
    const { deps, action } = fakeDeps();
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: ['I.clickXY(0, 0)'], explanation: 'Click Load more' }, {} as any);

    expect(result.success).toBe(false);
    expect(action.ran).toEqual([]);
    expect(result.suggestion).toContain('visualClick');
  });

  it('refuses coordinates offered as the last fallback of a locator list', async () => {
    const { deps, action } = fakeDeps();
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click('Load more')`, 'I.clickXY(0, 0)'], explanation: 'Click Load more' }, {} as any);

    expect(result.success).toBe(false);
    expect(action.ran).toEqual([]);
    expect(result.message).toContain('I.clickXY(0, 0)');
  });
});

describe('click that changes nothing', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('reports a command that left the state identical as failed', async () => {
    const { deps, action } = fakeDeps();
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click('Load more')`], explanation: 'Click Load more' }, {} as any);

    expect(action.ran).toEqual([`I.click('Load more')`]);
    expect(result.success).toBe(false);
    expect(result.message).toContain('no observable page change');
    expect(result.pageDiff).toBeNull();
  });

  it('reports a command whose diff carries no url, aria or html change as failed', async () => {
    const { deps } = fakeDeps('after');
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click('2')`], explanation: 'Click pagination link 2' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('no observable page change');
    expect(result.pageDiff.urlChanged).toBe(false);
    expect(result.pageDiff.ariaChanges).toBeUndefined();
    expect(result.pageDiff.htmlParts).toBeUndefined();
    expect(result.suggestion).toContain('xpathCheck');
  });
});

describe('click that only reaches the server', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('treats an app request as evidence the click landed', async () => {
    const state: any = { url: '/runs', html: '<html><body><div>runs</div></body></html>', ariaSnapshot: '- list', id: 'before' };
    const action: any = {
      lastError: null,
      executedSteps: [],
      saveScreenshot: async () => undefined,
      attempt: async () => {
        state.id = 'after';
        state.networkRequests = [{ method: 'POST', path: '/api/runs', status: 200 }];
        return true;
      },
    };
    const deps: any = {
      explorer: { action: () => action },
      stateManager: { getCurrentState: () => ({ ...state }) },
      ai: { getModelForAgent: () => ({}), generateObject: async () => ({ object: { position: 1 } }) },
    };
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click('Save')`], explanation: 'Save the run' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.pageDiff.requests).toHaveLength(1);
  });
});
