import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { Chief } from '../../boat/api-tester/src/ai/chief.ts';
import { clearSessionDedup } from '../../src/ai/planner/session-dedup.ts';
import { Provider } from '../../src/ai/provider.ts';
import { ConfigParser } from '../../src/config.ts';

const scenarios = {
  planName: 'Notes API',
  scenarios: [
    { scenario: 'List notes', priority: 'normal', steps: ['GET /notes'], expectedOutcomes: ['Response status is 200'] },
    { scenario: 'Create a note', priority: 'critical', steps: ['POST /notes with a title'], expectedOutcomes: ['Response status is 201'] },
    { scenario: 'Delete a note', priority: 'high', steps: ['DELETE /notes/{id}'], expectedOutcomes: ['Response status is 204'] },
  ],
};

const extracted = {
  files: [
    {
      file: 1,
      headers: [{ name: 'Authorization', value: 'Bearer notes-token-123' }],
      query: [{ name: 'workspace', value: 'demo' }],
      body: [{ name: 'workspace_id', value: '42' }],
    },
  ],
};

const notesKnowledge = { filePath: 'knowledge/api_general.md', endpoint: '*', content: 'Authenticate with the Bearer token notes-token-123. Every request works inside workspace demo (id 42).' };

const isExtraction = (req: any) => JSON.stringify(req.messages).includes('<knowledge_files>');

function extractPromptText(entry: any): string {
  return (entry?.body?.messages || []).map((m: any) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
}

function fakeApiClient(events: string[]) {
  const defaults: any[] = [];
  return {
    defaults,
    addRequestDefaults: (entry: any) => {
      events.push('defaults');
      defaults.push(entry);
    },
    request: async () => {
      events.push('request');
      return { status: 200, responseBody: [] };
    },
  };
}

function fakeKnowledge(files: any[]) {
  return {
    getEndpointKnowledge: () => files,
    renderEndpointKnowledge: () => files.map((f) => f.content).join('\n'),
  };
}

describe('Chief with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  const config = { ai: {}, api: { baseEndpoint: 'http://notes.test' } } as any;

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();
    const openai = createOpenAI({ baseURL: `${mock.url}/v1`, apiKey: 'test-key', compatibility: 'compatible' } as any);
    ConfigParser.setupTestConfig();
    provider = new Provider({ model: openai.chat('test-model'), config: {} } as any);
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();
    clearSessionDedup();
    mock.on({ predicate: isExtraction }, { content: JSON.stringify(extracted) });
    mock.on({}, { content: JSON.stringify(scenarios) });
  });

  afterAll(async () => {
    await mock.stop();
  });

  it('derives request defaults from endpoint knowledge before fetching sample data', async () => {
    const events: string[] = [];
    const apiClient = fakeApiClient(events);
    const chief = new Chief(provider as any, config, apiClient as any, fakeKnowledge([notesKnowledge]) as any);

    await chief.plan('/notes');

    expect(events.slice(0, 2)).toEqual(['defaults', 'request']);
    expect(apiClient.defaults).toEqual([{ pattern: '*', headers: { Authorization: 'Bearer notes-token-123' }, query: { workspace: 'demo' }, body: { workspace_id: 42 } }]);

    const prompt = extractPromptText(mock.getRequests().find((r: any) => isExtraction(r.body)));
    expect(prompt).toContain(notesKnowledge.content);
  });

  it('reads each knowledge file once across planning rounds', async () => {
    const apiClient = fakeApiClient([]);
    const chief = new Chief(provider as any, config, apiClient as any, fakeKnowledge([notesKnowledge]) as any);

    await chief.plan('/notes');
    await chief.plan('/notes');

    expect(mock.getRequests().filter((r: any) => isExtraction(r.body))).toHaveLength(1);
    expect(apiClient.defaults).toHaveLength(1);
  });

  it('skips extraction when no knowledge matches the endpoint', async () => {
    const apiClient = fakeApiClient([]);
    const chief = new Chief(provider as any, config, apiClient as any, fakeKnowledge([]) as any);

    await chief.plan('/notes');

    expect(mock.getRequests().filter((r: any) => isExtraction(r.body))).toHaveLength(0);
    expect(apiClient.defaults).toHaveLength(0);
  });
});
