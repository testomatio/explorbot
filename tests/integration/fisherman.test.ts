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

function readResult(id: string, urlPath: string, search = ''): RequestResult {
  const result = new RequestResult({
    id,
    method: 'GET',
    path: urlPath,
    fullUrl: `${urlPath}${search}`,
    requestHeaders: {},
    status: 200,
    statusText: '200',
    responseHeaders: {},
    timing: 0,
    timestamp: new Date(),
  });
  result.rawResponseBodyValue = '';
  return result;
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
  let apiHeaders: Record<string, string>;

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
    apiHeaders = {};
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    await mock.stop();
    ConfigParser.cleanupAllTestDirectories();
  });

  function createFisherman(browserHeaders: Record<string, string> = {}, configHeaders: Record<string, string> = {}, hasApiConfig = false, spec: any = null): Fisherman {
    const apiClient = {
      request: async () => apiResponses.shift(),
      setHeaders: (h: Record<string, string>) => Object.assign(apiHeaders, h),
      getHeaders: () => ({ ...apiHeaders }),
    };
    return new Fisherman(
      provider,
      apiClient as any,
      requestStore,
      async () => spec,
      'https://example.test/api',
      async () => browserHeaders,
      configHeaders,
      hasApiConfig
    );
  }

  it('scopes the prompt and reports verified created items with their request', async () => {
    const created = requestResult('made_1', 'POST', '/api/alpha-shop/suites', 201);
    created.rawResponseBodyValue = JSON.stringify({ data: { id: 's1', title: 'Suite A' } });
    apiResponses.push(created);

    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('c1', 'request', { method: 'POST', path: '/api/alpha-shop/suites', body: { title: 'Suite A' } })] });
    mock.on({ sequenceIndex: 1 }, { toolCalls: [toolCall('c2', 'finish', { summary: '1 suite created', created: [{ type: 'suite', id: 's1', title: 'Suite A' }] })] });
    mock.on({}, { content: 'done' });

    const result = await createFisherman().prepareData('1 suite', '/projects/alpha-shop/suites');

    expect(result.success).toBe(true);
    expect(result.created).toEqual([{ type: 'suite', id: 's1', title: 'Suite A', request: 'POST /api/alpha-shop/suites' }]);

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

  it('sends the current browser session credentials, replacing captured ones', async () => {
    const captured = requestResult('xhr_010_POST_api_alpha-shop_tests', 'POST', '/api/alpha-shop/tests', 201);
    captured.requestHeaders = { 'x-csrf-token': 'captured-token', cookie: 'session=captured' };
    requestStore.addCapturedRequest(captured);

    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('c1', 'stop', { reason: 'nothing to do' })] });
    mock.on({}, { content: 'done' });

    await createFisherman({ Cookie: 'session=live', 'x-csrf-token': 'live-token' }).prepareData('1 suite', '/projects/alpha-shop/suites');

    expect(apiHeaders.Cookie).toBe('session=live');
    expect(apiHeaders['x-csrf-token']).toBe('live-token');
    expect(apiHeaders.cookie).toBeUndefined();
  });

  it('achieve mode authenticates only through config headers, never the browser session', async () => {
    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('c1', 'stop', { reason: 'nothing to do' })] });
    mock.on({}, { content: 'done' });

    await createFisherman({ Cookie: 'session=live' }, { 'x-api-key': 'from-config' }, true).prepareData('1 suite', '/projects/alpha-shop/suites');

    expect(apiHeaders['x-api-key']).toBe('from-config');
    expect(apiHeaders.Cookie).toBeUndefined();
  });

  it('treats a no-tool-call response as finish with the text as summary', async () => {
    const created = requestResult('made_2', 'POST', '/api/alpha-shop/suites', 201);
    created.rawResponseBodyValue = JSON.stringify({ data: { id: 's2', title: 'Suite B' } });
    apiResponses.push(created);

    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('c1', 'request', { method: 'POST', path: '/api/alpha-shop/suites', body: { title: 'Suite B' } })] });
    mock.on({}, { content: 'Created one suite' });

    const result = await createFisherman().prepareData('1 suite', '/projects/alpha-shop/suites');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('Created one suite');
    expect(result.created).toEqual([{ type: 'suites', id: 's2', title: 'Suite B', request: 'POST /api/alpha-shop/suites' }]);
  });

  it('answers a question from a read endpoint and never offers a write method', async () => {
    const labels = requestResult('made_read_1', 'GET', '/api/alpha-shop/labels', 200);
    labels.rawResponseBodyValue = JSON.stringify([
      { id: 1, name: 'Bug' },
      { id: 2, name: 'Urgent' },
    ]);
    apiResponses.push(labels);

    requestStore.addReadRequest(readResult('xhr_100_GET_api_alpha-shop_labels', '/api/alpha-shop/labels'));

    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('r1', 'request', { method: 'GET', path: '/api/alpha-shop/labels' })] });
    mock.on({ sequenceIndex: 1 }, { toolCalls: [toolCall('r2', 'finish', { answer: 'Two labels exist: Bug and Urgent' })] });
    mock.on({}, { content: 'done' });

    const result = await createFisherman().lookupData('which labels exist?', '/projects/alpha-shop/tests');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('Two labels exist: Bug and Urgent');
    expect(result.created).toEqual([]);

    const systemPrompt = extractPromptText(mock.getRequests()[0]);
    expect(systemPrompt).toContain('GET /api/alpha-shop/labels');

    const offeredTools = JSON.stringify(mock.getRequests()[0]?.body?.tools);
    expect(offeredTools).toContain('GET');
    expect(offeredTools).not.toContain('DELETE');
  });

  it("achieve mode lists the spec's read endpoints without exposing its write verbs", async () => {
    const spec = {
      paths: {
        '/api/books': {
          get: { summary: 'List books' },
          post: { summary: 'Add a book' },
        },
        '/api/books/{id}': {
          delete: { summary: 'Remove a book' },
        },
      },
    };

    mock.on({ sequenceIndex: 0 }, { toolCalls: [toolCall('c1', 'stop', { reason: 'no lookup needed' })] });
    mock.on({}, { content: 'done' });

    await createFisherman({}, {}, true, spec).lookupData('which books exist?', '/projects/alpha-shop/tests');

    const systemPrompt = extractPromptText(mock.getRequests()[0]);
    expect(systemPrompt).toContain('GET /books');
    expect(systemPrompt).not.toContain('POST /books');
    expect(systemPrompt).not.toContain('DELETE /books');
  });

  it('reports honestly when no read endpoint is known', async () => {
    const result = await createFisherman().lookupData('which labels exist?', '/projects/alpha-shop/tests');

    expect(result.success).toBe(false);
    expect(mock.getRequests()).toHaveLength(0);
  });

  it('stays available after preparing data found no write endpoints', async () => {
    rmSync(path.join(outputDir, 'requests'), { recursive: true, force: true });
    requestStore = new RequestStore(outputDir);
    requestStore.addReadRequest(readResult('xhr_200_GET_api_alpha-shop_labels', '/api/alpha-shop/labels'));

    const fisherman = createFisherman();
    const result = await fisherman.prepareData('1 label', '/projects/alpha-shop/tests');

    expect(result.success).toBe(false);
    expect(fisherman.isAvailable()).toBe(true);
    expect(mock.getRequests()).toHaveLength(0);
  });
});
