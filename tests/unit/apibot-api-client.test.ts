import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ApiClient } from '../../boat/api-tester/src/api-client.ts';

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
}

describe('ApiClient request defaults', () => {
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let seen: Seen[] = [];

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(req.headers), body: await req.text() });
        return Response.json({ ok: true });
      },
    });
    origin = server.url.origin;
  });

  afterAll(() => {
    server.stop(true);
  });

  beforeEach(() => {
    seen = [];
  });

  it('applies the defaults of every pattern the path matches', async () => {
    const client = new ApiClient(origin, {});
    client.addRequestDefaults({ pattern: '*', headers: { Authorization: 'Bearer all' }, query: {}, body: {} });
    client.addRequestDefaults({ pattern: '/notes/*', headers: { 'X-Workspace': 'demo' }, query: { workspace: 'demo' }, body: { workspace_id: 42 } });

    const result = await client.request({ method: 'POST', path: '/notes/1', body: { title: 'Groceries' } });
    await client.request({ method: 'GET', path: '/users' });

    expect(seen[0].headers.authorization).toBe('Bearer all');
    expect(seen[0].headers['x-workspace']).toBe('demo');
    expect(seen[0].query).toEqual({ workspace: 'demo' });
    expect(JSON.parse(seen[0].body)).toEqual({ title: 'Groceries', workspace_id: 42 });
    expect(result.requestBody).toEqual({ title: 'Groceries', workspace_id: 42 });

    expect(seen[1].headers.authorization).toBe('Bearer all');
    expect(seen[1].headers['x-workspace']).toBeUndefined();
    expect(seen[1].query).toEqual({});
  });

  it('lets configured headers and the request itself override knowledge defaults', async () => {
    const client = new ApiClient(origin, { Authorization: 'Bearer config' });
    client.addRequestDefaults({ pattern: '*', headers: { Authorization: 'Bearer knowledge', 'X-Trace': 'knowledge' }, query: { page: '1' }, body: { title: 'Untitled', workspace_id: 42 } });

    await client.request({ method: 'PATCH', path: '/notes/1', headers: { 'X-Trace': 'request' }, queryParams: { page: '2' }, body: { title: 'Mine' } });

    expect(seen[0].headers.authorization).toBe('Bearer config');
    expect(seen[0].headers['x-trace']).toBe('request');
    expect(seen[0].query).toEqual({ page: '2' });
    expect(JSON.parse(seen[0].body)).toEqual({ title: 'Mine', workspace_id: 42 });
  });

  it('overrides knowledge headers whose name differs only in case', async () => {
    const client = new ApiClient(origin, { authorization: 'Bearer config' });
    client.addRequestDefaults({ pattern: '*', headers: { Authorization: 'Bearer knowledge', 'X-Trace': 'knowledge' }, query: {}, body: {} });
    client.addRequestDefaults({ pattern: '*', headers: { 'x-trace': 'later-knowledge' }, query: {}, body: {} });

    await client.request({ method: 'GET', path: '/notes' });
    await client.request({ method: 'GET', path: '/notes', headers: { 'X-TRACE': 'request' } });

    expect(seen[0].headers.authorization).toBe('Bearer config');
    expect(seen[0].headers['x-trace']).toBe('later-knowledge');
    expect(seen[1].headers['x-trace']).toBe('request');
  });

  it('fills body fields only into JSON object bodies of writing methods', async () => {
    const client = new ApiClient(origin, {});
    client.addRequestDefaults({ pattern: '*', headers: {}, query: {}, body: { workspace_id: 42 } });

    await client.request({ method: 'DELETE', path: '/notes/1', body: { reason: 'duplicate' } });
    await client.request({ method: 'POST', path: '/notes', body: 'raw text' });
    await client.request({ method: 'PUT', path: '/notes/1', body: [{ title: 'A' }] });

    expect(JSON.parse(seen[0].body)).toEqual({ reason: 'duplicate' });
    expect(seen[1].body).toBe('raw text');
    expect(JSON.parse(seen[2].body)).toEqual([{ title: 'A' }]);
  });
});
