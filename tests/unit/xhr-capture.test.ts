import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RequestStore } from '../../src/api/request-store.ts';
import { XhrCapture } from '../../src/api/xhr-capture.ts';

function fakeResponse(opts: { method: string; url: string; status: number; contentType?: string; body?: string }) {
  return {
    request: () => ({
      resourceType: () => 'xhr',
      method: () => opts.method,
      url: () => opts.url,
      headers: () => ({ authorization: 'Bearer live' }),
      postData: () => undefined,
    }),
    status: () => opts.status,
    statusText: () => String(opts.status),
    headers: () => ({ 'content-type': opts.contentType ?? 'application/json' }),
    text: async () => opts.body ?? '{}',
  };
}

describe('XhrCapture read endpoints', () => {
  let outputDir: string;
  let store: RequestStore;
  let deliver: (response: any) => Promise<void>;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'xhr-'));
    store = new RequestStore(outputDir);
    const capture = new XhrCapture(store, 'https://app.test');
    capture.attach({
      on: (_event: string, handler: any) => {
        deliver = handler;
      },
    });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('records a successful JSON GET as a read endpoint without its body', async () => {
    await deliver(fakeResponse({ method: 'GET', url: 'https://app.test/api/labels?page=1', status: 200 }));

    const captured = store.getCapturedRequests();
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('GET');
    expect(captured[0].fullUrl).toBe('/api/labels?page=1');
    expect(captured[0].rawResponseBody).toBe('');
  });

  it('ignores a GET that did not return 200', async () => {
    await deliver(fakeResponse({ method: 'GET', url: 'https://app.test/api/labels', status: 404 }));

    expect(store.getCapturedRequests()).toHaveLength(0);
    expect(store.getFailedRequests()).toHaveLength(1);
  });

  it('ignores a GET that did not return JSON', async () => {
    await deliver(fakeResponse({ method: 'GET', url: 'https://app.test/api/labels', status: 200, contentType: 'text/html' }));

    expect(store.getCapturedRequests()).toHaveLength(0);
  });

  it('still captures a write with its response body', async () => {
    await deliver(fakeResponse({ method: 'POST', url: 'https://app.test/api/labels', status: 201, body: '{"id":1}' }));

    const captured = store.getCapturedRequests();
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].rawResponseBody).toBe('{"id":1}');
  });
});
