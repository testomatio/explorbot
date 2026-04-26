import { describe, expect, it } from 'bun:test';
import type { Conversation, ToolExecution } from '../../src/ai/conversation.ts';
import { Historian } from '../../src/ai/historian.ts';

function fakeConversation(execs: ToolExecution[]): Conversation {
  return { getToolExecutions: () => execs } as unknown as Conversation;
}

function makeHistorian(recorderSteps?: Array<{ name: string; args: any[] }>) {
  const fakeExperienceTracker = {
    getRelevantExperience: () => [],
    writeFlow: () => {},
    writeAction: () => {},
  } as any;
  const fakeRecorder = {
    exportChunk: async () => new Map(),
    drainVerifications: () => recorderSteps ?? [],
  } as any;
  return new Historian({} as any, fakeExperienceTracker, undefined, undefined, undefined, fakeRecorder);
}

describe('Historian.toPlaywrightCode — assertion propagation', () => {
  it('emits expect() lines for verify tool assertions', async () => {
    const conversation = fakeConversation([
      {
        toolName: 'verify',
        input: { assertion: 'Edit button is visible' },
        wasSuccessful: true,
        output: {
          success: true,
          action: 'verify',
          message: 'Verification passed: Edit button is visible',
          code: `I.seeElement('button[aria-label="Edit"]')`,
          assertionSteps: [{ name: 'seeElement', args: ['button[aria-label="Edit"]'] }],
        },
      },
    ]);

    const code = await makeHistorian().toPlaywrightCode(conversation, 'Save a new run');
    expect(code).toContain(`await test.step('Edit button is visible', async () => {`);
    expect(code).toContain(`    await expect(page.locator("button[aria-label=\\"Edit\\"]")).toBeVisible();`);
    expect(code).toContain('  });');
  });

  it('emits multiple assertions when verify ran several successful checks', async () => {
    const conversation = fakeConversation([
      {
        toolName: 'verify',
        input: { assertion: "Run status badge shows 'New Run'" },
        wasSuccessful: true,
        output: {
          success: true,
          action: 'verify',
          assertionSteps: [
            { name: 'see', args: ['New Run'] },
            { name: 'seeElement', args: ['.status-badge.new'] },
          ],
        },
      },
    ]);

    const code = await makeHistorian().toPlaywrightCode(conversation, 'Finish');
    expect(code).toContain(`await test.step('Run status badge shows \\'New Run\\'', async () => {`);
    expect(code).toContain(`    await expect(page).toContainText("New Run");`);
    expect(code).toContain(`    await expect(page.locator(".status-badge.new")).toBeVisible();`);
  });

  it('skips failed verify executions', async () => {
    const conversation = fakeConversation([
      {
        toolName: 'verify',
        input: { assertion: 'does not exist' },
        wasSuccessful: false,
        output: { success: false, action: 'verify', assertionSteps: [{ name: 'seeElement', args: ['.nope'] }] },
      },
    ]);

    const code = await makeHistorian().toPlaywrightCode(conversation, 'fail scenario');
    expect(code).toBe('');
  });

  it('mixes click tool executions with verify-sourced assertions in order', async () => {
    const conversation = fakeConversation([
      {
        toolName: 'click',
        input: { explanation: 'Click Save' },
        wasSuccessful: true,
        output: { success: true, action: 'click', playwrightGroupId: undefined, assertionSteps: [] },
      },
      {
        toolName: 'verify',
        input: { assertion: 'Saved message shown' },
        wasSuccessful: true,
        output: {
          success: true,
          action: 'verify',
          assertionSteps: [{ name: 'see', args: ['Saved'] }],
        },
      },
    ]);

    const code = await makeHistorian().toPlaywrightCode(conversation, 'Save & verify');
    expect(code).toContain(`await test.step('Saved message shown', async () => {`);
    expect(code).toContain(`    await expect(page).toContainText("Saved");`);
    expect(code).toContain(`test('Save & verify'`);
  });

  it('appends Pilot-recorded verifications under a // Verification block', async () => {
    const conversation = fakeConversation([
      {
        toolName: 'click',
        input: { explanation: 'Click Save' },
        wasSuccessful: true,
        output: { success: true, action: 'click', playwrightGroupId: 'g1' },
      },
    ]);

    const historian = makeHistorian([
      { name: 'see', args: ['Suite saved'] },
      { name: 'seeElement', args: ['.suites .row'] },
    ]);

    const conversationWithStep = fakeConversation([
      {
        toolName: 'verify',
        input: { assertion: 'baseline' },
        wasSuccessful: true,
        output: { success: true, action: 'verify', assertionSteps: [{ name: 'see', args: ['baseline'] }] },
      },
    ]);

    const code = await historian.toPlaywrightCode(conversationWithStep, 'Pilot verifies');
    expect(code).toContain(`await test.step('Verification', async () => {`);
    expect(code).toContain(`    await expect(page).toContainText("Suite saved");`);
    expect(code).toContain(`    await expect(page.locator(".suites .row")).toBeVisible();`);
    expect(code).toContain('  });');
    // baseline (verify-tool) is wrapped in its own test.step (4-space indented body)
    expect(code).toContain(`await test.step('baseline', async () => {`);
    expect(code).toContain(`    await expect(page).toContainText("baseline");`);
  });
});
