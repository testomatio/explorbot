import { beforeEach, describe, expect, it } from 'bun:test';
import { Decision } from '../../src/ai/judge.ts';
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
  const judgePicking = (index: number) => ({ decide: async (_question: string, options: string[]) => new Decision(options[index], 0.9) });

  it('names the element the judge picks, by elementIndex', async () => {
    const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError(), judgePicking(1) as any, 'Toggle the control');
    expect(result.suggestion).toContain('elementIndex: 2');
  });

  it('keeps the numbered list when the judge rejects', async () => {
    const judge = { decide: async () => new Decision(null, 0.5) };
    const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError(), judge as any, 'Toggle the control');
    expect(result.suggestion).not.toContain('is the one meant');
    expect(result.elements).toContain('Element 2:');
  });

  it('emits no key main does not emit when there is no judge', async () => {
    const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError());
    expect(Object.keys(result).sort()).toEqual(['action', 'elements', 'message', 'multipleElementsDetected', 'success', 'suggestion']);
  });

  it('clicks the element the judge picks right away, before the remaining fallbacks', async () => {
    const { deps, action } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools({ ...deps, judge: judgePicking(1) } as any, fakeTask());
    await tools.click.execute({ commands: [`I.click({"role":"switch"})`, `I.click('.other')`], explanation: 'Toggle the control' }, {} as any);
    expect(action.ran).toEqual([`I.click({"role":"switch"})`, `I.click({"role":"switch"}, step.opts({ elementIndex: 2 }))`, `I.click('.other')`]);
  });

  it('asks the judge once per click', async () => {
    let asked = 0;
    const judge = {
      decide: async (_question: string, options: string[]) => {
        asked++;
        return new Decision(options[0], 0.9);
      },
    };
    const { deps } = fakeDeps(() => multipleElementsError());
    const tools = createCodeceptJSTools({ ...deps, judge } as any, fakeTask());
    await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);
    expect(asked).toBe(1);
  });

  it('skips the judge and sends the model to visualClick when the matches are identical', async () => {
    let asked = 0;
    const judge = {
      decide: async () => {
        asked++;
        return new Decision(null, 0);
      },
    };
    const { deps, action } = fakeDeps(() => multipleElementsError([], ['', '']));
    const tools = createCodeceptJSTools({ ...deps, judge } as any, fakeTask());
    const result = await tools.click.execute({ commands: [`I.click({"role":"switch"})`], explanation: 'Toggle the control' }, {} as any);
    expect(asked).toBe(0);
    expect(action.ran).toHaveLength(1);
    expect(result.suggestion).toContain('visualClick()');
  });

  it('labels each option from the live element: icon, description and surrounding section', async () => {
    const native = (data: Record<string, any>) => ({ evaluate: async () => data });
    const error = multipleElementsError([], ['', '']);
    const attrs = (context: string) => ({ class: 'btn', 'data-explorbot-context': context, 'data-explorbot-hit': 'target' });
    (error as any).webElements[0].getNativeElement = () => native({ tag: 'button', text: '', icon: 'md-icon md-icon-tune', description: 'Filters', allAttrs: attrs('Run header') });
    (error as any).webElements[1].getNativeElement = () => native({ tag: 'button', text: '', icon: 'md-icon md-icon-close', description: '', allAttrs: attrs('Run header') });
    let options: string[] = [];
    const judge = {
      decide: async (_question: string, offered: string[]) => {
        options = offered;
        return new Decision(null, 0);
      },
    };
    await failedToolResult('click', 'Multiple elements (2) found', {}, error, judge as any, 'Open filters');
    expect(options[0]).toBe('button "no text", icon: md-icon md-icon-tune, described as: "Filters", in: "Run header"');
    expect(options[1]).toBe('button "no text", icon: md-icon md-icon-close, in: "Run header"');
  });
});
