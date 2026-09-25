import { beforeEach, describe, expect, it } from 'bun:test';
import { Judge, UNDECIDED } from '../../src/ai/judge.ts';
import { createCodeceptJSTools, failedToolResult } from '../../src/ai/tools.ts';
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
    attemptExactElementIndex: async (command: string, elementIndex: number) => {
      action.ran.push(`${command} #${elementIndex}`);
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
});

describe('judging an ambiguous match', () => {
  const judgeAnswering = (answer: (options: string[]) => string | null) => {
    const asked: string[][] = [];
    const provider: any = {
      decide: async (_state: unknown, _question: string, options: string[]) => {
        asked.push(options);
        return { value: answer(options), probability: 0.9 };
      },
    };
    return { judge: new Judge(provider, { tool: true, direct: true }), asked };
  };
  const judgePicking = (index: number) => judgeAnswering((options) => options[index]).judge;

  it('names the element the judge picks, by elementIndex', async () => {
    const result = await failedToolResult('form', 'Multiple elements (2) found', {}, multipleElementsError(), judgePicking(1), 'Toggle the control');
    expect(result.suggestion).toContain('elementIndex: 2');
  });

  it('keeps the numbered list when the judge rejects', async () => {
    const { judge } = judgeAnswering(() => UNDECIDED);
    const result = await failedToolResult('form', 'Multiple elements (2) found', {}, multipleElementsError(), judge, 'Toggle the control');
    expect(result.suggestion).not.toContain('is the one meant');
    expect(result.elements).toContain('Element 2:');
  });

  it('emits no key main does not emit when there is no judge', async () => {
    const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError());
    expect(Object.keys(result).sort()).toEqual(['action', 'elements', 'message', 'multipleElementsDetected', 'success', 'suggestion']);
  });

  it('never looks at the matches for a judge when there is none, and points to visualClick', async () => {
    const { deps, action } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools(deps, fakeTask());
    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);
    expect(action.ran).toEqual([`I.click({"role":"switch"})`]);
    expect(result.suggestion).toContain('visualClick()');
  });

  it('clicks the element the judge picks right away, before the remaining fallbacks', async () => {
    const { deps, action } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools({ ...deps, judge: judgePicking(1) } as any, fakeTask());
    await tools.click.execute({ commands: [`I.click({"role":"switch"})`, `I.click('.other')`], explanation: 'Toggle the control' }, {} as any);
    expect(action.ran).toEqual([`I.click({"role":"switch"})`, `I.click({"role":"switch"}) #2`, `I.click('.other')`]);
  });

  it('asks the judge once per click', async () => {
    const { judge, asked } = judgeAnswering((options) => options[0]);
    const { deps } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools({ ...deps, judge } as any, fakeTask());
    await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);
    expect(asked).toHaveLength(1);
  });

  it('skips the judge and sends the model to visualClick when the matches are identical', async () => {
    const { judge, asked } = judgeAnswering((options) => options[0]);
    const { deps, action } = fakeDeps(() => multipleElementsError([], ['', '']));
    const tools = createCodeceptJSTools({ ...deps, judge } as any, fakeTask());
    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);
    expect(asked).toHaveLength(0);
    expect(action.ran).toHaveLength(1);
    expect(result.elements).toContain('visualClick()');
  });
});
