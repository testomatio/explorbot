import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOpenAI } from '@ai-sdk/openai';
import { LLMock } from '@copilotkit/aimock';
import { Fisherman } from '../../src/ai/fisherman.ts';
import { Provider } from '../../src/ai/provider.ts';
import { RequestResult } from '../../src/api/request-result.ts';
import { RequestStore } from '../../src/api/request-store.ts';
import { ConfigParser } from '../../src/config.ts';

function requestResult(id: string, method: string, urlPath: string, status: number, body?: any): RequestResult {
  return new RequestResult({
    id,
    method,
    path: urlPath,
    fullUrl: urlPath,
    requestHeaders: {},
    requestBody: body,
    status,
    statusText: String(status),
    responseHeaders: {},
    timing: 0,
    timestamp: new Date(),
  });
}

function toolCall(id: string, name: string, args: Record<string, any>) {
  return { id, name, arguments: JSON.stringify(args) };
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

describe('Fisherman with aimock', () => {
  let mock: LLMock;
  let provider: Provider;
  let outputDir: string;
  let requestStore: RequestStore;
  let apiResponses: RequestResult[];

  beforeAll(async () => {
    mock = new LLMock({ port: 0, logLevel: 'silent' });
    await mock.start();

    const openai = createOpenAI({ baseURL: `${mock.url}/v1`, apiKey: 'test-key', compatibility: 'compatible' });
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
    provider = new Provider({ model: openai.chat('test-model'), config: {} });
  });

  beforeEach(() => {
    mock.clearRequests();
    mock.resetMatchCounts();
    mock.clearFixtures();

    outputDir = mkdtempSync(path.join(tmpdir(), 'fisherman-'));
    requestStore = new RequestStore(outputDir);
    requestStore.addCapturedRequest(requestResult('xhr_001_POST_api_alpha-shop_suites', 'POST', '/api/alpha-shop/suites', 201, { title: 'Suite' }));
    requestStore.addCapturedRequest(requestResult('xhr_002_POST_api_other-shop_suites', 'POST', '/api/other-shop/suites', 201, { title: 'Suite' }));
    apiResponses = [];
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await mock.stop();
    ConfigParser.cleanupAllTestDirectories();
  });

  function createFisherman(): Fisherman {
    const apiClient = {
      request: async () => apiResponses.shift(),
      setHeaders: () => {},
      getHeaders: () => ({}),
    };
    return new Fisherman(
      provider,
      apiClient as any,
      requestStore,
      async () => null,
      'https://example.test/api',
      async () => ({})
    );
  }

  it('scopes the prompt and reports verified created items with via', async () => {
    const created = requestResult('made_1', 'POST', '/api/alpha-shop/suites', 201);
    created.rawResponseBodyValue = JSON.stringify({ data: { id: 's1', title: 'Suite A' } });
    apiResponses.push(created);

    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('c1', 'request', { method: 'POST', path: '/api/alpha-shop/suites', body: { title: 'Suite A' } })] });
    mock.on({ sequenceIndex: 1 }, { toolCalls: [toolCall('c2', 'finish', { summary: '1 suite created', created: [{ type: 'suite', id: 's1', title: 'Suite A' }] })] });
    mock.on({}, { content: 'done' });

    const result = await createFisherman().prepareData('1 suite', '/projects/alpha-shop/suites');

    expect(result.success).toBe(true);
    expect(result.created).toEqual([{ type: 'suite', id: 's1', title: 'Suite A', via: 'POST /api/alpha-shop/suites' }]);

    const systemPrompt = extractPromptText(mock.getRequests()[0]);
    expect(systemPrompt).toContain('POST /api/alpha-shop/suites');
    expect(systemPrompt).not.toContain('other-shop');
  });

  it('rejects an empty-handed finish and returns an honest failure', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('c1', 'finish', { summary: 'all done', created: [{ type: 'suite', id: '99' }] })] });
    mock.on({}, { toolCalls: [toolCall('c2', 'stop', { reason: 'The data cannot be created' })] });

    const result = await createFisherman().prepareData('1 suite', '/projects/alpha-shop/suites');

    expect(result.success).toBe(false);
    expect(result.created).toHaveLength(0);
    expect(result.summary).toBe('The data cannot be created');
  });
});
