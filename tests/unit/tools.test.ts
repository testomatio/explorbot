import { afterEach, describe, expect, it } from 'bun:test';
import { createAskUserTool, createCodeceptJSTools, createIframeTools, createLearnExperienceTool } from '../../src/ai/tools.ts';
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
    const learned: Array<{ url: string; description: string }> = [];
    return {
      learned,
      getCurrentState: () => ({ url: '/login?info=You+must+be+logged+in', fullUrl: 'http://localhost:3000/login?info=You+must+be+logged+in' }),
      getKnowledgeTracker: () => ({
        addKnowledge: (url: string, description: string) => {
          learned.push({ url, description });
          return { filename: 'login.md', filePath: 'knowledge/login.md', isNewFile: true };
        },
      }),
    } as any;
  }

  it('writes a persistent answer to the knowledge of the current page', async () => {
    executionController.setInputCallback(async () => 'sign in as owner@example.org');
    const stateManager = fakeStateManager();

    const result: any = await createAskUserTool(stateManager).execute({ question: 'How do I authorize?', persistent: true }, {} as any);

    expect(result.knowledgeFile).toBe('knowledge/login.md');
    expect(stateManager.learned).toEqual([{ url: '/login', description: 'How do I authorize?\n\nsign in as owner@example.org' }]);
  });

  it('keeps a one-off answer out of knowledge', async () => {
    executionController.setInputCallback(async () => 'pick the second row');
    const stateManager = fakeStateManager();

    const result: any = await createAskUserTool(stateManager).execute({ question: 'Which row should I open?' }, {} as any);

    expect(result.userSuggestion).toBe('pick the second row');
    expect(result.knowledgeFile).toBeUndefined();
    expect(stateManager.learned).toEqual([]);
  });
});
