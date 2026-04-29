import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestResult } from '../../src/api/request-result.js';
import { RequestStore } from '../../src/api/request-store.js';

let counter = 0;
function makeRequest(method: string, path: string, status: number): RequestResult {
  counter++;
  return new RequestResult({
    id: `req_${counter}`,
    method,
    path,
    fullUrl: path,
    requestHeaders: {},
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
