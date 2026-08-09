import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { Prima } from '../../boat/prima/src/prima.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';

const boardState = {
  url: '/tasks/board',
  title: 'Task Board - Task Tracker',
  hash: 'board_h1_task_board',
  html: '<html><body><h1>Task Board</h1><button class="account-menu">Account</button><a href="/settings">Settings</a></body></html>',
  ariaSnapshot: '- heading "Task Board" [level=1]\n- button "Account"\n- link "Settings"',
};

function clickCall(id: string, commands: string[], explanation: string) {
  return { id, name: 'click', arguments: JSON.stringify({ commands, explanation }) };
}

function clickRefCall(id: string, ref: string, element: string) {
  return { id, name: 'clickRef', arguments: JSON.stringify({ ref, element }) };
}

function completedCall(id: string, numbers: number[], proof: string) {
  return { id, name: 'completed', arguments: JSON.stringify({ numbers, proof }) };
}

function extractPromptText(entry: any): string {
  if (!entry?.body?.messages) return '';
  return entry.body.messages
    .map((message: any) => {
      if (typeof message.content === 'string') return message.content;
      if (Array.isArray(message.content)) {
        return message.content
          .filter((part: any) => part.type === 'text')
          .map((part: any) => part.text || '')
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

describe('Prima.do with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  let prima: Prima;
  let executed: string[];
  let artifacts: string;

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({
      baseURL: `${mock.url}/v1`,
      apiKey: 'test-key',
      compatibility: 'compatible',
    });

    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    provider = new Provider({ model: openai.chat('test-model'), config: {} });
    artifacts = mkdtempSync(path.join(tmpdir(), 'prima-do-'));
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();

    executed = [];
    const action = {
      lastError: null,
      actionResult: null,
      exitIframe: async () => {},
      attempt: async (code: string) => {
        executed.push(code);
        return true;
      },
      saveScreenshot: async () => null,
    };

    prima = new Prima({ instance: 'default' });
    (prima as any).artifactsDir = artifacts;
    (prima as any).bot = {
      getExplorer: () => ({ action: () => action, capture: async () => null }),
      stateManager: () => ({ getCurrentState: () => boardState, getVisitCount: () => 1 }),
      getCurrentState: () => boardState,
      requestStore: () => ({ getRequests: () => [] }),
      getProvider: () => provider,
      experienceTracker: () => ({ renderExperienceTocFor: () => '' }),
      agentResearcher: () => ({}),
      agentNavigator: () => ({}),
    };
  });

  afterAll(async () => {
    await mock.stop();
    rmSync(artifacts, { recursive: true, force: true });
    ConfigParser.cleanupAllTestDirectories();
  });

  it('runs both instructions and collects the executed code', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [clickRefCall('call-1', 'e5', 'button "Account"'), completedCall('call-2', [1], 'the account menu is open')] });
    mock.on({ sequenceIndex: 1 }, { toolCalls: [clickRefCall('call-3', 'e9', 'link "Settings"'), completedCall('call-4', [2], 'the settings page is shown')] });
    mock.on({}, { content: 'Both instructions are done.' });

    const envelope = await prima.do(['open the account menu', 'choose the settings entry']);

    expect(envelope.ok).toBe(true);
    expect(executed.every((code) => code.includes('aria-ref='))).toBe(true);
    expect(executed).toHaveLength(2);
    expect(envelope.command).toContain('open the account menu');
    expect(envelope.steps?.map((step) => step.ok)).toEqual([true, true]);
  });

  it('sends every instruction and the page context in one prompt', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [clickCall('call-1', ['I.click("Account")'], 'open the account menu')] });
    mock.on({}, { content: 'Both instructions are done.' });

    await prima.do(['open the account menu', 'choose the settings entry']);

    const prompt = extractPromptText(mock.getRequests()[0]);
    expect(prompt).toContain('1. open the account menu');
    expect(prompt).toContain('2. choose the settings entry');
    expect(prompt).toContain('<page url="/tasks/board"');
    expect(prompt).toContain('button "Account"');
  });

  it('offers the page interaction tools to the model', async () => {
    mock.on({}, { content: 'Nothing to do here.' });

    await prima.do(['open the account menu']);

    const tools = (mock.getRequests()[0] as any).body.tools.map((entry: any) => entry.function.name);
    expect(tools).toContain('clickRef');
    expect(tools).not.toContain('click');
    expect(tools).toContain('form');
  });

  it('reports a failure when the model performs no action', async () => {
    mock.on({}, { content: 'This board has no account menu.' });

    const envelope = await prima.do(['open the account menu']);

    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('No action was performed');
    expect(envelope.failure?.error).toContain('This board has no account menu.');
  });
});
