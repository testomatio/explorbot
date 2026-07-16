import { describe, expect, it } from 'bun:test';
import { createCodeceptJSTools, createIframeTools, createLearnExperienceTool } from '../../src/ai/tools.ts';

function fakeExplorer(): any {
  return {
    getStateManager: () => ({}),
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
    const tools = createCodeceptJSTools(fakeExplorer(), task);

    const result = await tools.click.execute({ commands: [], explanation: 'nothing' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No commands provided');
    expect(task.committed).toEqual(['failed']);
  });

  it('rejects non-click I. commands as invalid', async () => {
    const task = fakeTask();
    const tools = createCodeceptJSTools(fakeExplorer(), task);

    const result = await tools.click.execute({ commands: ['I.fillField("name", "value")'], explanation: 'type' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid commands');
    expect(task.committed).toEqual(['failed']);
  });

  it('rejects non-moveCursorTo commands in hover', async () => {
    const task = fakeTask();
    const tools = createCodeceptJSTools(fakeExplorer(), task);

    const result = await tools.hover.execute({ commands: ['I.click("Save")'], explanation: 'hover' }, {} as any);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid commands');
  });
});

describe('createIframeTools', () => {
  it('always returns the exitIframe tool', () => {
    const tools = createIframeTools(fakeExplorer());
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
