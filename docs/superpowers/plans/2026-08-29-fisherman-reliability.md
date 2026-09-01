# Fisherman Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Fisherman (the API test-data preparation agent) produce trustworthy results in replicate mode: real request examples, scope-correct endpoint lists, and a `finish` report derived from what was actually executed.

**Architecture:** All fixes are deterministic-tier changes in the data layer (`RequestStore`, `RequestResult`) and the tool glue (`fisherman-tools.ts`), following the escalation ladder in CLAUDE.md: deterministic filters gate what the model sees, and a ledger of actually-made requests verifies what the model claims (generate-then-verify). One prompt line and one loop guard land in `fisherman.ts`. No new agents, no new envelope keys, no new files except one integration test.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK tools, `@copilotkit/aimock` for integration tests.

**Spec:** `docs/superpowers/specs/2026-08-29-fisherman-reliability-design.md` (trace evidence, root causes, and design decisions; the Findings section below is the working summary).

## Global Constraints

- Bun only, never Node.js; run `bun run format` after each code change
- No code comments; avoid ternaries; private methods after public; premature exit over if/else
- Prompts and rules stay general — never encode a specific failing input from the trace review into a prompt, rule, or validator
- Never start the regression CI run (`regression` label / `gh workflow run`) — only the user applies the label
- `bun test tests/unit tests/integration` must pass before every commit
- Work on a fresh branch off `main` (project convention: `bunosh worktree:create fisherman-reliability`); do not build on `fix/skip-planning-on-error-pages`

---

## Findings (why each task exists)

From Langfuse traces of the only real Fisherman episodes (2026-04-30, 2026-06-01), verified against the current code:

1. **Self-poisoning store.** `addMadeRequest()` saves every request Fisherman itself makes — 400s included — into `output/requests/`. `loadFromDisk()` reads that whole directory back as `capturedRequests`, indistinguishable from browser XHR. A run is handed its predecessor's rejected bodies as "the captured example". Provenance is *already* encoded in the file id prefix: browser captures are `xhr_*` (`xhr-capture.ts:72`), Fisherman's own calls are unprefixed (`api-client.ts:58`), and `fail_*` records are never saved to disk (`addFailedRequest` doesn't call `save()`).
2. **First-match spec lookup.** `findCapturedRequest()` is `find(method && path.startsWith(prefix))` — no status ranking, no exactness: a stale 400 displaces a good 200, and `/suites` matches `/suites/123/move`.
3. **Scope filter never matches.** `getWriteRequestsForScope()` prefix-matches a page URL (`/projects/…`) against API paths (`/api/…`), always falls through to `'/'` — every captured write from every project, which produced a cross-project endpoint in the Apr 30 prompt. Degradation is silent.
4. **`finish` is unconditional success.** It writes the model's own `created` array through verbatim (`fisherman-tools.ts:150`). A run that created nothing — or created a *test* when a *milestone* was asked for — reports success, and Pilot passes it on as a satisfied precondition.
5. **Silent exhaustion & clobbered status.** Hitting max iterations without `finish` returns `summary: ''`, so Pilot logs nothing and the vision check is told the reason is "unknown". In the `request` tool, `...extractKeyFields()` spreads *after* the `status` key, so a body field named `status` overwrites the HTTP status, and the depth-5 first-id scan surfaces ids the run never created.

Design decisions that differ from the earlier proposed plan:

- **No new `source:` envelope key.** The `xhr_` id prefix already has a single writer (`generateRequestId`) and a closed vocabulary; filtering on it in `loadFromDisk()` is the whole fix and migrates poisoned directories for free.
- **Reuse `isDynamicSegment()`** from `src/utils/url-matcher.ts` for id-shaped path segments instead of a new classifier.
- **Scope = most selective shared segment**, not max-shared-segment count (which would drop same-project endpoints that don't match the deepest page path, and a shared literal like `projects` must not win over a project slug).
- **`finish` is gated, not replaced.** The model still names types and summarizes; the ledger verifies ids and vetoes success with zero successful writes.

Behavioral change to state in the CHANGELOG: a `output/requests/` directory containing only Fisherman-made files now yields zero captures, so replicate mode reports itself disabled — correct, since there was never real browser traffic to replicate.

Blast radius (verified by grep, 2026-08-29): `loadFromDisk`, `getCapturedRequests`, `toEndpointList`, `findCapturedRequest`, and `getWriteRequestsForScope` are consumed only by `fisherman.ts`, `fisherman-tools.ts`, and tests — nothing in `boat/` or `bin/` touches them, so the behavior changes in Tasks 1–3 affect Fisherman alone.

---

### Task 1: `loadFromDisk` admits only browser captures

**Files:**
- Modify: `src/api/request-store.ts:120-136`
- Test: `tests/unit/request-store.test.ts`

**Interfaces:**
- Consumes: existing id prefixes — `xhr_` from `xhr-capture.ts`, unprefixed from `api-client.ts`
- Produces: `loadFromDisk(): void` unchanged signature; `capturedRequests` now contains only browser-captured requests. Task 2/3 ranking and scoping rely on this.

- [ ] **Step 1: Write the failing test**

Extend the `makeRequest` helper in `tests/unit/request-store.test.ts` with an optional id:

```ts
function makeRequest(method: string, path: string, status: number, id?: string): RequestResult {
  counter++;
  return new RequestResult({
    id: id || `req_${counter}`,
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
```

Add a new describe block (reuses the existing `outputDir`/`store` beforeEach):

```ts
describe('RequestStore loadFromDisk', () => {
  it('loads only browser-captured requests from disk', () => {
    makeRequest('POST', '/api/suites', 201, 'xhr_001_POST_api_suites').save(outputDir);
    makeRequest('POST', '/api/suites', 400, '001_POST_api_suites').save(outputDir);

    const fresh = new RequestStore(outputDir);
    fresh.loadFromDisk();

    expect(fresh.getCapturedRequests()).toHaveLength(1);
    expect(fresh.getCapturedRequests()[0].id).toBe('xhr_001_POST_api_suites');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/request-store.test.ts`
Expected: FAIL — `getCapturedRequests()` has length 2.

- [ ] **Step 3: Implement the filter**

In `src/api/request-store.ts` `loadFromDisk()`, change the file filter line to:

```ts
const files = readdirSync(requestsDir).filter((f) => f.startsWith('xhr_') && f.endsWith('.request.yaml'));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/request-store.test.ts`
Expected: PASS (all, including the pre-existing failure-listener tests).

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/api/request-store.ts tests/unit/request-store.test.ts
git commit -m "fix(fisherman): stop replicate mode reading its own past requests as captures"
```

---

### Task 2: Rank captured examples in `findCapturedRequest`

**Files:**
- Modify: `src/api/request-store.ts:111-114` and `normalizePathPattern` at `src/api/request-store.ts:150-152`
- Test: `tests/unit/request-store.test.ts`

**Interfaces:**
- Consumes: `isDynamicSegment(segment: string): boolean` from `src/utils/url-matcher.ts`
- Produces: `findCapturedRequest(method: string, searchPath: string): RequestResult | undefined` — same signature, now ranked. The search path may contain literal `{id}` segments (as printed by Task 3's endpoint list) or concrete ids; both match stored requests. Contract for Task 3: endpoint lists print `normalizePathPattern` output, and this method accepts exactly those strings.

Ranking: candidates share the method and their normalized path starts with the normalized search path at segment boundaries. Exact segment-count match beats a deeper sub-path; within a tier, `status < 400` beats a rejection; within that, newest `timestamp` wins. An exact-path rejection deliberately beats a sub-path success — `getEndpointSpec`'s existing `usable: false` branch then explains it to the model.

Accepted over-generalization: `isDynamicSegment` also fires on short mixed-alphanumeric segments like API version prefixes, so `/api/v2/posts` lists as `POST /api/{id}/posts`. That is recoverable by design — `getEndpointSpec` returns the stored request's *concrete* `path`, and the WORKFLOW already mandates a spec lookup before first use — so do not "fix" it by narrowing the normalization; that would reintroduce the weak dedup.

- [ ] **Step 1: Write the failing tests**

```ts
describe('findCapturedRequest ranking', () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/request-store.test.ts`
Expected: FAIL — first-match behavior returns the 400 / the sub-path / the older entry.

- [ ] **Step 3: Implement normalization and ranking**

In `src/api/request-store.ts`, add the import and rewrite `normalizePathPattern` on top of the existing shared classifier:

```ts
import { isDynamicSegment } from '../utils/url-matcher.ts';
```

```ts
function normalizePathPattern(urlPath: string): string {
  return urlPath
    .split('/')
    .map((segment) => (segment && isDynamicSegment(segment) ? '{id}' : segment))
    .join('/');
}
```

Replace `findCapturedRequest`:

```ts
findCapturedRequest(method: string, searchPath: string): RequestResult | undefined {
  const upper = method.toUpperCase();
  const search = normalizePathPattern(searchPath).split('/').filter(Boolean);

  let best: RequestResult | undefined;
  let bestScore = -1;

  for (const req of this.capturedRequests) {
    if (req.method !== upper) continue;
    const segments = normalizePathPattern(req.path).split('/').filter(Boolean);
    if (segments.length < search.length) continue;
    if (!search.every((segment, i) => segment === segments[i])) continue;

    let score = 0;
    if (segments.length === search.length) score += 4;
    if (req.status < 400) score += 2;
    if (score < bestScore) continue;
    if (score === bestScore && best && req.timestamp <= best.timestamp) continue;
    best = req;
    bestScore = score;
  }

  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/request-store.test.ts tests/unit/fisherman-tools.test.ts`
Expected: PASS. (`fisherman-tools.test.ts` duck-types `findCapturedRequest`, so it is unaffected; running it confirms.)

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/api/request-store.ts tests/unit/request-store.test.ts
git commit -m "fix(fisherman): rank captured examples — exact path, then success, then recency"
```

---

### Task 3: Scope the endpoint list by shared path segment, own it in RequestStore

**Files:**
- Modify: `src/api/request-store.ts:80-93` (`toEndpointList`), `src/api/request-store.ts:138-141` (`getWriteRequestsForScope`)
- Modify: `src/ai/fisherman.ts:163-185` (`buildEndpointList`), `src/ai/fisherman.ts:187-217` (`buildSystemPrompt`)
- Test: `tests/unit/request-store.test.ts`

**Interfaces:**
- Consumes: Task 2's `normalizePathPattern`
- Produces: `getWriteRequestsForScope(scopePath: string): RequestResult[]` — same signature; returns `[]` (not everything) when nothing matches the scope. `toEndpointList(scopePath?: string): string` — optional scope parameter; lines are `METHOD normalized-path`, deduplicated. Fisherman's `buildEndpointList` delegates to it and no longer builds lines itself.

Scope rule (spec sentence): score each scope-URL path segment by how many captured writes contain it in their path; the scope key is the non-zero segment with the fewest matches, leftmost on ties; a request is in scope when its path contains that segment. A root or empty scope returns all writes. This matches a page URL's project/tenant slug to API paths without any site-specific knowledge, and a shared generic literal (matching everything) loses to the selective slug.

- [ ] **Step 1: Write the failing tests**

```ts
describe('RequestStore scope filtering', () => {
  it('scopes writes by the most selective segment shared with the page URL', () => {
    store.addCapturedRequest(makeRequest('POST', '/api/alpha-shop/suites', 201));
    store.addCapturedRequest(makeRequest('PATCH', '/api/other-shop/suites/5', 200));

    const scoped = store.getWriteRequestsForScope('/projects/alpha-shop/suites');

    expect(scoped).toHaveLength(1);
    expect(scoped[0].path).toBe('/api/alpha-shop/suites');
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/request-store.test.ts`
Expected: FAIL — prefix matching returns 0 for page URLs, and dedup keeps both id-bearing paths.

- [ ] **Step 3: Implement scope + scoped list in RequestStore**

Replace `getWriteRequestsForScope` and `toEndpointList` in `src/api/request-store.ts`:

```ts
getWriteRequestsForScope(scopePath: string): RequestResult[] {
  const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  const writes = this.capturedRequests.filter((r) => writeMethods.has(r.method));
  const scopeSegments = scopePath.split('/').filter(Boolean);
  if (scopeSegments.length === 0) return writes;

  let scopeKey = '';
  let fewest = Number.POSITIVE_INFINITY;
  for (const segment of scopeSegments) {
    const matches = writes.filter((r) => r.path.split('/').includes(segment)).length;
    if (matches === 0 || matches >= fewest) continue;
    scopeKey = segment;
    fewest = matches;
  }
  if (!scopeKey) return [];

  return writes.filter((r) => r.path.split('/').includes(scopeKey));
}
```

```ts
toEndpointList(scopePath?: string): string {
  let requests = this.capturedRequests;
  if (scopePath) requests = this.getWriteRequestsForScope(scopePath);

  const seen = new Set<string>();
  const lines: string[] = [];

  for (const req of requests) {
    const key = `${req.method} ${normalizePathPattern(req.path)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(key);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Delegate from Fisherman and surface degradation**

In `src/ai/fisherman.ts`, add a field next to the other privates:

```ts
private scopeDegraded = false;
```

Replace `buildEndpointList`:

```ts
private buildEndpointList(scopeUrl?: string): string {
  this.scopeDegraded = false;
  if (this.mode === 'achieve' && this.spec) {
    const specEndpoints = listAllEndpoints(this.spec, this.baseEndpoint);
    if (specEndpoints) return specEndpoints;
  }

  const scoped = this.requestStore.toEndpointList(scopeUrl || '/');
  if (scoped) return scoped;

  this.scopeDegraded = true;
  return this.requestStore.toEndpointList();
}
```

In `buildSystemPrompt`, replace the `scopeBlock` line with:

```ts
let scopeBlock = '';
if (scopeUrl) {
  scopeBlock = `\n\nSCOPE: You are operating within ${scopeUrl}.\nAll created items must belong to this scope.`;
  if (this.scopeDegraded) scopeBlock += '\nThe endpoint list could not be narrowed to this scope and may include endpoints belonging to other scopes. Before writing, confirm the target belongs to this scope.';
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/ tests/integration/`
Expected: PASS.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/api/request-store.ts src/ai/fisherman.ts tests/unit/request-store.test.ts
git commit -m "fix(fisherman): scope endpoint list by shared URL segment, announce degradation"
```

---

### Task 4: Keep the HTTP status authoritative in the `request` tool

**Files:**
- Modify: `src/ai/fisherman-tools.ts:76-125` (`request` tool)
- Test: `tests/unit/fisherman-tools.test.ts`

**Interfaces:**
- Consumes: existing `extractKeyFields`
- Produces: successful `request` tool results are `{ success: true, status: number, extracted: Record<string, any> }` — extraction is namespaced so a response-body field can never clobber the HTTP `status`, and the model sees clearly which part is the transport verdict and which is body data.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/fisherman-tools.test.ts`:

```ts
it('keeps the HTTP status authoritative over response body fields', async () => {
  const apiClient = {
    request: async () => ({ status: 201, statusText: 'Created', rawResponseBody: '', responseBody: { id: 7, status: 'draft' } }),
  };
  const { tools } = createFishermanTools(apiClient as any, store(), {});

  const result: any = await tools.request.execute({ method: 'POST', path: '/items' }, {} as any);

  expect(result.status).toBe(201);
  expect(result.extracted).toEqual({ id: 7, status: 'draft' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/fisherman-tools.test.ts`
Expected: FAIL — `result.status` is `'draft'` and `result.extracted` is undefined.

- [ ] **Step 3: Namespace the extraction**

In the `request` tool's success return, replace the spread:

```ts
const extracted = extractKeyFields(reqResult.responseBody);
tag('success').log(`Fisherman: ${input.method} ${input.path} > ${statusLine}`);
return {
  success: true,
  status: reqResult.status,
  extracted,
};
```

Update the tool description's second line to: `Returns status, plus IDs and names auto-extracted from the response under 'extracted'.`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/fisherman-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/ai/fisherman-tools.ts tests/unit/fisherman-tools.test.ts
git commit -m "fix(fisherman): namespace extracted response fields so body data cannot clobber HTTP status"
```

---

### Task 5: Derive the result from the request ledger

**Files:**
- Modify: `src/ai/fisherman-tools.ts` (`createFishermanTools`, `finish` tool, `FishermanResult` type)
- Modify: `src/api/request-result.ts` (add `isWrite` getter)
- Modify: `src/ai/pilot.ts:764-768` (show `via` in the precondition step text)
- Test: `tests/unit/fisherman-tools.test.ts`

**Interfaces:**
- Consumes: `RequestStore.getMadeRequests(): RequestResult[]`, `RequestResult.extractIdAndTitle(): { id?, title? }`, `RequestResult.toSummary(): string`
- Produces: `RequestResult` gains `get isWrite(): boolean` (method is POST/PUT/PATCH/DELETE). `FishermanResult.created` items gain optional `via?: string` (`"POST /api/suites"`). `createFishermanTools` snapshots the made-request count at creation; everything after that index is "this run". `finish` with zero successful writes in this run returns `{ finished: false, error }` and does not end the loop. `getResult()` without a `finish`/`stop` synthesizes an honest summary and ledger-derived `created` instead of `summary: ''`.

This is the generate-then-verify ladder from CLAUDE.md: the model still names types and writes the summary (judgment), while success and ids are checked against what HTTP actually returned (deterministic, loud).

- [ ] **Step 1: Write the failing tests**

Replace the `store()` helper at the bottom of `tests/unit/fisherman-tools.test.ts` and add a made-request factory:

```ts
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
    toSummary: () => `${method} ${path} → ${status} (0ms)`,
  };
}
```

Add the tests:

```ts
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

  it('drops created items whose id no write response returned, keeps verified ones with via', async () => {
    const made: any[] = [];
    const { tools, getResult } = createFishermanTools({} as any, store(undefined, made), {});
    made.push(madeWrite('POST', '/api/suites', 201, { id: 's1', title: 'Suite A' }));

    await tools.finish.execute({ summary: 'done', created: [{ type: 'suite', id: 's1' }, { type: 'milestone', id: 'm9' }] }, {} as any);

    const result = getResult();
    expect(result.success).toBe(true);
    expect(result.created).toEqual([{ type: 'suite', id: 's1', via: 'POST /api/suites' }]);
  });

  it('synthesizes an honest summary when the loop ends without finish', async () => {
    const made: any[] = [];
    const { getResult } = createFishermanTools({} as any, store(undefined, made), {});
    made.push(madeWrite('POST', '/api/suites', 201, { id: 's1', title: 'Suite A' }));
    made.push(madeWrite('POST', '/api/tests', 400));

    const result = getResult();
    expect(result.success).toBe(true);
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/fisherman-tools.test.ts`
Expected: FAIL — `finish` currently always succeeds and `getResult()` returns `summary: ''`. (The four pre-existing tests must still pass — the updated `store()` helper keeps their behavior.)

- [ ] **Step 3: Add the `isWrite` getter**

In `src/api/request-result.ts`, after the `responseBody` getter:

```ts
get isWrite(): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(this.method);
}
```

- [ ] **Step 4: Implement the ledger in `createFishermanTools`**

In `src/ai/fisherman-tools.ts`, replace the head of `createFishermanTools` and the `finish` tool:

```ts
export function createFishermanTools(apiClient: ApiClient, requestStore: RequestStore, opts: { spec?: any; baseEndpoint?: string }) {
  let finished = false;
  let result: FishermanResult | null = null;
  const ledgerStart = requestStore.getMadeRequests().length;

  const runRequests = () => requestStore.getMadeRequests().slice(ledgerStart);
  const successfulWrites = () => runRequests().filter((r) => r.isWrite && !r.error && r.status >= 200 && r.status < 400);
  const getResult = () => result ?? synthesizeResult(runRequests(), successfulWrites());
  const isFinished = () => finished;
```

Replace the `finish` tool's `execute`:

```ts
execute: async ({ summary, created, failed }) => {
  const writes = successfulWrites();
  if (writes.length === 0) {
    tag('warning').log('Fisherman: finish rejected — no successful write request in this run');
    return { finished: false, error: 'No successful write request was made in this run, so nothing was created. Keep working, or call stop if the data cannot be prepared.' };
  }

  const viaById = new Map<string, string>();
  for (const write of writes) {
    const { id } = write.extractIdAndTitle();
    if (id === undefined) continue;
    viaById.set(String(id), `${write.method} ${write.path}`);
  }

  const verified: FishermanResult['created'] = [];
  for (const item of created) {
    if (item.id === undefined) {
      verified.push(item);
      continue;
    }
    const via = viaById.get(String(item.id));
    if (!via) {
      tag('warning').log(`Fisherman: dropped unverified created item ${item.type} (id: ${item.id})`);
      continue;
    }
    verified.push({ ...item, via });
  }
  if (verified.length === 0) verified.push(...writes.map(toCreatedItem));

  tag('success').log(`Fisherman done: ${summary}`);
  finished = true;
  result = { success: true, summary, created: verified, failed: failed || [] };
  return { finished: true };
},
```

Add the module-private helpers after the exported function, and extend the type at the end of the file:

```ts
function synthesizeResult(made: RequestResult[], writes: RequestResult[]): FishermanResult {
  const failures = made.filter((r) => r.status >= 400 || r.error);
  let summary = `Stopped before finishing: ${made.length} requests, ${writes.length} successful writes, ${failures.length} failed`;
  const lastFailure = failures[failures.length - 1];
  if (lastFailure) summary += `; last failure: ${lastFailure.toSummary()}`;
  return { success: writes.length > 0, summary, created: writes.map(toCreatedItem), failed: [] };
}

function toCreatedItem(write: RequestResult): FishermanResult['created'][number] {
  const { id, title } = write.extractIdAndTitle();
  const segments = write.path.split('/').filter((s) => s && !isDynamicSegment(s));
  return { type: segments[segments.length - 1] || 'item', id, title, via: `${write.method} ${write.path}` };
}
```

```ts
export interface FishermanResult {
  success: boolean;
  summary: string;
  created: Array<{ type: string; id?: string | number; title?: string; via?: string }>;
  failed: Array<{ type: string; reason: string }>;
}
```

Add the imports at the top: `import type { RequestResult } from '../api/request-result.ts';` and `import { isDynamicSegment } from '../utils/url-matcher.ts';`

- [ ] **Step 5: Show `via` in Pilot's precondition step**

In `src/ai/pilot.ts` `buildPreconditionTool`, extend the item formatting (currently lines 764-768):

```ts
const parts = [c.type];
if (c.title) parts.push(`"${c.title}"`);
if (c.id) parts.push(`(id: ${c.id})`);
if (c.via) parts.push(`via ${c.via}`);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/ tests/integration/`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add src/ai/fisherman-tools.ts src/api/request-result.ts src/ai/pilot.ts tests/unit/fisherman-tools.test.ts
git commit -m "fix(fisherman): verify finish against the request ledger, synthesize result on exhaustion"
```

---

### Task 6: Repeated-failure guard and no-substitution rule

**Files:**
- Modify: `src/ai/fisherman.ts` (`prepareData` loop, system prompt RULES, new private method)

**Interfaces:**
- Consumes: `requestStore.getMadeRequests()`, Task 5's honest `getResult()` (which turns an early stop into an accurate report)
- Produces: the run ends after `REPEATED_FAILURE_LIMIT` consecutive failures against one endpoint instead of burning 15 iterations × 5 roundtrips on body guesses; one general prompt rule against creating substitute resource types.

This mirrors the deterministic dead-loop detection StateManager does for navigation: identical repeats are a structural signal, not a judgment call.

- [ ] **Step 1: Add the constant and the guard**

In `src/ai/fisherman.ts` next to `MAX_ITERATIONS`:

```ts
const REPEATED_FAILURE_LIMIT = 4;
```

In `prepareData`, capture the ledger start before the loop (after `createFishermanTools`):

```ts
const ledgerStart = this.requestStore.getMadeRequests().length;
```

In the loop callback, after the `isFinished()` check:

```ts
if (this.isStuckOnEndpoint(ledgerStart)) {
  tag('warning').log('Fisherman: repeated failures on the same endpoint — stopping');
  stop();
  return;
}
```

Add the private method after the other private methods:

```ts
private isStuckOnEndpoint(ledgerStart: number): boolean {
  const made = this.requestStore.getMadeRequests().slice(ledgerStart);
  if (made.length < REPEATED_FAILURE_LIMIT) return false;
  const recent = made.slice(-REPEATED_FAILURE_LIMIT);
  const first = recent[0];
  return recent.every((r) => (r.status >= 400 || r.error) && r.method === first.method && r.path === first.path);
}
```

- [ ] **Step 2: Add the prompt rule**

In `buildSystemPrompt`'s RULES block, add one line after the retry rule:

```
- Create only the resource types that were requested. If no endpoint creates a requested type, call stop — never create a different type as a substitute
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/ tests/integration/`
Expected: PASS.

- [ ] **Step 4: Format and commit**

```bash
bun run format
git add src/ai/fisherman.ts
git commit -m "fix(fisherman): stop after repeated failures on one endpoint, forbid substitute types"
```

---

### Task 7: Integration test — the full replicate-mode loop

**Files:**
- Create: `tests/integration/fisherman.test.ts`

**Interfaces:**
- Consumes: everything above — scoped prompt (Task 3), ledger-gated `finish` (Task 5); the aimock pattern from `tests/integration/prima-do.test.ts` (tool-call fixtures) and `tests/integration/planner.test.ts` (Provider setup, `extractPromptText`)
- Produces: end-to-end proof that a run's system prompt is scope-filtered and that an empty-handed `finish` is rejected and converted to an honest failure.

- [ ] **Step 1: Write the integration test**

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
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

let counter = 0;
function requestResult(id: string, method: string, urlPath: string, status: number, body?: any): RequestResult {
  counter++;
  const result = new RequestResult({
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
    return new Fisherman(provider, apiClient as any, requestStore, async () => null, 'https://example.test/api', async () => ({}));
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
```

Note: `addCapturedRequest` saves into the temp `outputDir`; `detectMode`'s `loadFromDisk` dedups by id, so replicate mode activates from the seeded captures. The `beforeAll` mirrors `tests/integration/prima-do.test.ts`.

- [ ] **Step 2: Run the test**

Run: `bun test tests/integration/fisherman.test.ts`
Expected: PASS. If the first fixture assertion fails on prompt content, print `extractPromptText(mock.getRequests()[0])` to see the actual endpoint list — the scoping from Task 3 must have filtered it.

- [ ] **Step 3: Run the full suite, format, and commit**

```bash
bun test tests/unit/ tests/integration/
bun run format
git add tests/integration/fisherman.test.ts
git commit -m "test(fisherman): integration coverage for scoped prompts and ledger-gated finish"
```

---

### Task 8: Rollout — regression fixture and changelog

**Files:**
- Modify: `tests/regression/fixture/explorbot.config.js:50-52`
- Modify: `CHANGELOG.md` (via the `/changelog` skill)

**Interfaces:**
- Consumes: `explorbot.ts:329` — replicate mode requires `fisherman: { enabled: true }` when no `api` config block exists
- Produces: the next user-triggered regression run exercises Fisherman in replicate mode for the first time since the fixes.

- [ ] **Step 1: Verify the fixture can feed replicate mode**

Replicate mode needs browser-captured JSON write XHRs before any `precondition()` fires. Inspect the Trackly fixture scenarios and knowledge (`tests/regression/fixture/`, `tests/regression/seeds/`) and confirm at least one scenario performs a create/edit through the UI. If no scenario produces a write before preconditions are wanted, report that to the user in the PR description instead of silently flipping the flag — the flip would prove nothing.

- [ ] **Step 2: Enable Fisherman in the fixture**

In `tests/regression/fixture/explorbot.config.js`:

```js
fisherman: {
  enabled: true,
},
```

- [ ] **Step 3: Update the changelog**

Invoke the `/changelog` skill. The entry must mention the behavioral change: request directories containing only Fisherman-made files (no `xhr_*` captures) no longer activate replicate mode, and `finish` now fails when no successful write request was made.

- [ ] **Step 4: Final check and commit**

```bash
bun test tests/unit/ tests/integration/
bun run format
git add tests/regression/fixture/explorbot.config.js CHANGELOG.md
git commit -m "chore(fisherman): enable replicate mode in the regression fixture"
```

- [ ] **Step 5: Hand regression to the user**

Do not start the regression workflow. Tell the user the branch is ready for a regression run and that they can apply the `regression` label when they want it. Acceptance criterion for the whole plan: one trace where `precondition()` returns created ids and those ids are visible on the page the Tester then acts on.
