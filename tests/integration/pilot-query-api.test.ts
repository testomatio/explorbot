import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Pilot } from '../../src/ai/pilot.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';
import { Test } from '../../src/test-plan.ts';

function toolCall(id: string, name: string, args: Record<string, any>) {
  return { id, name, arguments: JSON.stringify(args) };
}

describe('Pilot queryApi', () => {
  let mock: LLMock;
  let provider: Provider;
  let lookupCalls: Array<{ question: string; scopeUrl?: string }>;

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({ baseURL: `${mock.url}/v1`, apiKey: 'test-key', compatibility: 'compatible' });
    ConfigParser.setupTestConfig();
    provider = new Provider({ model: openai.chat('test-model'), config: {} });
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();
    lookupCalls = [];
  });

  afterAll(async () => {
    await mock.stop();
  });

  function createPilot(fisherman?: any): Pilot {
    const deps = {
      ai: provider,
      config: ConfigParser.getInstance().getConfig(),
      explorer: {},
      stateManager: { getCurrentState: () => null, otherTabs: [] },
      requestStore: { getFailedRequests: () => [] },
      playwrightRecorder: {},
    };
    const researcher = { summary: async () => 'A list of tests' };
    const pilot = new Pilot(deps as any, {} as any, researcher as any);
    if (fisherman) pilot.setFisherman(fisherman);
    return pilot;
  }

  function availableFisherman(summary: string, success = true) {
    return {
      isAvailable: () => true,
      lookupData: async (question: string, scopeUrl?: string) => {
        lookupCalls.push({ question, scopeUrl });
        return { success, summary, created: [], failed: [] };
      },
    };
  }

  function planningTask(): { task: Test; state: ActionResult } {
    const task = new Test('filter the list by label', 'normal', ['the list narrows'], '/projects/alpha-shop/tests');
    const state = new ActionResult({ url: '/projects/alpha-shop/tests', title: 'Tests', h1: 'Tests' });
    return { task, state };
  }

  it('offers queryApi while planning', async () => {
    const { task, state } = planningTask();
    mock.on({}, { content: 'PROGRESS: ready\nNEXT: open the filter' });

    await createPilot(availableFisherman('unused')).planTest(task, state);

    expect(JSON.stringify(mock.getRequests()[0]?.body?.tools)).toContain('queryApi');
  });

  it('answers from Fisherman and records the answer as a note, not a step', async () => {
    const { task, state } = planningTask();
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('q1', 'queryApi', { question: 'which labels exist?' })] });
    mock.on({}, { content: 'PROGRESS: labels are available\nNEXT: open the label filter' });

    const plan = await createPilot(availableFisherman('Two labels exist: Bug and Urgent')).planTest(task, state);

    expect(lookupCalls).toEqual([{ question: 'which labels exist?', scopeUrl: '/projects/alpha-shop/tests' }]);
    expect(plan).toContain('open the label filter');
    expect(Object.values(task.notes).some((n: any) => n.message.includes('Two labels exist: Bug and Urgent'))).toBe(true);
    expect(Object.keys(task.steps)).toHaveLength(0);
  });

  it('tells the model to fall back to the page when there is no API access', async () => {
    const { task, state } = planningTask();
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('q1', 'queryApi', { question: 'which labels exist?' })] });
    mock.on({}, { content: 'PROGRESS: no API\nNEXT: read the labels from the page' });

    await createPilot().planTest(task, state);

    expect(JSON.stringify(mock.getRequests()[1]?.body)).toContain('No API access is configured');
  });

  it('passes the failure reason through when the lookup cannot answer', async () => {
    const { task, state } = planningTask();
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('q1', 'queryApi', { question: 'which labels exist?' })] });
    mock.on({}, { content: 'PROGRESS: unanswered\nNEXT: read the labels from the page' });

    await createPilot(availableFisherman('No read endpoints are known for this scope', false)).planTest(task, state);

    expect(JSON.stringify(mock.getRequests()[1]?.body)).toContain('No read endpoints are known for this scope');
    expect(Object.values(task.notes)).toHaveLength(0);
  });
});
