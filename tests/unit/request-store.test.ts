import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestResult } from '../../src/api/request-result.js';
import { RequestStore } from '../../src/api/request-store.js';

let counter = 0;
function makeRequest(method: string, path: string, status: number, id?: string, headers: Record<string, string> = {}): RequestResult {
  counter++;
  return new RequestResult({
    id: id || `req_${counter}`,
    method,
    path,
    fullUrl: path,
    requestHeaders: headers,
    status,
    statusText: String(status),
    responseHeaders: {},
    timing: 0,
    timestamp: new Date(),
  });
}

describe('RequestStore failures', () => {
  let outputDir: string;
  let store: RequestStore;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'reqstore-'));
    store = new RequestStore(outputDir);
  });

  afterEach(() => {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  });

  it('stores failed requests and returns them via getFailedRequests', () => {
    store.addFailedRequest(makeRequest('GET', '/api/a', 404));
    store.addFailedRequest(makeRequest('POST', '/api/b', 500));

    const fails = store.getFailedRequests();
    expect(fails).toHaveLength(2);
    expect(fails[0].method).toBe('GET');
    expect(fails[0].status).toBe(404);
    expect(fails[1].method).toBe('POST');
    expect(fails[1].status).toBe(500);
  });

  it('fires onFailedRequest listeners and respects unsubscribe', () => {
    const received: RequestResult[] = [];
    const off = store.onFailedRequest((r) => received.push(r));

    store.addFailedRequest(makeRequest('GET', '/api/x', 404));
    expect(received).toHaveLength(1);

    off();
    store.addFailedRequest(makeRequest('GET', '/api/y', 404));
    expect(received).toHaveLength(1);
  });

  it('supports multiple listeners independently', () => {
    const a: number[] = [];
    const b: number[] = [];
    store.onFailedRequest((r) => a.push(r.status));
    const offB = store.onFailedRequest((r) => b.push(r.status));

    store.addFailedRequest(makeRequest('GET', '/x', 500));
    offB();
    store.addFailedRequest(makeRequest('GET', '/y', 502));

    expect(a).toEqual([500, 502]);
    expect(b).toEqual([500]);
  });

  it('clear() empties failed requests too', () => {
    store.addFailedRequest(makeRequest('GET', '/x', 404));
    store.addCapturedRequest(makeRequest('POST', '/y', 200));
    expect(store.getFailedRequests()).toHaveLength(1);
    expect(store.getCapturedRequests()).toHaveLength(1);

    store.clear();
    expect(store.getFailedRequests()).toHaveLength(0);
    expect(store.getCapturedRequests()).toHaveLength(0);
  });

  it('clear() preserves registered listeners', () => {
    const received: number[] = [];
    store.onFailedRequest((r) => received.push(r.status));

    store.clear();
    store.addFailedRequest(makeRequest('GET', '/x', 503));

    expect(received).toEqual([503]);
  });
});

describe('findCapturedRequest ranking', () => {
  let outputDir: string;
  let store: RequestStore;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'reqstore-'));
    store = new RequestStore(outputDir);
  });

  afterEach(() => {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  });

  it('prefers a successful capture over a rejected one for the same endpoint', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/suites', 400));
    store.addCapturedRequest(makeRequest('POST', '/api/suites', 201));

    expect(store.findCapturedRequest('POST', '/api/suites')?.status).toBe(201);
  });

  it('prefers the exact endpoint over a deeper sub-path', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/suites/42/move', 200));
    store.addCapturedRequest(makeRequest('POST', '/api/suites', 400));

    expect(store.findCapturedRequest('POST', '/api/suites')?.path).toBe('/api/suites');
  });

  it('matches {id} patterns and concrete ids against stored ids', () => {
    store.addCapturedRequest(makeRequest('PATCH', '/api/suites/1a2b3c4d', 200));

    expect(store.findCapturedRequest('PATCH', '/api/suites/{id}')?.status).toBe(200);
    expect(store.findCapturedRequest('PATCH', '/api/suites/9f8e7d6c')?.status).toBe(200);
  });

  it('prefers the newest among otherwise equal candidates', () => {
    const older = makeRequest('POST', '/api/suites', 201);
    older.timestamp = new Date('2026-01-01');
    const newer = makeRequest('POST', '/api/suites', 201);
    newer.timestamp = new Date('2026-02-01');
    store.addCapturedRequest(older);
    store.addCapturedRequest(newer);

    expect(store.findCapturedRequest('POST', '/api/suites')?.id).toBe(newer.id);
  });
});

describe('RequestStore scope filtering', () => {
  let outputDir: string;
  let store: RequestStore;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'reqstore-'));
    store = new RequestStore(outputDir);
  });

  afterEach(() => {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  });

  it('scopes writes by the most selective segment shared with the page URL', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));
    store.addCapturedRequest(makeRequest('PATCH', '/api/other-shop/suites/5', 200));

    const scoped = store.getWriteRequestsForScope('/projects/alpha-shop/suites');

    expect(scoped).toHaveLength(1);
    expect(scoped[0].path).toBe('/api/alpha-shop/suites');
  });

  it('ignores id-shaped page segments when choosing the scope', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));
    store.addCapturedRequest(makeRequest('PATCH', '/api/alpha-shop/runs/8471', 200));

    const scoped = store.getWriteRequestsForScope('/projects/alpha-shop/tests/8471');

    expect(scoped.map((r) => r.path)).toContain('/api/alpha-shop/suites');
  });

  it('keeps the scope when equally selective segments match the same writes', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));

    const scoped = store.getWriteRequestsForScope('/projects/alpha-shop/suites');

    expect(scoped).toHaveLength(2);
  });

  it('refuses to guess when equally selective segments match different writes', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/projects', 201));
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/tests', 201));

    expect(store.getWriteRequestsForScope('/projects/alpha-shop/suites')).toHaveLength(0);
  });

  it('returns nothing when the scope shares no segment with any write', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));

    expect(store.getWriteRequestsForScope('/dashboard')).toHaveLength(0);
  });

  it('returns all writes for the root scope', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));
    store.addCapturedRequest(makeRequest('POST', '/api/other-shop/labels', 201));

    expect(store.getWriteRequestsForScope('/')).toHaveLength(2);
  });

  it('deduplicates endpoint list lines by id pattern', () => {
    store.addCapturedRequest(makeRequest('PATCH', '/api/suites/1a2b3c4d', 200));
    store.addCapturedRequest(makeRequest('PATCH', '/api/suites/9f8e7d6c', 200));

    expect(store.toEndpointList()).toBe('PATCH /api/suites/{id}');
  });

  it('scopes the endpoint list when a scope path is given', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));
    store.addCapturedRequest(makeRequest('POST', '/api/other-shop/suites', 201));

    expect(store.toEndpointList('/projects/alpha-shop')).toBe('POST /api/alpha-shop/suites');
  });

  it('keeps version segments literal in the endpoint list', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/v1/suites', 201));

    expect(store.toEndpointList()).toBe('POST /api/v1/suites');
  });
});

describe('RequestStore loadFromDisk', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'reqstore-'));
  });

  afterEach(() => {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  });

  it('loads only browser-captured requests from disk', () => {
    makeRequest('POST', '/api/suites', 201, 'xhr_001_POST_api_suites').save(outputDir);
    makeRequest('POST', '/api/suites', 400, '001_POST_api_suites').save(outputDir);

    const fresh = new RequestStore(outputDir);
    fresh.loadFromDisk();

    expect(fresh.getCapturedRequests()).toHaveLength(1);
    expect(fresh.getCapturedRequests()[0].id).toBe('xhr_001_POST_api_suites');
  });
});

describe('extractAuthHeaders session gating', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'reqstore-'));
  });

  afterEach(() => {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  });

  it('ignores auth headers from captures of previous sessions', () => {
    const stale = makeRequest('DELETE', '/api/old-project/suites', 200, 'xhr_033_DELETE_api_old', { 'x-csrf-token': 'stale-token' });
    stale.timestamp = new Date('2026-07-07');
    stale.save(outputDir);

    const store = new RequestStore(outputDir);
    store.loadFromDisk();

    expect(store.extractAuthHeaders()).toEqual({});
  });

  it('returns auth headers from captures made during this session', () => {
    const store = new RequestStore(outputDir);
    store.addCapturedRequest(makeRequest('POST', '/api/suites', 201, undefined, { authorization: 'Bearer live', 'x-csrf-token': 'live-token' }));

    expect(store.extractAuthHeaders()).toEqual({ authorization: 'Bearer live', 'x-csrf-token': 'live-token' });
  });

  it('never returns cookie headers from captures', () => {
    const store = new RequestStore(outputDir);
    store.addCapturedRequest(makeRequest('POST', '/api/suites', 201, undefined, { cookie: 'session=captured', 'x-csrf-token': 'live-token' }));

    expect(store.extractAuthHeaders()).toEqual({ 'x-csrf-token': 'live-token' });
  });

  it('prefers the newest session capture when values differ', () => {
    const store = new RequestStore(outputDir);
    const older = makeRequest('POST', '/api/suites', 201, undefined, { 'x-csrf-token': 'first' });
    older.timestamp = new Date(Date.now() + 1000);
    const newer = makeRequest('POST', '/api/tests', 201, undefined, { 'x-csrf-token': 'second' });
    newer.timestamp = new Date(Date.now() + 2000);
    store.addCapturedRequest(older);
    store.addCapturedRequest(newer);

    expect(store.extractAuthHeaders()).toEqual({ 'x-csrf-token': 'second' });
  });

  it('resolves a same-id collision between a stale disk file and a live capture', () => {
    const stale = makeRequest('POST', '/api/suites', 201, 'xhr_001_POST_api_suites', { 'x-csrf-token': 'stale-token' });
    stale.timestamp = new Date('2026-07-07');
    stale.save(outputDir);

    const store = new RequestStore(outputDir);
    store.loadFromDisk();
    store.addCapturedRequest(makeRequest('POST', '/api/suites', 201, 'xhr_001_POST_api_suites', { 'x-csrf-token': 'live-token' }));

    expect(store.extractAuthHeaders()).toEqual({ 'x-csrf-token': 'live-token' });
  });

  it('treats a capture file without a timestamp as stale', () => {
    const requestsDir = join(outputDir, 'requests');
    mkdirSync(requestsDir, { recursive: true });
    writeFileSync(join(requestsDir, 'xhr_002_POST_api_x.request.yaml'), '---\nmethod: POST\nurl: /api/x\nfullUrl: /api/x\nheaders:\n  x-csrf-token: orphan\nstatus: 200\nstatusText: OK\nresponseHeaders:\n---\n', 'utf8');

    const store = new RequestStore(outputDir);
    store.loadFromDisk();

    expect(store.extractAuthHeaders()).toEqual({});
  });
});
