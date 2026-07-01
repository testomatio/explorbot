import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import type { Conversation, ToolExecution } from '../../src/ai/conversation.ts';
import { Historian } from '../../src/ai/historian.ts';
import { Test, TestResult } from '../../src/test-plan.ts';

function fakeConversation(execs: ToolExecution[]): Conversation {
  return { getToolExecutions: () => execs } as unknown as Conversation;
}

describe('Historian experience', () => {
  it('writes a fallback flow from successful steps when curator returns empty', async () => {
    let written = '';
    const provider = {
      chat: async () => ({ text: '' }),
      getModelForAgent: () => undefined,
    };
    const experienceTracker = {
      getRelevantExperience: () => [],
      writeAction: () => {},
      writeFlow: (_state: ActionResult, body: string) => {
        written = body;
      },
    };
    const historian = new Historian(provider as any, experienceTracker as any);
    const task = new Test('Create item', 'normal', ['item exists'], '/items');
    task.finish(TestResult.PASSED);

    await historian.saveSession(
      task,
      new ActionResult({ url: '/items', title: 'Items' }),
      fakeConversation([
        {
          toolName: 'form',
          input: { explanation: 'Fill item title' },
          wasSuccessful: true,
          output: {
            success: true,
            action: 'form',
            code: 'I.fillField("Title", "Item One")',
          },
        },
        {
          toolName: 'pressKey',
          input: { explanation: 'Confirm item' },
          wasSuccessful: true,
          output: {
            success: true,
            action: 'pressKey',
            code: 'I.pressKey("Enter")',
          },
        },
      ])
    );

    expect(written).toContain('## FLOW: create item');
    expect(written).toContain('I.fillField("Title", "Item One")');
    expect(written).toContain('I.pressKey("Enter")');
  });

  it('keeps curated flow when curator selects a subset of successful steps', async () => {
    let written = '';
    const provider = {
      chat: async () => ({
        text: '## FLOW: start item creation\n\n* Start item creation\n\n```js\nI.click("New item")\n```\n',
      }),
      getModelForAgent: () => undefined,
    };
    const experienceTracker = {
      getRelevantExperience: () => [],
      writeAction: () => {},
      writeFlow: (_state: ActionResult, body: string) => {
        written = body;
      },
    };
    const historian = new Historian(provider as any, experienceTracker as any);
    const task = new Test('Create item', 'normal', ['item exists'], '/items');
    task.finish(TestResult.PASSED);

    await historian.saveSession(
      task,
      new ActionResult({ url: '/items', title: 'Items' }),
      fakeConversation([
        {
          toolName: 'click',
          input: { explanation: 'Open item form' },
          wasSuccessful: true,
          output: {
            success: true,
            action: 'click',
            code: 'I.click("New item")',
          },
        },
        {
          toolName: 'form',
          input: { explanation: 'Fill item title' },
          wasSuccessful: true,
          output: {
            success: true,
            action: 'form',
            code: 'I.fillField("Title", "Item One")',
          },
        },
      ])
    );

    expect(written).toContain('## FLOW: start item creation');
    expect(written).toContain('I.click("New item")');
    expect(written).not.toContain('I.fillField("Title", "Item One")');
  });

  it('uses passed task steps when conversation missed reusable actions', async () => {
    let written = '';
    const provider = {
      chat: async () => ({ text: '' }),
      getModelForAgent: () => undefined,
    };
    const experienceTracker = {
      getRelevantExperience: () => [],
      writeAction: () => {},
      writeFlow: (_state: ActionResult, body: string) => {
        written = body;
      },
    };
    const historian = new Historian(provider as any, experienceTracker as any);
    const task = new Test('Create item', 'normal', ['item exists'], '/items');
    task.addStep('I.fillField("Title", "Item One")', 10, 'passed');
    task.addStep('I.pressKey("Enter")', 10, 'passed');
    task.finish(TestResult.PASSED);

    await historian.saveSession(
      task,
      new ActionResult({ url: '/items', title: 'Items' }),
      fakeConversation([
        {
          toolName: 'click',
          input: { explanation: 'Open item form' },
          wasSuccessful: true,
          output: {
            success: true,
            action: 'click',
            code: 'I.click("New item")',
          },
        },
      ])
    );

    expect(written).toContain('I.click("New item")');
    expect(written).toContain('I.fillField("Title", "Item One")');
    expect(written).toContain('I.pressKey("Enter")');
  });

  it('does not fallback-write when a relevant flow already exists', async () => {
    let writeCount = 0;
    const provider = {
      chat: async () => ({ text: '' }),
      getModelForAgent: () => undefined,
    };
    const experienceTracker = {
      getRelevantExperience: () => [{ content: '## FLOW: create item\n\n```js\nI.click("New item")\n```' }],
      writeAction: () => {},
      writeFlow: () => {
        writeCount += 1;
      },
    };
    const historian = new Historian(provider as any, experienceTracker as any);
    const task = new Test('Create item', 'normal', ['item exists'], '/items');
    task.finish(TestResult.PASSED);

    await historian.saveSession(
      task,
      new ActionResult({ url: '/items', title: 'Items' }),
      fakeConversation([
        {
          toolName: 'click',
          input: { explanation: 'Open item form' },
          wasSuccessful: true,
          output: {
            success: true,
            action: 'click',
            code: 'I.click("New item")',
          },
        },
      ])
    );

    expect(writeCount).toBe(0);
  });
});
