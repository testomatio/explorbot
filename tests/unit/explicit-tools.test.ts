import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EXPLICIT_TOOL_NAMES, createExplicitTools, parseExplicitToolsRequest } from '../../src/ai/explicit-tools.ts';
import { Tester } from '../../src/ai/tester.ts';
import { ConfigParser } from '../../src/config.ts';
import { Plan, Test } from '../../src/test-plan.ts';
import { parsePlansFromMarkdownText, savePlanToMarkdown } from '../../src/utils/test-plan-markdown.ts';

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
  const deps: any = {
    explorer: { action: () => action, capture: async () => ({ screenshot: Buffer.from('png') }) },
    stateManager: { getCurrentState: () => holder.state },
    ai: {},
  };
  return { deps, action, holder };
}

function fakeTask(): any {
  return { startNote: () => ({ commit: () => {}, screenshot: undefined }) };
}

function openMenu(action: any, holder: { state: any }) {
  action.attempt = async (command: string) => {
    action.ran.push(command);
    action.lastError = null;
    action.executedSteps = [{ command, success: true }];
    holder.state = { ...holder.state, ariaSnapshot: '- menu "Rename"\n- menu "Delete"', id: 'after' };
    return true;
  };
}

describe('rightClick tool', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('right-clicks the first working locator and reports the opened menu', async () => {
    const { deps, action, holder } = fakeDeps();
    openMenu(action, holder);
    const tools = createExplicitTools(deps, fakeTask());

    const result = await tools.rightClick.execute({ commands: ['I.rightClick("Bug 5", ".board")', 'I.rightClick(".card-5")'], explanation: 'open the card menu' }, {} as any);

    expect(result.success).toBe(true);
    expect(action.ran).toEqual(['I.rightClick("Bug 5", ".board")']);
    expect(result.code).toBe('I.rightClick("Bug 5", ".board")');
  });

  it('wraps a bare locator into I.rightClick()', async () => {
    const { deps, action, holder } = fakeDeps();
    openMenu(action, holder);
    const tools = createExplicitTools(deps, fakeTask());

    const result = await tools.rightClick.execute({ commands: ['Bug 5'], explanation: 'open the card menu' }, {} as any);

    expect(result.success).toBe(true);
    expect(action.ran).toEqual(['I.rightClick("Bug 5")']);
  });

  it('rejects non-right-click commands without touching the browser', async () => {
    const { deps, action } = fakeDeps();
    const tools = createExplicitTools(deps, fakeTask());

    const result = await tools.rightClick.execute({ commands: ['I.click("Bug 5")'], explanation: 'open the card menu' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('only accepts I.rightClick()');
    expect(action.ran).toEqual([]);
  });

  it('fails when all locators fail', async () => {
    const { deps, action } = fakeDeps();
    const tools = createExplicitTools(deps, fakeTask());

    const result = await tools.rightClick.execute({ commands: ['I.rightClick("Bug 5")'], explanation: 'open the card menu' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('All right-click commands failed');
    expect(action.ran).toEqual(['I.rightClick("Bug 5")']);
  });

  it('fails when the click lands but no context menu appears', async () => {
    const { deps, action } = fakeDeps();
    action.attempt = async (command: string) => {
      action.ran.push(command);
      action.lastError = null;
      action.executedSteps = [{ command, success: true }];
      return true;
    };
    const tools = createExplicitTools(deps, fakeTask());

    const result = await tools.rightClick.execute({ commands: ['I.rightClick("Bug 5")'], explanation: 'open the card menu' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('no context menu appeared');
  });
});

describe('parseExplicitToolsRequest', () => {
  it('reads requested tool names from pilot guidance', () => {
    expect(parseExplicitToolsRequest('Move the card.\nENABLE_TOOLS: dragAndDrop, rightClick\nFollow this plan.')).toEqual(['dragAndDrop', 'rightClick']);
  });

  it('ignores unknown names and is case-insensitive', () => {
    expect(parseExplicitToolsRequest('ENABLE_TOOLS: draganddrop, hover, click')).toEqual(['dragAndDrop']);
  });

  it('returns nothing without the marker', () => {
    expect(parseExplicitToolsRequest('Use click() on the card.')).toEqual([]);
  });
});

describe('explicit tools in the test plan', () => {
  let tmpPath: string;

  beforeEach(() => {
    tmpPath = mkdtempSync(join(tmpdir(), 'explorbot-explicit-'));
  });

  it('round-trips the tools flag through the plan markdown', () => {
    const plan = new Plan('/board');
    const dragTest = new Test('Reorder cards by dragging', 'high', ['cards are reordered'], '/board', ['drag the card']);
    dragTest.explicitTools = [...EXPLICIT_TOOL_NAMES];
    const plainTest = new Test('Open the board', 'normal', ['board is visible'], '/board', []);
    plan.addTest(dragTest);
    plan.addTest(plainTest);
    const file = join(tmpPath, 'plan.md');
    savePlanToMarkdown(plan, file);

    const restored = parsePlansFromMarkdownText(readFileSync(file, 'utf-8'))[0];

    expect(restored.tests[0].explicitTools).toEqual(['draganddrop', 'rightclick']);
    expect(restored.tests[1].explicitTools).toEqual([]);
  });

  it('defaults to no explicit tools for plans written without the flag', () => {
    const content = ['<!-- suite -->', '# /board', '', '<!-- test', 'priority: high', '-->', '# Reorder cards', '', '## Requirements', '', '/board', ''].join('\n');
    const restored = parsePlansFromMarkdownText(content)[0];

    expect(restored.tests[0].explicitTools).toEqual([]);
  });
});

describe('tester explicit tools gating', () => {
  function buildTester() {
    const deps: any = {
      explorer: {},
      ai: { getSystemPromptForAgent: () => '' },
      config: {},
      stateManager: {
        getCurrentState: () => null,
        otherTabs: [],
        getExperienceTracker: () => ({ getExperienceTableOfContents: () => [] }),
      },
      knowledgeTracker: { getRelevantKnowledge: () => [], renderRelevantKnowledge: () => '', renderRelevantContext: () => '' },
      requestStore: { clear: () => {}, onFailedRequest: () => () => {}, getFailedRequests: () => [] },
      playwrightRecorder: {},
    };
    return new Tester(deps, {} as any, {} as any);
  }

  it('keeps the explicit tools rule out of the system message by default', () => {
    const tester = buildTester();

    expect(tester.getSystemMessage()).not.toContain('<explicit_tools>');
  });

  it('injects the rule when the plan armed the tools', () => {
    const tester = buildTester();
    (tester as any).enabledExplicitTools = new Set(['dragAndDrop']);

    expect(tester.getSystemMessage()).toContain('### dragAndDrop() tool');
  });

  it('enables tools from the pilot marker and returns the rules to inject', () => {
    const tester = buildTester();
    const rules = (tester as any).applyExplicitTools('ENABLE_TOOLS: dragAndDrop, rightClick');

    expect((tester as any).enabledExplicitTools).toEqual(new Set(['dragAndDrop', 'rightClick']));
    expect(rules).toContain('<explicit_tools>');
    expect((tester as any).applyExplicitTools('ENABLE_TOOLS: dragAndDrop')).toBe('');
    expect((tester as any).applyExplicitTools('No marker here')).toBe('');
  });
});
