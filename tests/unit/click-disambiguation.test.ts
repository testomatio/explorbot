import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

function multipleElementsError(): Error {
  const element = (xpath: string, html: string) => ({
    toAbsoluteXPath: async () => xpath,
    toOuterHTML: async () => html,
    getText: async () => '',
  });
  return Object.assign(new Error('Multiple elements (2) found for "{role: switch}" in strict mode'), {
    name: 'MultipleElementsFound',
    webElements: [element('/html/body/div/button[1]', '<button role="switch" aria-checked="false"></button>'), element('/html/body/div/button[2]', '<button role="switch" aria-checked="true"></button>')],
  });
}

function fakeDeps(): any {
  const states = [
    { url: '/plans/edit/1', html: '<html><body></body></html>', ariaSnapshot: '- switch', id: 'before' },
    { url: '/plans/edit/1', html: '<html><body></body></html>', ariaSnapshot: '- switch [checked]', id: 'after' },
  ];
  let captured = 0;
  const action: any = {
    lastError: null,
    saveScreenshot: async () => undefined,
    attempt: async (command: string) => {
      if (!command.includes('elementIndex')) {
        action.lastError = multipleElementsError();
        return false;
      }
      action.lastError = null;
      captured = 1;
      return true;
    },
  };
  return {
    explorer: { action: () => action },
    stateManager: { getCurrentState: () => states[captured] },
    ai: {
      getModelForAgent: () => ({}),
      generateObject: async () => ({ object: { position: 1 } }),
    },
  };
}

function fakeTask(): any {
  return { startNote: () => ({ commit: () => {}, screenshot: undefined }) };
}

describe('click disambiguation result', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('reports the resolved click as a plain success the AI must not repeat', async () => {
    const tools = createCodeceptJSTools(fakeDeps(), fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"}, '.detail')`], explanation: 'Toggle the switch' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.disambiguated).toBe(true);
    expect(result.code).toContain('elementIndex: 1');
    expect(result.attempts).toEqual([{ command: result.code, success: true }]);
    expect(result.suggestion).toContain('do not reissue the click');
  });
});
