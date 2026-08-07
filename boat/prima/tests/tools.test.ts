import { beforeEach, describe, expect, it } from 'bun:test';
import { ActionResult } from '../../../src/action-result.ts';
import { createCodeceptJSTools } from '../../../src/ai/tools.ts';
import { createRefTools } from '../src/tools.ts';
import { ConfigParser } from '../../../src/config.ts';
import { Task } from '../../../src/test-plan.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

const state = new ActionResult({ url: '/page', title: 'Page', html: '<html></html>', ariaSnapshot: '' });

function buildTools(page: any, attempted: string[]) {
  const action = {
    lastError: null as Error | null,
    attempt: async (command: string) => {
      attempted.push(command);
      return true;
    },
    saveScreenshot: async () => null,
  };
  const explorer = {
    action: () => action,
    withPage: (fn: (page: any) => any) => fn(page),
  } as any;
  const stateManager = { getCurrentState: () => state } as any;
  return createRefTools({ explorer, stateManager, ai: {} as any }, new Task('t', '/page'));
}

function pageWith(element: any, matches: number) {
  return {
    locator: (selector: string) => {
      if (selector.startsWith('xpath=')) return { count: async () => matches };
      return {
        count: async () => (element ? 1 : 0),
        first: () => ({ evaluate: async () => element }),
      };
    },
  };
}

const saveButton = { tag: 'button', allAttrs: { id: 'save-button' }, text: 'Save', outerHTML: '<button id="save-button">Save</button>', x: 1, y: 1 };

describe('clickRef', () => {
  it('resolves a ref to an attribute-based xpath and clicks it', async () => {
    const attempted: string[] = [];
    const tools = buildTools(pageWith(saveButton, 1), attempted);

    const result = await tools.clickRef.execute({ ref: 'f1e13', explanation: 'click save' });

    expect(result.success).toBe(true);
    expect(attempted).toEqual(['I.click("//*[@id=\\"save-button\\"]")']);
    expect(result.code).toContain('save-button');
  });

  it('fails without guessing when the ref matches nothing', async () => {
    const attempted: string[] = [];
    const tools = buildTools(pageWith(null, 0), attempted);

    const result = await tools.clickRef.execute({ ref: 'f1e99', explanation: 'click save' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('matches no element');
    expect(attempted).toEqual([]);
  });

  it('fails when the resolved xpath is ambiguous', async () => {
    const attempted: string[] = [];
    const tools = buildTools(pageWith(saveButton, 3), attempted);

    const result = await tools.clickRef.execute({ ref: 'f1e13', explanation: 'click save' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('matches 3 elements');
    expect(attempted).toEqual([]);
  });

  it.each(['e13', 'f1e13', 'f12e345'])('accepts the ref shape %p that playwright emits', async (ref) => {
    const attempted: string[] = [];
    const tools = buildTools(pageWith(saveButton, 1), attempted);

    const result = await tools.clickRef.execute({ ref, explanation: 'click save' });

    expect(result.success).toBe(true);
  });

  it('rejects a ref that is not snapshot-shaped', async () => {
    const attempted: string[] = [];
    const tools = buildTools(pageWith(saveButton, 1), attempted);

    const result = await tools.clickRef.execute({ ref: 'button.save', explanation: 'click save' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('is not a ref');
    expect(attempted).toEqual([]);
  });

  it('leaves the locator tools alone — they take no ref', async () => {
    const ladder = createCodeceptJSTools({ explorer: {} as any, stateManager: {} as any, ai: {} as any }, new Task('t', '/page'));

    expect(Object.keys(ladder.click.inputSchema.shape)).toEqual(['commands', 'explanation']);
    expect(Object.keys(ladder.hover.inputSchema.shape)).toEqual(['commands', 'explanation']);
  });
});

describe('hoverRef', () => {
  it('resolves a ref to a moveCursorTo command', async () => {
    const attempted: string[] = [];
    const tools = buildTools(pageWith(saveButton, 1), attempted);

    const result = await tools.hoverRef.execute({ ref: 'f1e13', explanation: 'reveal row actions' });

    expect(result.success).toBe(true);
    expect(attempted).toEqual(['I.moveCursorTo("//*[@id=\\"save-button\\"]")']);
  });
});
