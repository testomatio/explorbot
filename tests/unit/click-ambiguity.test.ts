import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

function multipleElementsError(visibility: boolean[] = []): Error {
  const element = (xpath: string, text: string, visible?: boolean) => {
    const webElement: Record<string, any> = {
      toAbsoluteXPath: async () => xpath,
      toOuterHTML: async () => '<button role="switch" type="button"></button>',
      getText: async () => text,
    };
    if (visible !== undefined) webElement.isVisible = async () => visible;
    return webElement;
  };
  return Object.assign(new Error('Multiple elements (2) found for "{role: switch}" in strict mode'), {
    name: 'MultipleElementsFound',
    webElements: [element('/html/body/div/button[1]', 'First control', visibility[0]), element('/html/body/div/button[2]', 'Second control', visibility[1])],
  });
}

function notFoundError(): Error {
  return Object.assign(new Error('element (.missing) was not found by text|CSS|XPath'), { name: 'ElementNotFound' });
}

function fakeDeps(errorFor: (command: string) => Error) {
  const state = { url: '/settings', html: '<html><body></body></html>', ariaSnapshot: '- switch', id: 'unchanged' };
  const action: any = {
    lastError: null,
    executedSteps: [],
    ran: [] as string[],
    saveScreenshot: async () => undefined,
    attempt: async (command: string) => {
      action.ran.push(command);
      action.lastError = errorFor(command);
      return false;
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

describe('click on an ambiguous locator', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('clicks nothing and hands the matched elements back to the model', async () => {
    const { deps, action } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);

    expect(result.success).toBe(false);
    expect(action.ran).toEqual([`I.click({"role":"switch"})`]);
    expect(result.disambiguated).toBeUndefined();
    expect(result.multipleElementsDetected).toBe(true);
    expect(result.elements).toContain('Element 1:');
    expect(result.elements).toContain('Element 2:');
    expect(result.suggestion).toContain('elementIndex');
  });

  it('names the only match on screen so the model stops guessing', async () => {
    const { deps } = fakeDeps(() => multipleElementsError([false, true]));
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);

    expect(result.elements).toContain('Visible: false');
    expect(result.suggestion).toContain('Only element 2 is on screen');
  });

  it('keeps the ambiguous match when a later fallback command failed differently', async () => {
    const { deps } = fakeDeps((command) => {
      if (command.includes('role')) return multipleElementsError();
      return notFoundError();
    });
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`, `I.click('.missing')`], explanation: 'Toggle the control' }, {} as any);

    expect(result.multipleElementsDetected).toBe(true);
    expect(result.elements).toContain('Element 2:');
  });
});
