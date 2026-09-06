# Fisherman queryApi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pilot can ask Fisherman what data already exists — at any point in a test run, not only as a precondition at the start — through a read-only `queryApi(question)` tool that answers in prose from real GET responses.

**Architecture:** Four layers change. `XhrCapture` starts recording successful GET requests as endpoint-only entries (path + query params, no response body), so replicate mode knows read endpoints at all. `RequestStore` deduplicates those structurally and gains a read/write family parameter on its scoping and endpoint-list methods. `createFishermanTools` gains a `readOnly` flag that narrows the `request` method enum to `GET`, returns a truncated response body for the model to quote, and swaps `finish`'s schema to `{ answer }`. `Fisherman` gains `lookupData()` next to `prepareData()`, both driving one extracted `runSession()` loop. `Pilot` exposes `queryApi` beside `precondition` from the same builder, which `sendToPilot` already spreads into planning, new-page review and progress analysis.

**Tech Stack:** Bun, TypeScript, Zod (tool schemas), Vercel AI SDK `tool()`, bun:test, `@copilotkit/aimock` for agent integration tests.

**Spec:** None — design was settled in the brainstorming session of 2026-09-03 and is captured in the Design Decisions section below.

## Global Constraints

- Bun only — never Node.js. Run tests with `bun test`.
- Work in the worktree `/home/davert/projects/explorbot-fisherman-fetch`, branch `fisherman-fetch` (branched from `main`).
- No code comments unless explicitly requested.
- No ternary operators. No `...(cond ? {k: v} : {})` spread. Premature exit over if/else.
- Private methods go after public methods. Types go at the end of the file.
- Prompts must be general — never encode an example from a debug session or a specific site into a prompt, rule or tool description.
- Never hardcode locators, site names, or field names into source.
- Run `bun run format` after each code change, before each commit.
- Run `bun test tests/integration/` before any commit that touches a prompt, rule, tool schema or system message.
- NEVER trigger the regression CI workflow (no `regression` label, no `gh workflow run regression.yml`). Only the user does that.

## Design Decisions

Settled with the user before this plan was written. An implementer who disagrees should raise it, not silently deviate.

1. **GET capture is endpoint-only.** Successful (`200`) GET XHRs are recorded with their path and query string but **no response body**. The model figures out shapes from live responses at lookup time; storing bodies for every list fetch on every page load would flood `output/requests/`.
2. **The answer is prose, not a structured item list.** `lookupData` returns the model's own sentence quoting concrete names and ids. This is why the read-mode `request` tool must return a truncated raw body — without it the model has nothing real to quote.
3. **Read-only is a schema guarantee, not a prompt rule.** In `readOnly` mode the `request` tool's `method` enum contains only `GET`. A prompt instruction would be a soft constraint; a Zod enum is a hard one.
4. **`prepareData` keeps seeing GET endpoints in achieve mode.** Only the *read* family filters the OpenAPI list down to `GET`. Write preparation legitimately needs a GET to find a parent id, and today's behaviour must not regress.
5. **The tool is called `queryApi`.** `precondition` creates, `queryApi` reads. Naming the mechanism keeps the model from confusing it with the page-facing `verify` tool.
6. **A lookup produces a note, never a step.** Steps become generated CodeceptJS; an API read is not a UI action and must not leak into a generated test.

Out of scope: giving Tester the tool, caching repeated lookups within a test, and replacing the vision-based `checkDataAvailability` fallback with a lookup.

---

### Task 1: Record successful GET endpoints

**Files:**
- Modify: `src/api/request-result.ts:126` (the `writeFileSync` of the response file at the end of `save`)
- Modify: `src/api/request-store.ts:8-18` (new field), `src/api/request-store.ts:20-23` (near `addCapturedRequest`), `src/api/request-store.ts:143-159` (`loadFromDisk`), file bottom (new helper)
- Modify: `src/api/xhr-capture.ts:33-63` (`captureResponse`), plus a new private method after it
- Test: `tests/unit/request-store.test.ts`, and create `tests/unit/xhr-capture.test.ts`

**Interfaces:**
- Consumes: existing `RequestResult` (`method`, `path`, `fullUrl`, `requestHeaders`, `status`, `isWrite`, `rawResponseBodyValue` setter, `save(outputDir)`), `generateRequestId(method, path, prefix)`, the module-private `normalizePathPattern(urlPath)` already at the bottom of `request-store.ts`.
- Produces: `RequestStore.addReadRequest(result: RequestResult): void` — stores a non-write capture only when its `METHOD + normalized path + sorted query-param names` key has not been seen, then persists it. Task 2 relies on read captures living in the same `capturedRequests` array as writes, distinguished only by `isWrite`.

- [ ] **Step 1: Write the failing tests**

Add this describe block at the end of `tests/unit/request-store.test.ts`. It reuses the file's existing `makeRequest` helper and adds a GET-specific one, because `makeRequest` sets `fullUrl` to the path with no query string.

```ts
describe('read endpoint capture', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = mkdtempSync(join(tmpdir(), 'reqstore-read-'));
  });

  afterEach(() => {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  });

  function makeGet(urlPath: string, search = '', id?: string): RequestResult {
    return new RequestResult({
      id: id || `get_${urlPath}${search}`,
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
  }

  it('keeps one entry when the same read endpoint is fetched repeatedly', () => {
    const store = new RequestStore(outputDir);

    store.addReadRequest(makeGet('/api/alpha-shop/labels', '', 'g1'));
    store.addReadRequest(makeGet('/api/alpha-shop/labels', '', 'g2'));
    store.addReadRequest(makeGet('/api/alpha-shop/labels', '', 'g3'));

    expect(store.getCapturedRequests()).toHaveLength(1);
  });

  it('collapses dynamic path segments into one entry', () => {
    const store = new RequestStore(outputDir);

    store.addReadRequest(makeGet('/api/labels/8471', '', 'g1'));
    store.addReadRequest(makeGet('/api/labels/9382', '', 'g2'));

    expect(store.getCapturedRequests()).toHaveLength(1);
  });

  it('keeps variants that differ by query parameter names', () => {
    const store = new RequestStore(outputDir);

    store.addReadRequest(makeGet('/api/alpha-shop/tests', '', 'g1'));
    store.addReadRequest(makeGet('/api/alpha-shop/tests', '?label=bug', 'g2'));
    store.addReadRequest(makeGet('/api/alpha-shop/tests', '?label=urgent', 'g3'));

    expect(store.getCapturedRequests()).toHaveLength(2);
  });

  it('does not write a response file for a bodiless capture', () => {
    const store = new RequestStore(outputDir);

    store.addReadRequest(makeGet('/api/alpha-shop/labels', '', 'g1'));

    expect(existsSync(join(outputDir, 'requests', 'g1.request.yaml'))).toBe(true);
    expect(existsSync(join(outputDir, 'requests', 'g1.response.json'))).toBe(false);
  });
});
```

Check the top of the file first: it must import `mkdtempSync`, `rmSync`, `existsSync` from `node:fs`, `tmpdir` from `node:os` and `join` from `node:path`. The existing `loadFromDisk` describe block already uses these, so add only what is missing.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /home/davert/projects/explorbot-fisherman-fetch
bun test tests/unit/request-store.test.ts
```

Expected: FAIL — `store.addReadRequest is not a function`.

- [ ] **Step 3: Stop writing an empty response file**

In `src/api/request-result.ts`, the last two lines of `save()` currently read:

```ts
    writeFileSync(this.requestFile, yaml, 'utf8');
    writeFileSync(this.responseFile, this._rawResponseBody || '', 'utf8');
```

Replace with:

```ts
    writeFileSync(this.requestFile, yaml, 'utf8');
    if (!this._rawResponseBody) return;
    writeFileSync(this.responseFile, this._rawResponseBody, 'utf8');
```

The `rawResponseBody` getter already returns `''` when `responseFile` does not exist, so readers are unaffected.

- [ ] **Step 4: Add `addReadRequest` to RequestStore**

In `src/api/request-store.ts`, add a field beside the existing ones near the top of the class:

```ts
  private readEndpointKeys = new Set<string>();
```

Add this public method directly after `addCapturedRequest`:

```ts
  addReadRequest(result: RequestResult): void {
    const key = readEndpointKey(result);
    if (this.readEndpointKeys.has(key)) return;
    this.readEndpointKeys.add(key);
    this.capturedRequests.push(result);
    result.save(this.outputDir);
  }
```

Add this helper next to `normalizePathPattern` at the bottom of the file:

```ts
function readEndpointKey(result: RequestResult): string {
  const query = result.fullUrl.split('?')[1] || '';
  const names = [...new Set(new URLSearchParams(query).keys())].sort().join(',');
  return `${result.method} ${normalizePathPattern(result.path)}?${names}`;
}
```

In `loadFromDisk`, register keys for read entries restored from disk so a second session does not re-add them. The loop body currently ends with `this.capturedRequests.push(result);` — add one line after it:

```ts
        this.capturedRequests.push(result);
        if (!result.isWrite) this.readEndpointKeys.add(readEndpointKey(result));
```

Also clear the set in `clear()`, beside the three array resets:

```ts
    this.readEndpointKeys.clear();
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
bun test tests/unit/request-store.test.ts
```

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 6: Write the failing XhrCapture tests**

Create `tests/unit/xhr-capture.test.ts`. `attach(page)` only registers a handler on `page.on('response', …)`, so a two-line fake page is enough to drive the real capture path:

```ts
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
```

- [ ] **Step 7: Run the tests to verify they fail**

```bash
bun test tests/unit/xhr-capture.test.ts
```

Expected: the two GET tests FAIL (nothing is captured); the 404 test and the write test already PASS.

- [ ] **Step 8: Capture GETs in XhrCapture**

In `src/api/xhr-capture.ts`, `captureResponse` currently drops every non-write before the content-type check. The failed-request block must stay first so non-JSON failures keep being recorded. Replace the section from `if (!WRITE_METHODS.has(method)) return;` through `if (status === 304) return;` — including the `const contentType` and `JSON_CONTENT_TYPES` lines sitting between them — with:

```ts
    const contentType = response.headers()['content-type'] || '';
    if (!JSON_CONTENT_TYPES.test(contentType)) return;

    if (method === 'GET') {
      if (status !== 200) return;
      this.captureReadEndpoint(request, response);
      return;
    }

    if (!WRITE_METHODS.has(method)) return;

    if (status === 304) return;
```

Add this private method after `captureResponse`:

```ts
  private captureReadEndpoint(request: any, response: any): void {
    const parsedUrl = new URL(request.url());

    const requestHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.headers())) {
      requestHeaders[k] = String(v);
    }

    const result = new RequestResult({
      id: generateRequestId('GET', parsedUrl.pathname, 'xhr_'),
      method: 'GET',
      path: parsedUrl.pathname,
      fullUrl: parsedUrl.pathname + parsedUrl.search,
      requestHeaders,
      status: response.status(),
      statusText: response.statusText(),
      responseHeaders: {},
      timing: 0,
      timestamp: new Date(),
    });
    result.rawResponseBodyValue = '';

    this.store.addReadRequest(result);
  }
```

- [ ] **Step 9: Run the whole unit suite**

```bash
bun run format
bun test tests/unit/
```

Expected: PASS. `request-result.test.ts` and `request-store.test.ts` in particular must be green — the `save()` change touches every persisted request.

- [ ] **Step 10: Commit**

```bash
git add src/api/request-result.ts src/api/request-store.ts src/api/xhr-capture.ts tests/unit/request-store.test.ts tests/unit/xhr-capture.test.ts
git commit -m "feat: record successful GET endpoints as read captures"
```

---

### Task 2: Read and write endpoint families in RequestStore

**Files:**
- Modify: `src/api/request-store.ts:82-97` (`toEndpointList`), `src/api/request-store.ts:161-186` (`getWriteRequestsForScope`), file bottom (helpers and the `EndpointFamily` type)
- Test: `tests/unit/request-store.test.ts`

**Interfaces:**
- Consumes: `RequestStore.addReadRequest` and the read captures from Task 1; `RequestResult.isWrite`.
- Produces:
  - `export type EndpointFamily = 'read' | 'write';` exported from `src/api/request-store.ts`.
  - `RequestStore.toEndpointList(scopePath?: string, methods: EndpointFamily = 'write'): string` — one line per distinct endpoint. Write lines keep today's exact `METHOD /normalized/path` shape. Read lines append ` ?name1,name2` when the capture carried query parameters.
  - `RequestStore.getReadRequestsForScope(scopePath: string): RequestResult[]` — the read counterpart of `getWriteRequestsForScope`, same scoping heuristic.
  - `getWriteRequestsForScope` keeps its exact signature and behaviour. Task 4 calls `toEndpointList` with both families.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('read endpoint capture')` block added in Task 1, reusing its `makeGet` helper:

```ts
  it('lists read endpoints with their query parameter names, not values', () => {
    const store = new RequestStore(outputDir);

    store.addReadRequest(makeGet('/api/alpha-shop/tests', '?label=bug&page=2', 'g1'));

    expect(store.toEndpointList(undefined, 'read')).toBe('GET /api/alpha-shop/tests ?label,page');
  });

  it('keeps read endpoints out of the write list and writes out of the read list', () => {
    const store = new RequestStore(outputDir);

    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));
    store.addReadRequest(makeGet('/api/alpha-shop/labels', '', 'g1'));

    expect(store.toEndpointList()).toBe('POST /api/alpha-shop/suites');
    expect(store.toEndpointList(undefined, 'read')).toBe('GET /api/alpha-shop/labels');
  });

  it('scopes read endpoints the same way write endpoints are scoped', () => {
    const store = new RequestStore(outputDir);

    store.addReadRequest(makeGet('/api/alpha-shop/labels', '', 'g1'));
    store.addReadRequest(makeGet('/api/other-shop/labels', '', 'g2'));

    const scoped = store.getReadRequestsForScope('/projects/alpha-shop/tests');

    expect(scoped).toHaveLength(1);
    expect(scoped[0].path).toBe('/api/alpha-shop/labels');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/unit/request-store.test.ts
```

Expected: FAIL — `store.getReadRequestsForScope is not a function`, and `toEndpointList` ignores its second argument.

- [ ] **Step 3: Make `toEndpointList` family-aware**

Replace `toEndpointList` in `src/api/request-store.ts` with:

```ts
  toEndpointList(scopePath?: string, methods: EndpointFamily = 'write'): string {
    let requests = this.capturedRequests.filter((r) => matchesFamily(r, methods));
    if (scopePath) requests = this.getRequestsForScope(scopePath, methods);

    const seen = new Set<string>();
    const lines: string[] = [];

    for (const req of requests) {
      const line = `${req.method} ${normalizePathPattern(req.path)}${queryParamHint(req)}`;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }

    return lines.join('\n');
  }
```

- [ ] **Step 4: Split the scoping heuristic across both families**

Replace `getWriteRequestsForScope` with two thin public methods, and move its body into one private method placed at the end of the class (after `clear()`), so private methods stay below public ones:

```ts
  getWriteRequestsForScope(scopePath: string): RequestResult[] {
    return this.getRequestsForScope(scopePath, 'write');
  }

  getReadRequestsForScope(scopePath: string): RequestResult[] {
    return this.getRequestsForScope(scopePath, 'read');
  }
```

```ts
  private getRequestsForScope(scopePath: string, methods: EndpointFamily): RequestResult[] {
    const candidates = this.capturedRequests.filter((r) => matchesFamily(r, methods));
    const scopeSegments = scopePath.split('/').filter(Boolean);
    if (scopeSegments.length === 0) return candidates;

    let scoped: RequestResult[] = [];
    let fewest = Number.POSITIVE_INFINITY;
    let ambiguous = false;
    for (const segment of scopeSegments) {
      if (isDynamicSegment(segment)) continue;
      const matches = candidates.filter((r) => r.path.split('/').includes(segment));
      if (matches.length === 0 || matches.length > fewest) continue;
      if (matches.length === fewest) {
        if (!scoped.every((r, i) => r.id === matches[i].id)) ambiguous = true;
        continue;
      }
      scoped = matches;
      fewest = matches.length;
      ambiguous = false;
    }
    if (ambiguous) return [];

    return scoped;
  }
```

The old local `const writeMethods = new Set([...])` line goes away — `matchesFamily` owns that knowledge now.

- [ ] **Step 5: Add the helpers and the type**

Beside `normalizePathPattern` and `readEndpointKey` at the bottom of `src/api/request-store.ts`:

```ts
function matchesFamily(result: RequestResult, methods: EndpointFamily): boolean {
  if (methods === 'write') return result.isWrite;
  return result.method === 'GET';
}

function queryParamHint(result: RequestResult): string {
  if (result.isWrite) return '';
  const query = result.fullUrl.split('?')[1];
  if (!query) return '';
  const names = [...new Set(new URLSearchParams(query).keys())].sort();
  if (names.length === 0) return '';
  return ` ?${names.join(',')}`;
}
```

At the very end of the file:

```ts
export type EndpointFamily = 'read' | 'write';
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
bun run format
bun test tests/unit/request-store.test.ts
```

Expected: PASS. The pre-existing assertions `toEndpointList()` → `'PATCH /api/suites/{id}'` and `toEndpointList('/projects/alpha-shop')` → `'POST /api/alpha-shop/suites'` must still hold — the `'write'` default preserves them.

- [ ] **Step 7: Commit**

```bash
git add src/api/request-store.ts tests/unit/request-store.test.ts
git commit -m "feat: split read and write endpoint families in RequestStore"
```

---

### Task 3: Read-only mode for Fisherman tools

**Files:**
- Modify: `src/ai/fisherman-tools.ts` — the `createFishermanTools` signature, the `request` and `getEndpointSpec` method enums, the `request` success return, a second `finish` tool, and `synthesizeResult`
- Test: `tests/unit/fisherman-tools.test.ts`

**Interfaces:**
- Consumes: `ApiClient.request`, `RequestStore.getMadeRequests` / `addMadeRequest`, `RequestResult.isWrite` / `status` / `error` / `rawResponseBody`.
- Produces: `createFishermanTools(apiClient, requestStore, opts: { spec?: any; baseEndpoint?: string; readOnly?: boolean })`. With `readOnly: true`:
  - `tools.request` accepts only `method: 'GET'` and returns `{ success, status, extracted, bodyPreview }` on 2xx, where `bodyPreview` is the raw body truncated to 2000 characters.
  - `tools.finish` takes `{ answer: string }` and succeeds when at least one successful GET was made in this run, producing `{ success: true, summary: answer, created: [], failed: [] }`.
  - `getResult()` / `finishFromText()` measure success against successful GETs instead of successful writes, and never populate `created`.
  - The returned object's type is `Record<string, any>` so both `finish` shapes fit. Task 4 passes it straight to `provider.invokeConversation`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/fisherman-tools.test.ts`. It needs a read counterpart to the file's existing `madeWrite` helper — add `madeRead` beside it at the bottom of the file:

```ts
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
```

Add this describe block at the end of the file:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/unit/fisherman-tools.test.ts
```

Expected: FAIL — the `request` tool still lists all five methods and `finish` still demands `created`.

The first test reaches into `tools.request.inputSchema.shape.method.options`, which assumes the AI SDK leaves the Zod object unwrapped on `inputSchema`. If it fails for that reason rather than for the enum's contents, assert on the serialized schema instead: `expect(JSON.stringify(tools.request.inputSchema)).not.toContain('DELETE')`.

- [ ] **Step 3: Thread the flag and the success predicate through the factory**

In `src/ai/fisherman-tools.ts`, widen the signature and derive the mode-dependent pieces at the top of the function:

```ts
export function createFishermanTools(apiClient: ApiClient, requestStore: RequestStore, opts: { spec?: any; baseEndpoint?: string; readOnly?: boolean }) {
  const readOnly = opts.readOnly === true;
  let finished = false;
  let result: FishermanResult | null = null;
  const ledgerStart = requestStore.getMadeRequests().length;

  let allowedMethods: string[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  if (readOnly) allowedMethods = ['GET'];

  const runRequests = () => requestStore.getMadeRequests().slice(ledgerStart);
  const successfulWrites = () => runRequests().filter((r) => r.isWrite && !r.error && r.status >= 200 && r.status < 400);
  const successfulReads = () => runRequests().filter((r) => !r.isWrite && !r.error && r.status >= 200 && r.status < 400);
  const succeeded = () => {
    if (readOnly) return successfulReads();
    return successfulWrites();
  };
  const getResult = () => result ?? synthesizeResult(runRequests(), succeeded(), false, readOnly);
  const isFinished = () => finished;
  const finishFromText = (text?: string) => {
    finished = true;
    const synthesized = synthesizeResult(runRequests(), succeeded(), true, readOnly);
    if (text && synthesized.success) synthesized.summary = text;
    result = synthesized;
  };
```

Use `allowedMethods` in both schemas. In `getEndpointSpec` and `request`, replace `z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])` with:

```ts
        method: z.enum(allowedMethods as [string, ...string[]]).describe('HTTP method'),
```

- [ ] **Step 4: Return a body preview in read mode**

In the `request` tool's `execute`, replace the 2xx return block:

```ts
        const extracted = extractKeyFields(reqResult.responseBody);
        tag('success').log(`Fisherman: ${input.method} ${input.path} > ${statusLine}`);
        const output: Record<string, any> = {
          success: true,
          status: reqResult.status,
          extracted,
        };
        if (readOnly) output.bodyPreview = reqResult.rawResponseBody.substring(0, BODY_PREVIEW_LIMIT);
        return output;
```

Add the constant next to the other module constants at the top of the file:

```ts
const BODY_PREVIEW_LIMIT = 2000;
```

- [ ] **Step 5: Add the read-mode finish and select between the two**

Keep the existing `finish` tool exactly as it is, but bind it to a name. Change `const tools = {` into named consts so both finish shapes can be built, then assemble:

```ts
  const finishWrite = tool({
    // the existing finish tool, unchanged, except its guard now reads:
    //   const writes = succeeded();
  });

  const finishRead = tool({
    description: 'Report the answer to the question. Call when the requests have shown what exists.',
    inputSchema: z.object({
      answer: z.string().describe('What the data shows, quoting the concrete names, titles and ids that were returned'),
    }),
    execute: async ({ answer }) => {
      if (succeeded().length === 0) {
        tag('warning').log('Fisherman: finish rejected — no successful request in this run');
        return { finished: false, error: 'No successful request was made in this run, so nothing was read. Keep working, or call stop if the question cannot be answered.' };
      }

      tag('success').log(`Fisherman answered: ${answer}`);
      finished = true;
      result = { success: true, summary: answer, created: [], failed: [] };
      return { finished: true };
    },
  });

  const tools: Record<string, any> = { getEndpointSpec, request, finish: finishWrite, stop };
  if (readOnly) tools.finish = finishRead;

  return { tools, getResult, isFinished, finishFromText };
```

Extract `getEndpointSpec`, `request` and `stop` from the current object literal into `const` declarations above this block, unchanged apart from the enum edit in Step 3 and the preview in Step 4. Inside `finishWrite`, the line `const writes = successfulWrites();` becomes `const writes = succeeded();` so the two paths share one predicate — in write mode the two are identical.

- [ ] **Step 6: Make `synthesizeResult` family-aware**

```ts
function synthesizeResult(made: RequestResult[], succeeded: RequestResult[], declaredDone: boolean, readOnly: boolean): FishermanResult {
  const failures = made.filter((r) => r.status >= 400 || r.error);
  let summary = `Stopped before finishing: ${made.length} requests, ${succeeded.length} successful, ${failures.length} failed`;
  const lastFailure = failures[failures.length - 1];
  if (lastFailure) summary += `; last failure: ${lastFailure.toSummary()}`;

  const result: FishermanResult = { success: declaredDone && succeeded.length > 0, summary, created: [], failed: [] };
  if (!readOnly) result.created = succeeded.map(toCreatedItem);
  return result;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
bun run format
bun test tests/unit/fisherman-tools.test.ts
```

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 8: Commit**

```bash
git add src/ai/fisherman-tools.ts tests/unit/fisherman-tools.test.ts
git commit -m "feat: add read-only mode to Fisherman tools"
```

---

### Task 4: Fisherman.lookupData and the shared session loop

**Files:**
- Modify: `src/ai/fisherman.ts` — extract `runSession`, add `lookupData` and `buildLookupSystemPrompt`, make `buildEndpointList` family-aware, drop the `mode = 'disabled'` mutation in `prepareData`
- Test: `tests/integration/fisherman.test.ts`

**Interfaces:**
- Consumes: `createFishermanTools(..., { readOnly: true })` from Task 3; `RequestStore.toEndpointList(scopePath, methods)` from Task 2; existing `Provider.startConversation` / `invokeConversation`, `loop` from `src/utils/loop.ts`, `listAllEndpoints` from `src/api/spec-reader.ts`.
- Produces: `Fisherman.lookupData(question: string, scopeUrl?: string, sessionName?: string): Promise<FishermanResult>` — on success `summary` holds the model's prose answer and `created` is empty. Task 5's Pilot tool calls exactly this signature.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/fisherman.test.ts`, reusing its `requestResult`, `toolCall`, `extractPromptText` helpers and the `createFisherman` factory:

```ts
  it('answers a question from a read endpoint and never offers a write method', async () => {
    const labels = requestResult('made_read_1', 'GET', '/api/alpha-shop/labels', 200);
    labels.rawResponseBodyValue = JSON.stringify([{ id: 1, name: 'Bug' }, { id: 2, name: 'Urgent' }]);
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

  it('reports honestly when no read endpoint is known', async () => {
    const result = await createFisherman().lookupData('which labels exist?', '/projects/alpha-shop/tests');

    expect(result.success).toBe(false);
    expect(mock.getRequests()).toHaveLength(0);
  });

  it('stays available after preparing data found no write endpoints', async () => {
    requestStore = new RequestStore(outputDir);
    requestStore.addReadRequest(readResult('xhr_200_GET_api_alpha-shop_labels', '/api/alpha-shop/labels'));

    const fisherman = createFisherman();
    const result = await fisherman.prepareData('1 label', '/projects/alpha-shop/tests');

    expect(result.success).toBe(false);
    expect(fisherman.isAvailable()).toBe(true);
    expect(mock.getRequests()).toHaveLength(0);
  });
```

The third test reassigns `requestStore` before `createFisherman()` reads it, so the two POST captures the `beforeEach` seeds are out of the way and the write endpoint list really is empty — which is what the removed `this.mode = 'disabled'` mutation used to poison.

Add this helper next to `requestResult` at the top of the file:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/integration/fisherman.test.ts
```

Expected: FAIL — `fisherman.lookupData is not a function`.

- [ ] **Step 3: Extract the session loop**

In `src/ai/fisherman.ts`, add `import type { Conversation } from './conversation.ts';` to the imports.

Add this private method after the existing public methods, before `detectMode`:

```ts
  private async runSession(conversation: Conversation, tools: Record<string, any>, opts: { isFinished: () => boolean; finishFromText: (text?: string) => void; label: string }): Promise<void> {
    const ledgerStart = this.requestStore.getMadeRequests().length;

    await loop(
      async ({ stop, iteration }) => {
        debugLog(`iteration ${iteration}`);
        const invokeResult = await this.provider.invokeConversation(conversation, tools, {
          maxToolRoundtrips: MAX_TOOL_ROUNDTRIPS,
          agentName: 'fisherman',
        });
        debugLog(`iteration ${iteration} done, text: ${invokeResult?.response?.text?.slice(0, 200) || '(none)'}`);

        if (opts.isFinished()) {
          stop();
          return;
        }

        if (!invokeResult?.toolExecutions?.length) {
          debugLog('no tool call in this turn — treating as finish');
          opts.finishFromText(invokeResult?.response?.text);
          stop();
          return;
        }

        if (this.isStuckOnEndpoint(ledgerStart)) {
          tag('warning').log('Fisherman: repeated failures on the same endpoint — stopping');
          stop();
          return;
        }

        if (iteration >= MAX_ITERATIONS) {
          tag('warning').log('Fisherman: max iterations reached');
          stop();
        }
      },
      {
        maxAttempts: MAX_ITERATIONS,
        observability: {
          name: opts.label,
          agent: 'fisherman',
          sessionId: this.sessionName,
        },
        catch: async ({ error, stop }) => {
          debugLog(`error: ${error.message}`);
          tag('warning').log(`Fisherman error: ${error.message}`);
          stop();
        },
      }
    );
  }
```

In `prepareData`, delete the local `const ledgerStart = ...` line and the whole `await loop(...)` call, replacing them with:

```ts
    await this.runSession(conversation, tools, { isFinished, finishFromText, label: `fisherman: ${instructions.slice(0, 50)}` });
```

In the same method, drop the `this.mode = 'disabled';` line from the empty-endpoint-list branch, leaving:

```ts
    if (!endpointList) {
      tag('warning').log('Fisherman: no endpoints available');
      return { success: false, summary: 'No API endpoints available', created: [], failed: [] };
    }
```

- [ ] **Step 4: Make the endpoint list family-aware**

Replace `buildEndpointList`:

```ts
  private buildEndpointList(scopeUrl?: string, family: EndpointFamily = 'write'): string {
    this.scopeDegraded = false;
    if (this.mode === 'achieve' && this.spec) {
      let specEndpoints = listAllEndpoints(this.spec, this.baseEndpoint);
      if (family === 'read') specEndpoints = keepReadLines(specEndpoints);
      if (specEndpoints) return specEndpoints;
    }

    const scoped = this.requestStore.toEndpointList(scopeUrl || '/', family);
    if (scoped) return scoped;

    this.scopeDegraded = true;
    return this.requestStore.toEndpointList(undefined, family);
  }
```

Import the type — `import { type EndpointFamily, ... } from '../api/request-store.ts';` — noting `RequestStore` is currently imported there as a type-only import, so it becomes `import type { EndpointFamily, RequestStore } from '../api/request-store.ts';`.

Add this module function at the end of the file:

```ts
function keepReadLines(endpointList: string): string {
  return endpointList
    .split('\n')
    .filter((line) => line.startsWith('GET '))
    .join('\n');
}
```

`getEndpointList(scopeUrl?)` — the public method Planner calls — keeps calling `buildEndpointList(scopeUrl)` and so keeps returning write endpoints. Do not change it.

- [ ] **Step 5: Add `lookupData`**

Add this public method directly after `prepareData`:

```ts
  async lookupData(question: string, scopeUrl?: string, sessionName?: string): Promise<FishermanResult> {
    this.sessionName = sessionName;
    tag('info').log(`Fisherman [read]: ${question}`);

    await this.ensureReady(scopeUrl);

    if (this.mode === 'disabled') {
      debugLog('disabled — no data for scope');
      return { success: false, summary: 'No API data available for this scope', created: [], failed: [] };
    }

    const endpointList = this.buildEndpointList(scopeUrl, 'read');
    debugLog(`read endpoints:\n${endpointList || '(none)'}`);

    if (!endpointList) {
      tag('warning').log('Fisherman: no read endpoints available');
      return { success: false, summary: 'No read endpoints are known for this scope', created: [], failed: [] };
    }

    await this.refreshAuth();

    const { tools, getResult, isFinished, finishFromText } = createFishermanTools(this.apiClient, this.requestStore, {
      spec: this.spec,
      baseEndpoint: this.baseEndpoint,
      readOnly: true,
    });

    const conversation = this.provider.startConversation(this.buildLookupSystemPrompt(endpointList, Object.keys(tools), scopeUrl), 'fisherman');
    conversation.addUserText(dedent`
      Answer this question about data that already exists:

      ${question}

      Make the requests needed to answer it, then call finish with the answer.
      If the available endpoints cannot answer it, call stop with the reason.
    `);

    await this.runSession(conversation, tools, { isFinished, finishFromText, label: `fisherman lookup: ${question.slice(0, 50)}` });

    const result = getResult();
    tag('info').log(`Fisherman answer: ${result.summary}`);
    return result;
  }
```

- [ ] **Step 6: Add the lookup system prompt**

Add this private method after `buildSystemPrompt`:

```ts
  private buildLookupSystemPrompt(endpointList: string, toolNames: string[], scopeUrl?: string): string {
    let scopeBlock = '';
    if (scopeUrl) {
      scopeBlock = `\n\nSCOPE: You are answering about ${scopeUrl}.`;
      if (this.scopeDegraded) scopeBlock += '\nThe endpoint list could not be narrowed to this scope and may include endpoints belonging to other scopes. Prefer the endpoint whose path belongs to this scope.';
    }

    return dedent`
      You are Fisherman — reading the API to report what data already exists. You change nothing.

      AVAILABLE ENDPOINTS:
      ${endpointList}
      ${scopeBlock}

      AVAILABLE TOOLS:
      ${toolNames.join(', ')}.
      Use tool names exactly as listed. Do not invent aliases or combined names.
      Match each tool input schema exactly. Do not invent parameter names or pass extra fields.

      WORKFLOW:
      1. Pick the endpoint that lists the kind of item the question is about
      2. Request it, and when the answer needs a parent resource, request the parent first and use its id
      3. Call finish with the answer, quoting the concrete names, titles and ids the responses returned

      RULES:
      - Report only what a response actually returned. Never describe data you did not read
      - Report an empty collection as empty. An absent item must not be reported as present
      - Answer the question that was asked and stop. Do not survey unrelated endpoints
      - Use the response category and error text to correct a failed request. Retry a temporary or server failure once
    `;
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
bun run format
bun test tests/integration/fisherman.test.ts
```

Expected: PASS, including the five pre-existing `prepareData` tests — the extracted `runSession` must not change their behaviour.

- [ ] **Step 8: Commit**

```bash
git add src/ai/fisherman.ts tests/integration/fisherman.test.ts
git commit -m "feat: add Fisherman.lookupData for read-only data questions"
```

---

### Task 5: Pilot's queryApi tool

**Files:**
- Modify: `src/ai/pilot.ts:690` (the tool spread in `sendToPilot`), `src/ai/pilot.ts:736-779` (`buildPreconditionTool`), `src/ai/pilot.ts:454-465` (the planTest decision block), `src/ai/pilot.ts:1150` (the empty-dropdown diagnostic), `src/ai/pilot.ts:1167-1178` (the Pilot-only tool block in `getSystemPrompt`)
- Modify: `src/ai/rules.ts:165-178` (`dataProtectionRules`)
- Test: Create `tests/integration/pilot-query-api.test.ts`

**Interfaces:**
- Consumes: `Fisherman.lookupData(question, scopeUrl, sessionName)` from Task 4; `Test.addNote`, `Test.startUrl`, `Test.sessionName`.
- Produces: `Pilot.buildFishermanTools(task)` (private, renamed from `buildPreconditionTool`) returning `{ precondition, queryApi }`. `queryApi` takes `{ question: string }` and returns `{ answered: true, answer }` or `{ answered: false, reason }`. No other module calls it — `sendToPilot` already spreads the builder's result, so the tool reaches planning, new-page review and progress analysis with no further wiring.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/pilot-query-api.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
bun test tests/integration/pilot-query-api.test.ts
```

Expected: FAIL — no `queryApi` tool is offered, so the mocked tool call is never executed.

- [ ] **Step 3: Rename the builder and add the tool**

In `src/ai/pilot.ts`, rename `buildPreconditionTool` to `buildFishermanTools` and update its single call site in `sendToPilot`:

```ts
    const tools = { ...this.pickPlanningTools(), ...this.buildFishermanTools(opts.task) };
```

Inside the builder, add `queryApi` alongside the existing `precondition` in the returned object:

```ts
      queryApi: tool({
        description: dedent`
          Read the API to learn what data already exists, changing nothing.
          Ask a question about existing records: which ones are there, what they are called, whether a particular one exists.
          Use it before precondition() to see whether suitable data is already available, and whenever a step needs the exact name or id of a record that is already there.
          It never creates, edits or deletes anything — precondition() does that.
        `,
        inputSchema: z.object({
          question: z.string().describe('What to find out about data that already exists'),
        }),
        execute: async ({ question }) => {
          tag('info').log(`Query API: ${question}`);
          debugLog(`queryApi: ${question}, fisherman: ${this.fisherman?.isAvailable() ? 'available' : 'none'}`);

          if (!this.fisherman || !this.fisherman.isAvailable()) {
            return { answered: false, reason: 'No API access is configured, so existing data cannot be queried. Judge from the page instead.' };
          }

          const result = await this.fisherman.lookupData(question, task.startUrl, task.sessionName);

          if (!result.success) {
            tag('warning').log(`Query API unanswered: ${result.summary}`);
            return { answered: false, reason: result.summary || 'The API could not answer this question' };
          }

          task.addNote(`Queried API: ${question} — ${result.summary}`);
          tag('success').log(`Query API: ${result.summary}`);
          return { answered: true, answer: result.summary };
        },
      }),
```

- [ ] **Step 4: Update the Pilot system prompt**

In `getSystemPrompt`, replace the block that currently opens `YOUR Pilot-only tool: precondition(description) — create FRESH disposable test data via API. Never request users. Use when:` with:

```ts
      YOUR Pilot-only tools, both over the API:

      queryApi(question) — read what data already exists. It changes nothing. Use it to check whether
      suitable data is already there before creating any, and to get the exact name or id of an existing
      record a step must act on.

      precondition(description) — create FRESH disposable test data. Never request users. Use when:

      - Scenario edits/deletes/modifies an item → create a disposable target ("1 post").
      - Scenario needs auxiliary data (labels, categories, statuses for filtering).
      - Tester failed because required data is missing (empty dropdown, empty list).
```

Leave the `Skip precondition() when:` list and the `Describe WHAT to create` paragraph exactly as they are.

In the diagnostic-patterns list, replace the empty-dropdown line with:

```ts
      - Empty dropdown/list when items expected → queryApi() to confirm none exist, then precondition() to create them.
```

- [ ] **Step 5: Update the planTest instruction block**

In `planTest`, change the first line of the decision block from `FIRST: Decide if precondition() is needed.` to:

```ts
        FIRST: Decide if precondition() is needed. When the page does not settle whether suitable data
        already exists, call queryApi() to find out before creating any.
```

- [ ] **Step 6: Allow reads under a no-mutation constraint**

In `src/ai/rules.ts`, inside `dataProtectionRules`, add one sentence after the paragraph beginning `Do not use Fisherman or API data preparation to bypass a no-mutation`:

```ts
  Reading through the API to establish what already exists is not a mutation and stays allowed
  under a read-only constraint.
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
bun run format
bun test tests/integration/
```

Expected: PASS across the whole integration suite. `pilot-expectations.test.ts` and `planner.test.ts` must stay green — the prompt edits touch text they may assert on.

- [ ] **Step 8: Commit**

```bash
git add src/ai/pilot.ts src/ai/rules.ts tests/integration/pilot-query-api.test.ts
git commit -m "feat: let Pilot query existing data through queryApi"
```

---

### Task 6: Documentation and changelog

**Files:**
- Modify: `docs/reference/configuration.md` (the Fisherman section)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything built in Tasks 1–5. Produces no code.

- [ ] **Step 1: Run the full suite and the linter**

```bash
bun run format
bun run lint:fix
bun test
```

Expected: PASS. Fix anything the linter rewrites before continuing.

- [ ] **Step 2: Document the read capability**

In `docs/reference/configuration.md`, find the Fisherman section and add a short subsection describing that Fisherman now also answers questions about existing data over GET, that Pilot reaches it through `queryApi`, and that in replicate mode the read endpoints come from successful GET XHRs observed in the browser (recorded as endpoint + query-parameter names only, with no response body). Keep it to a paragraph — no example that names a specific site or endpoint.

- [ ] **Step 3: Write the changelog entry**

Invoke the `/changelog` skill to generate the CHANGELOG.md entry from the commits on this branch. Do not hand-write it.

- [ ] **Step 4: Commit**

```bash
git add docs/reference/configuration.md CHANGELOG.md
git commit -m "docs: describe Fisherman read lookups and queryApi"
```

- [ ] **Step 5: Report back**

Summarise for the user: what `queryApi` does, that GET endpoints are now recorded, and that regression coverage has not been run. **Do not add the `regression` label or dispatch the regression workflow** — only the user decides that.

---

## Self-Review

**Spec coverage** — every design decision maps to a task: GET capture without bodies → Task 1; read/write endpoint families → Task 2; schema-enforced read-only plus body preview and prose `finish` → Task 3; `lookupData`, the shared loop, and the removed permanent `disabled` mutation → Task 4; the `queryApi` tool, prompts and rule → Task 5; docs → Task 6.

**Type consistency** — `EndpointFamily` is declared once (`src/api/request-store.ts`, Task 2) and consumed by `toEndpointList`, `getRequestsForScope` and `Fisherman.buildEndpointList`. `readOnly` is the flag name in `createFishermanTools` throughout. `lookupData(question, scopeUrl, sessionName)` has the same argument order in Task 4's definition and Task 5's call. `addReadRequest` is the store method name in Tasks 1, 2 and 4's test helper.

**Two consequences checked against the code before this plan was committed:**

- `detectMode` flips to `replicate` on any captured request, and read captures now count — so `isAvailable()` becomes true on a GET-only store where it used to be false. The one consumer that reads the write list off the back of it, `src/ai/planner.ts:434`, already guards with `if (endpointList)`, so an empty write list simply skips the `<api_data_preparation>` block. `prepareData` is likewise unaffected: its list stays write-only and it returns an honest failure when empty (Task 4, Step 3). If a future change makes `isAvailable()` mean "can write", it must be split per family.
- `Queried API:` is a new note prefix, and CLAUDE.md keeps noise prefixes a closed set owned by `src/utils/test-plan-markdown.ts`. That set is `NOISE_PREFIXES = ['Test started', 'Finish requested:', 'Session name:']` plus special routing for `Pilot:`. `Precondition:` is not registered either — both are plain prose that flows through unchanged. Nothing to register.
