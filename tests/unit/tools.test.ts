import { afterEach, describe, expect, it } from 'bun:test';
import { createAskUserTool, createCodeceptJSTools, createIframeTools, createLearnExperienceTool, createRefTools } from '../../src/ai/tools.ts';
import { executionController } from '../../src/execution-controller.ts';

function fakeDeps(): any {
  return {
    explorer: {},
    stateManager: {},
    ai: {},
  };
}

function fakeTask(): any {
  const committed: string[] = [];
  return {
    committed,
    startNote: () => ({ commit: (r: any) => committed.push(String(r)), screenshot: undefined }),
  };
}

describe('createCodeceptJSTools click validation', () => {
  it('rejects empty commands without touching the browser', async () => {
    const task = fakeTask();
    const tools = createCodeceptJSTools(fakeDeps(), task);

    const result = await tools.click.execute({ commands: [], explanation: 'nothing' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No commands provided');
    expect(task.committed).toEqual(['failed']);
  });

  it('rejects non-click I. commands as invalid', async () => {
    const task = fakeTask();
    const tools = createCodeceptJSTools(fakeDeps(), task);

    const result = await tools.click.execute({ commands: ['I.fillField("name", "value")'], explanation: 'type' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid commands');
    expect(task.committed).toEqual(['failed']);
  });

  it('rejects non-moveCursorTo commands in hover', async () => {
    const task = fakeTask();
    const tools = createCodeceptJSTools(fakeDeps(), task);

    const result = await tools.hover.execute({ commands: ['I.click("Save")'], explanation: 'hover' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid commands');
  });
});

describe('createRefTools', () => {
  it('keeps ref tools out of the shared CodeceptJS tools', () => {
    expect(Object.keys(createCodeceptJSTools(fakeDeps(), fakeTask()))).not.toContain('clickRef');
  });

  it('returns the clickRef tool for callers that supply refs', () => {
    expect(Object.keys(createRefTools(fakeDeps(), fakeTask()))).toEqual(['clickRef']);
  });
});

describe('createIframeTools', () => {
  it('always returns the exitIframe tool', () => {
    const tools = createIframeTools(fakeDeps());
    expect(Object.keys(tools)).toContain('exitIframe');
  });
});

describe('createLearnExperienceTool', () => {
  it('reports missing state when getState returns null', async () => {
    const tool = createLearnExperienceTool({
      getExperienceTracker: () => ({ getExperienceSection: () => 'body' }) as any,
      getState: () => null,
    });

    const result = await tool.execute({ fileTag: 'A', sectionIndex: 1 }, {} as any);

    expect(result).toEqual({ error: 'No current page state available.' });
  });

  it('returns the resolved section when present', async () => {
    const tool = createLearnExperienceTool({
      getExperienceTracker: () => ({ getExperienceSection: () => '## FLOW: login' }) as any,
      getState: () => ({}) as any,
    });

    const result = await tool.execute({ fileTag: 'A', sectionIndex: 1 }, {} as any);

    expect(result).toBe('## FLOW: login');
  });
});

describe('createAskUserTool', () => {
  afterEach(() => {
    executionController.clearInputCallback();
  });

  function fakeStateManager() {
    const remembered: Array<{ url: string; question: string; answer: string }> = [];
    return {
      remembered,
      getCurrentState: () => ({ url: '/login', html: '<html></html>' }),
      getKnowledgeTracker: () => ({
        addKnowledge: () => {
          throw new Error('askUser must not write knowledge');
        },
      }),
      getExperienceTracker: () => ({
        rememberAnswer: (state: any, question: string, answer: string) => remembered.push({ url: state.url, question, answer }),
      }),
    } as any;
  }

  it('remembers the answer for the page it was asked on, without writing knowledge', async () => {
    executionController.setInputCallback(async () => 'sign in as owner@example.org');
    const stateManager = fakeStateManager();

    const result: any = await createAskUserTool(stateManager).execute({ question: 'How do I authorize?' }, {} as any);

    expect(result.userSuggestion).toBe('sign in as owner@example.org');
    expect(stateManager.remembered).toEqual([{ url: '/login', question: 'How do I authorize?', answer: 'sign in as owner@example.org' }]);
  });

  it('remembers nothing when the user skips', async () => {
    executionController.setInputCallback(async () => 'skip');
    const stateManager = fakeStateManager();

    const result: any = await createAskUserTool(stateManager).execute({ question: 'Which row should I open?' }, {} as any);

    expect(result.success).toBe(false);
    expect(stateManager.remembered).toEqual([]);
  });
});
