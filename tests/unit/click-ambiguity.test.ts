import { beforeEach, describe, expect, it } from 'bun:test';
import { createCodeceptJSTools, failedToolResult, resolveAmbiguousElement } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

function multipleElementsError(visibility: boolean[] = [], texts: string[] = ['First control', 'Second control']): Error {
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
    webElements: [element('/html/body/div/button[1]', texts[0], visibility[0]), element('/html/body/div/button[2]', texts[1], visibility[1])],
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
    expect(result.elements).not.toContain('Identical to element');
  });

  it('sends the model to visualClick when the matches are indistinguishable', async () => {
    const { deps } = fakeDeps(() => multipleElementsError([], ['', '']));
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);

    expect(result.elements).toContain('Identical to element 2');
    expect(result.elements).toContain('Identical to element 1');
    expect(result.elements).toContain('visualClick()');
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

  it('names the judged element and points at elementIndex when the judge is confident', async () => {
    const { deps } = fakeDeps(() => multipleElementsError());
    const judge: any = { directEnabled: true, ask: async () => ({ pick: { answer: '2', confidence: 0.92, probabilities: { '1': 0.05, '2': 0.92, none: 0.03 } } }) };
    const tools = createCodeceptJSTools({ ...deps, judge }, fakeTask());

    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);

    expect(result.judgedElement).toBe(2);
    expect(result.suggestion).toContain('elementIndex');
    expect(result.matchedElements).toBeUndefined();
  });
});

describe('hover on an ambiguous locator', () => {
  it('hands the matched elements back to the model without leaking raw element data', async () => {
    const { deps } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools(deps, fakeTask());

    const result = await tools.hover.execute({ commands: [`I.moveCursorTo({"role":"switch"})`], explanation: 'Reveal the row actions' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.multipleElementsDetected).toBe(true);
    expect(result.elements).toContain('Element 1:');
    expect(result.matchedElements).toBeUndefined();
  });

  it('names the judged element and points at elementIndex when the judge is confident', async () => {
    const { deps } = fakeDeps(() => multipleElementsError());
    const judge: any = { directEnabled: true, ask: async () => ({ pick: { answer: '1', confidence: 0.85, probabilities: { '1': 0.85, '2': 0.1, none: 0.05 } } }) };
    const tools = createCodeceptJSTools({ ...deps, judge }, fakeTask());

    const result = await tools.hover.execute({ commands: [`I.moveCursorTo({"role":"switch"})`], explanation: 'Reveal the row actions' }, {} as any);

    expect(result.judgedElement).toBe(1);
    expect(result.suggestion).toContain('elementIndex');
    expect(result.matchedElements).toBeUndefined();
  });
});

describe('resolveAmbiguousElement', () => {
  it('picks the intended match when judge is confident', async () => {
    const judge: any = { directEnabled: true, ask: async () => ({ pick: { answer: '2', confidence: 0.92, probabilities: { '1': 0.05, '2': 0.92, none: 0.03 } } }) };
    const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError());

    const judged = await resolveAmbiguousElement(judge, result, 'Toggle the control');

    expect(judged).toBe(2);
  });

  it('leaves the numbered list alone when judge is uncertain', async () => {
    const judge: any = { directEnabled: true, ask: async () => ({ pick: { answer: '1', confidence: 0.2, probabilities: { '1': 0.5, '2': 0.48, none: 0.02 } } }) };
    const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError());

    const judged = await resolveAmbiguousElement(judge, result, 'Toggle the control');

    expect(judged).toBeNull();
    expect(result.multipleElementsDetected).toBe(true);
    expect(result.elements).toContain('Element 1:');
    expect(result.elements).toContain('Element 2:');
  });

  it('leaves the numbered list alone with no judge', async () => {
    const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError());

    const judged = await resolveAmbiguousElement(undefined, result, 'Toggle the control');

    expect(judged).toBeNull();
    expect(result.multipleElementsDetected).toBe(true);
  });
});
