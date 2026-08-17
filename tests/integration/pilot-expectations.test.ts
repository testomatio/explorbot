import { LLMock } from '@copilotkit/aimock';
import { createOpenAI } from '@ai-sdk/openai';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { Pilot } from '../../src/ai/pilot.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';
import { Test, TestResult } from '../../src/test-plan.ts';

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

describe('Pilot settling expected outcomes', () => {
  let mock: LLMock;
  let pilot: Pilot;

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({ baseURL: `${mock.url}/v1`, apiKey: 'test-key', compatibility: 'compatible' });
    ConfigParser.setupTestConfig();
    const provider = new Provider({ model: openai.chat('test-model'), config: {} });

    pilot = new Pilot({ ai: provider, config: ConfigParser.getInstance().getConfig(), explorer: {}, stateManager: {}, requestStore: {}, playwrightRecorder: {} } as any, {} as any, {} as any);
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();
  });

  afterAll(async () => {
    await mock.stop();
  });

  it('settles an outcome the tester described in its own words', async () => {
    const task = new Test('open the editor', 'normal', ['the global editor opens with its markdown loaded'], '/skills');
    task.addNote('Clicked Change skill globally; editor panel appeared showing SKILL.md content', TestResult.PASSED);

    mock.on({}, { content: JSON.stringify({ outcomes: [{ expectation: 'the global editor opens with its markdown loaded', status: 'passed', evidence: 'the editor panel is showing SKILL.md' }] }) });

    const settled = await pilot.settleExpectations(task);

    expect(settled).toEqual([{ text: 'the global editor opens with its markdown loaded', status: 'passed', evidence: 'the editor panel is showing SKILL.md' }]);
    expect(extractPromptText(mock.getRequests()[0])).toContain('editor panel appeared showing SKILL.md content');
  });

  it('asks nothing when the run already checked every outcome off by name', async () => {
    const task = new Test('open the editor', 'normal', ['the editor opens'], '/skills');
    task.addNote('the editor opens', TestResult.PASSED);

    const settled = await pilot.settleExpectations(task);

    expect(settled).toEqual([{ text: 'the editor opens', status: 'passed' }]);
    expect(mock.getRequests().length).toBe(0);
  });

  it('leaves an outcome unverified when the model cannot tell from the log', async () => {
    const task = new Test('open the editor', 'normal', ['the list refreshes'], '/skills');
    task.addNote('Clicked around the sidebar', TestResult.PASSED);

    mock.on({}, { content: JSON.stringify({ outcomes: [{ expectation: 'the list refreshes', status: 'unverified', evidence: null }] }) });

    const settled = await pilot.settleExpectations(task);

    expect(settled).toEqual([{ text: 'the list refreshes', status: 'unverified', evidence: null }]);
  });
});
