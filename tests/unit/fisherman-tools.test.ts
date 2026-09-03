import { describe, expect, it } from 'bun:test';
import { createFishermanTools } from '../../src/ai/fisherman-tools.ts';

describe('Fisherman tools', () => {
  it('does not present a rejected capture as a request example', async () => {
    const captured = { method: 'POST', path: '/plans', status: 400, requestBody: { plan: 'wrong' } };
    const { tools } = createFishermanTools({} as any, store(captured), {});

    const result: any = await tools.getEndpointSpec.execute({ method: 'POST', path: '/plans' }, {} as any);

    expect(result.usable).toBe(false);
    expect(result.rejectedRequestBody).toEqual({ plan: 'wrong' });
    expect(result.requestBody).toBeUndefined();
  });

  it('prefers the specification when the captured request was rejected', async () => {
    const captured = { method: 'POST', path: '/plans', status: 422, requestBody: { plan: 'wrong' } };
    const spec = { paths: { '/plans': { post: { requestBody: { required: true } } } } };
    const { tools } = createFishermanTools({} as any, store(captured), { spec });

    const result: any = await tools.getEndpointSpec.execute({ method: 'POST', path: '/plans' }, {} as any);

    expect(result.source).toBe('spec');
    expect(result.definition).toContain('requestBody');
    expect(result.rejectedCapture.status).toBe(422);
  });

  it('prefers the specification over a bodiless GET capture', async () => {
    const captured = { method: 'GET', path: '/labels', status: 200, requestBody: undefined };
    const spec = { paths: { '/labels': { get: { responses: { '200': { description: 'list of labels' } } } } } };
    const { tools } = createFishermanTools({} as any, store(captured), { spec });

    const result: any = await tools.getEndpointSpec.execute({ method: 'GET', path: '/labels' }, {} as any);

    expect(result.source).toBe('spec');
  });

  it('keeps a successful captured request as a usable example', async () => {
    const captured = { method: 'POST', path: '/plans', status: 201, requestBody: { title: 'Plan' } };
    const { tools } = createFishermanTools({} as any, store(captured), {});

    const result: any = await tools.getEndpointSpec.execute({ method: 'POST', path: '/plans' }, {} as any);

    expect(result.source).toBe('captured');
    expect(result.requestBody).toEqual({ title: 'Plan' });
    expect(result.usable).not.toBe(false);
  });

  it('classifies failures by HTTP semantics', async () => {
    for (const [status, category] of [
      [422, 'validation'],
      [401, 'authorization'],
      [404, 'not_found'],
      [409, 'conflict'],
      [429, 'temporary'],
      [503, 'server'],
    ] as const) {
      const apiClient = {
        request: async () => ({ status, statusText: String(status), rawResponseBody: '{}', responseBody: null }),
      };
      const { tools } = createFishermanTools(apiClient as any, store(), {});

      const result: any = await tools.request.execute({ method: 'POST', path: '/plans' }, {} as any);

      expect(result.category).toBe(category);
    }
  });

  it('keeps the HTTP status authoritative over response body fields', async () => {
    const apiClient = {
      request: async () => ({ status: 201, statusText: 'Created', rawResponseBody: '', responseBody: { id: 7, status: 'draft' } }),
    };
    const { tools } = createFishermanTools(apiClient as any, store(), {});

    const result: any = await tools.request.execute({ method: 'POST', path: '/items' }, {} as any);

    expect(result.status).toBe(201);
    expect(result.extracted).toEqual({ id: 7, status: 'draft' });
  });
});

describe('ledger-derived results', () => {
  it('rejects finish when no successful write was made in this run', async () => {
    const { tools, isFinished } = createFishermanTools({} as any, store(), {});

    const result: any = await tools.finish.execute({ summary: 'done', created: [{ type: 'suite', id: '1' }] }, {} as any);

    expect(result.finished).toBe(false);
    expect(result.error).toContain('No successful write');
    expect(isFinished()).toBe(false);
  });

  it('ignores writes made before this run started', async () => {
    const made = [madeWrite('POST', '/api/suites', 201, { id: 's1' })];
    const { tools, isFinished } = createFishermanTools({} as any, store(undefined, made), {});

    const result: any = await tools.finish.execute({ summary: 'done', created: [{ type: 'suite', id: 's1' }] }, {} as any);

    expect(result.finished).toBe(false);
    expect(isFinished()).toBe(false);
  });

  it('drops created items whose id no write response returned, keeps verified ones with their request', async () => {
    const made: any[] = [];
    const { tools, getResult } = createFishermanTools({} as any, store(undefined, made), {});
    made.push(madeWrite('POST', '/api/suites', 201, { id: 's1', title: 'Suite A' }));

    await tools.finish.execute(
      {
        summary: 'done',
        created: [
          { type: 'suite', id: 's1' },
          { type: 'milestone', id: 'm9' },
        ],
      },
      {} as any
    );

    const result = getResult();
    expect(result.success).toBe(true);
    expect(result.created).toEqual([{ type: 'suite', id: 's1', request: 'POST /api/suites' }]);
  });

  it('reports failure when the loop ends without finish, even after a successful write', async () => {
    const made: any[] = [];
    const { getResult } = createFishermanTools({} as any, store(undefined, made), {});
    made.push(madeWrite('POST', '/api/suites', 201, { id: 's1', title: 'Suite A' }));
    made.push(madeWrite('POST', '/api/tests', 400));

    const result = getResult();
    expect(result.success).toBe(false);
    expect(result.summary).toContain('1 successful write');
    expect(result.summary).toContain('POST /api/tests → 400');
    expect(result.created[0].id).toBe('s1');
  });

  it('reports failure with a reason when the loop ends with no successful writes', async () => {
    const made: any[] = [];
    const { getResult } = createFishermanTools({} as any, store(undefined, made), {});
    made.push(madeWrite('POST', '/api/tests', 400));

    const result = getResult();
    expect(result.success).toBe(false);
    expect(result.summary).not.toBe('');
  });

  it('treats a text-only turn as finish, using the text as summary when writes succeeded', () => {
    const made: any[] = [];
    const { finishFromText, getResult, isFinished } = createFishermanTools({} as any, store(undefined, made), {});
    made.push(madeWrite('POST', '/api/suites', 201, { id: 's1' }));

    finishFromText('Created the suite');

    expect(isFinished()).toBe(true);
    const result = getResult();
    expect(result.success).toBe(true);
    expect(result.summary).toBe('Created the suite');
    expect(result.created[0].id).toBe('s1');
  });

  it('keeps the honest failure summary when a text-only turn ends a run with no successful writes', () => {
    const made: any[] = [];
    const { finishFromText, getResult } = createFishermanTools({} as any, store(undefined, made), {});
    made.push(madeWrite('POST', '/api/tests', 400));

    finishFromText('All done successfully');

    const result = getResult();
    expect(result.success).toBe(false);
    expect(result.summary).not.toBe('All done successfully');
  });
});

function store(captured?: any, made: any[] = []): any {
  return {
    findCapturedRequest: () => captured,
    addMadeRequest: (r: any) => made.push(r),
    getMadeRequests: () => made,
  };
}

function madeWrite(method: string, path: string, status: number, body: Record<string, any> = {}): any {
  return {
    method,
    path,
    status,
    error: undefined,
    isWrite: true,
    extractIdAndTitle: () => body,
    toEndpoint: () => `${method} ${path}`,
    toSummary: () => `${method} ${path} → ${status} (0ms)`,
  };
}

function madeRead(path: string, status: number, body = '[]'): any {
  return {
    method: 'GET',
    path,
    status,
    error: undefined,
    isWrite: false,
    rawResponseBody: body,
    responseBody: JSON.parse(body),
    statusText: String(status),
    extractIdAndTitle: () => ({}),
    toEndpoint: () => `GET ${path}`,
    toSummary: () => `GET ${path} → ${status} (0ms)`,
  };
}

describe('Fisherman read-only tools', () => {
  it('offers no write method on the request tool', () => {
    const { tools } = createFishermanTools({} as any, store(), { readOnly: true });

    const methods = tools.request.inputSchema.shape.method.options;

    expect(methods).toEqual(['GET']);
  });

  it('returns a body preview so the answer can quote real values', async () => {
    const labels = madeRead('/api/labels', 200, '[{"id":1,"name":"Bug"}]');
    const apiClient = { request: async () => labels };
    const { tools } = createFishermanTools(apiClient as any, store(), { readOnly: true });

    const result: any = await tools.request.execute({ method: 'GET', path: '/api/labels' }, {} as any);

    expect(result.success).toBe(true);
    expect(result.bodyPreview).toBe('[{"id":1,"name":"Bug"}]');
  });

  it('accepts a finish carrying the answer once a read succeeded', async () => {
    const made: any[] = [];
    const apiClient = { request: async () => madeRead('/api/labels', 200) };
    const { tools, getResult } = createFishermanTools(apiClient as any, store(undefined, made), { readOnly: true });

    await tools.request.execute({ method: 'GET', path: '/api/labels' }, {} as any);
    const finished: any = await tools.finish.execute({ answer: 'No labels exist yet' }, {} as any);

    expect(finished.finished).toBe(true);
    expect(getResult()).toEqual({ success: true, summary: 'No labels exist yet', created: [], failed: [] });
  });

  it('rejects a finish when no read succeeded', async () => {
    const { tools } = createFishermanTools({} as any, store(), { readOnly: true });

    const finished: any = await tools.finish.execute({ answer: 'Three labels exist' }, {} as any);

    expect(finished.finished).toBe(false);
  });

  it('reports no created items when a read run ends without finishing', async () => {
    const made: any[] = [];
    const apiClient = { request: async () => madeRead('/api/labels', 200) };
    const { tools, getResult, finishFromText } = createFishermanTools(apiClient as any, store(undefined, made), { readOnly: true });

    await tools.request.execute({ method: 'GET', path: '/api/labels' }, {} as any);
    finishFromText('One label exists');

    const result = getResult();
    expect(result.success).toBe(true);
    expect(result.summary).toBe('One label exists');
    expect(result.created).toEqual([]);
  });
});
