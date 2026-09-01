# Fisherman Live-Session Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In replicate mode, Fisherman API requests carry the current browser session's credentials — cookies filtered to the API origin and a live CSRF token — and never a credential scraped from a previous session's captures. Achieve mode keeps authenticating solely through `api.headers` config.

**Architecture:** Three layers change. `RequestStore.extractAuthHeaders` gains a session gate (only captures made during this run, newest first) and stops scraping cookies. `Fisherman.refreshAuth` reorders precedence to captured < live browser < config. The DI-glue provider in `explorbot.ts` filters the cookie jar by the API origin and additionally reads the page's `meta[name="csrf-token"]`.

**Tech Stack:** Bun, TypeScript, Playwright (via Explorer.withPage), bun:test, @copilotkit/aimock for the integration test.

**Spec:** `docs/superpowers/specs/2026-08-30-fisherman-live-session-auth-design.md`

## Global Constraints

- Bun only — never Node.js. Run tests with `bun test`.
- Work in the worktree `/home/davert/projects/explorbot-fisherman-reliability`, branch `fisherman-reliability` (continues PR #160 — do NOT open a new PR).
- No code comments. No ternary operators. Premature exit over if/else.
- Run `bun run format` after each code change, before each commit.
- NEVER trigger the regression CI workflow (no `regression` label, no `gh workflow run regression.yml`). Only the user does that.
- Task 4 is severable: if the user cuts it, Tasks 1–3 stand alone and the provider keeps its `cookieProvider` name.

---

### Task 1: Session-gated auth header extraction (RequestStore)

**Files:**
- Modify: `src/api/request-store.ts:6` (AUTH_HEADERS), `src/api/request-store.ts:98-112` (extractAuthHeaders), field near `src/api/request-store.ts:9-16`
- Modify: `src/api/request-result.ts:176` (timestamp fallback in `RequestResult.load`)
- Test: `tests/unit/request-store.test.ts`

**Interfaces:**
- Consumes: existing `RequestResult` (`timestamp: Date`, `requestHeaders: Record<string, string>`), `RequestStore.addCapturedRequest`, `RequestStore.loadFromDisk`.
- Produces: `extractAuthHeaders(): Record<string, string>` — same signature, but returns only `authorization` / `x-api-key` / `x-csrf-token` headers from captures made during this session, newest value first. Task 2 relies on this being safe to apply before live browser headers.

- [ ] **Step 1: Write the failing tests**

Extend the `makeRequest` helper in `tests/unit/request-store.test.ts` with an optional headers argument:

```ts
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
```

Add a new describe block at the end of the file (before the final `loadFromDisk` block is fine too — position does not matter):

```ts
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
```

Update the file's imports: add `mkdirSync, writeFileSync` to the `node:fs` import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /home/davert/projects/explorbot-fisherman-reliability && bun test tests/unit/request-store.test.ts`
Expected: the first, third, and sixth new tests FAIL (the stale, cookie, and no-timestamp values are currently returned). The second, fourth, and fifth pass by accident under the current code — they stay in as pins on the new sort-based behavior.

- [ ] **Step 3: Implement**

In `src/api/request-store.ts`, change the constant:

```ts
const AUTH_HEADERS = ['authorization', 'x-api-key', 'x-csrf-token'];
```

Add a private field to `RequestStore` (private fields live after public methods is a rule for methods; fields stay at the top with the others):

```ts
  private sessionStartedAt = new Date();
```

Replace `extractAuthHeaders`:

```ts
  extractAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const sessionCaptures = this.capturedRequests.filter((r) => r.timestamp >= this.sessionStartedAt).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    for (const req of sessionCaptures) {
      for (const [key, value] of Object.entries(req.requestHeaders)) {
        if (AUTH_HEADERS.includes(key.toLowerCase()) && !headers[key]) {
          headers[key] = value;
        }
      }
    }

    return headers;
  }
```

In `src/api/request-result.ts` line 176, change the load fallback so an absent timestamp reads as stale:

```ts
      timestamp: new Date(meta.timestamp || 0),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/unit/request-store.test.ts && bun test tests/unit/`
Expected: all PASS (the second command catches any other unit test that relied on the old fallback).

- [ ] **Step 5: Format and commit**

```bash
cd /home/davert/projects/explorbot-fisherman-reliability
bun run format
git add src/api/request-store.ts src/api/request-result.ts tests/unit/request-store.test.ts
git commit -m "Extract auth headers only from current-session captures"
```

---

### Task 2: Live browser headers replace captured ones, replicate mode only (Fisherman.refreshAuth)

**Files:**
- Modify: `src/ai/fisherman.ts:156-170` (refreshAuth)
- Test: `tests/integration/fisherman.test.ts`

**Interfaces:**
- Consumes: `extractAuthHeaders()` from Task 1; the Fisherman constructor's 6th argument `cookieProvider: () => Promise<Record<string, string>>` (renamed in Task 4, unchanged here); `ApiClient.setHeaders(headers)` which Object.assigns into defaults; `this.mode`, set by `ensureReady()` before `refreshAuth()` runs (`prepareData` calls them in that order).
- Produces: `refreshAuth` application order captured → browser → config, with the captured and browser layers applied only when `this.mode === 'replicate'`. Task 4's provider relies on its returned headers overriding same-named captured headers.

- [ ] **Step 1: Write the failing integration test**

In `tests/integration/fisherman.test.ts`:

1. Add a module-scope variable next to `apiResponses` and reset it in `beforeEach`:

```ts
  let apiHeaders: Record<string, string>;
```

```ts
    apiHeaders = {};
```

2. Change `createFisherman` to record headers, accept the browser-provided ones, and allow achieve-mode construction (existing call sites stay `createFisherman()`):

```ts
  function createFisherman(browserHeaders: Record<string, string> = {}, configHeaders: Record<string, string> = {}, hasApiConfig = false): Fisherman {
    const apiClient = {
      request: async () => apiResponses.shift(),
      setHeaders: (h: Record<string, string>) => Object.assign(apiHeaders, h),
      getHeaders: () => ({ ...apiHeaders }),
    };
    return new Fisherman(
      provider,
      apiClient as any,
      requestStore,
      async () => null,
      'https://example.test/api',
      async () => browserHeaders,
      configHeaders,
      hasApiConfig
    );
  }
```

3. Add the tests:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/integration/fisherman.test.ts`
Expected: both new tests FAIL — in the first, the current order applies browser headers before captured ones, so the captured `x-csrf-token` (`captured-token`, a live-session capture that passes Task 1's gate) overwrites `live-token`; in the second, the current unconditional `refreshAuth` sends the browser Cookie in achieve mode.

- [ ] **Step 3: Reorder refreshAuth and gate it to replicate mode**

In `src/ai/fisherman.ts`, replace `refreshAuth`:

```ts
  private async refreshAuth(): Promise<void> {
    if (this.mode === 'replicate') {
      const xhrHeaders = this.requestStore.extractAuthHeaders();
      if (Object.keys(xhrHeaders).length > 0) {
        this.apiClient.setHeaders(xhrHeaders);
      }

      const cookies = await this.cookieProvider();
      if (Object.keys(cookies).length > 0) {
        this.apiClient.setHeaders(cookies);
      }
    }

    if (Object.keys(this.configHeaders).length > 0) {
      this.apiClient.setHeaders(this.configHeaders);
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/integration/fisherman.test.ts && bun test tests/unit/fisherman-tools.test.ts`
Expected: all PASS, including the two pre-existing integration tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/ai/fisherman.ts tests/integration/fisherman.test.ts
git commit -m "Apply live browser session headers over captured ones"
```

---

### Task 3: Filter the cookie jar by the API origin

**Files:**
- Modify: `src/explorbot.ts:349-353` (cookieProvider inside agentFisherman)

**Interfaces:**
- Consumes: `baseEndpoint` local (`apiConfig?.baseEndpoint || this.config.playwright.url`), `Explorer.withPage`.
- Produces: unchanged provider signature; the returned `Cookie` header now contains only cookies Playwright would send to `baseEndpoint`.

- [ ] **Step 1: Pass the target URL to the jar**

This is DI glue over a Playwright API (`BrowserContext.cookies(urls)` filters by domain/path the way a real browser does) — there is no unit seam to test without mocking Playwright itself, so this task is verified by types and the full suite. Change line 350:

```ts
        const cookies = await this.explorer.withPage((page) => page.context().cookies(baseEndpoint)).catch(() => []);
```

- [ ] **Step 2: Run the suite**

Run: `bun test tests/unit/ && bun test tests/integration/`
Expected: all PASS (no behavior change reachable from tests).

- [ ] **Step 3: Format and commit**

```bash
bun run format
git add src/explorbot.ts
git commit -m "Send only cookies scoped to the API origin"
```

---

### Task 4 (severable): Live CSRF token from the page, provider renamed

If the user cuts this task, stop after Task 3 — nothing below is required by Tasks 1–3.

**Files:**
- Modify: `src/explorbot.ts:349-356` (provider + Fisherman construction)
- Modify: `src/ai/fisherman.ts:24,33,39` (field/param rename) and the `refreshAuth` body from Task 2
- Modify: `tests/integration/fisherman.test.ts` (argument name only)

**Interfaces:**
- Consumes: Task 2's refreshAuth ordering; Task 3's URL-filtered jar.
- Produces: `browserHeaderProvider: () => Promise<Record<string, string>>` as the Fisherman constructor's 6th argument — same type, new name — returning `{ Cookie?, 'x-csrf-token'? }`.

- [ ] **Step 1: Extend and rename the provider in explorbot.ts**

Replace the `cookieProvider` block (which after Task 3 reads `cookies(baseEndpoint)`) with:

```ts
      const browserHeaderProvider = async (): Promise<Record<string, string>> => {
        const session = await this.explorer
          .withPage(async (page) => ({
            cookies: await page.context().cookies(baseEndpoint),
            csrf: await page.evaluate(() => document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || ''),
          }))
          .catch(() => ({ cookies: [] as any[], csrf: '' }));

        const headers: Record<string, string> = {};
        if (session.cookies.length) headers.Cookie = session.cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
        if (session.csrf) headers['x-csrf-token'] = session.csrf;
        return headers;
      };
```

Update the construction call on the line that reads `new Fisherman(ai, apiClient, requestStore, specLoader, baseEndpoint, cookieProvider, configHeaders, hasApiConfig)` to pass `browserHeaderProvider`.

`meta[name="csrf-token"]` is a cross-framework convention (Rails, Laravel) — structural knowledge like ARIA roles, not a site-specific locator (see spec D5).

- [ ] **Step 2: Rename inside Fisherman**

In `src/ai/fisherman.ts`, rename the private field `cookieProvider` to `browserHeaderProvider` (declaration line 24, constructor parameter and assignment lines 33/39) and update the browser block inside `refreshAuth`'s replicate-mode gate accordingly:

```ts
      const browserHeaders = await this.browserHeaderProvider();
      if (Object.keys(browserHeaders).length > 0) {
        this.apiClient.setHeaders(browserHeaders);
      }
```

- [ ] **Step 3: Rename the test argument**

In `tests/integration/fisherman.test.ts`, `createFisherman(browserHeaders …)` already uses the right name from Task 2 — verify no remaining `cookieProvider` identifier exists in the repo:

Run: `grep -rn cookieProvider src/ tests/`
Expected: no matches.

- [ ] **Step 4: Run the suite**

Run: `bun test tests/unit/ && bun test tests/integration/`
Expected: all PASS — the Task 2 test already proves a provider-supplied `x-csrf-token` reaches the client and overrides the captured one.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/explorbot.ts src/ai/fisherman.ts tests/integration/fisherman.test.ts
git commit -m "Read the live CSRF token from the page meta tag"
```

---

### Task 5: Housekeeping and PR update

**Files:**
- Modify: `CHANGELOG.md` (extend the existing 2026-08-29 `[Fisherman]` entry area with a 2026-08-30 entry)

**Interfaces:**
- Consumes: all previous tasks committed.
- Produces: branch pushed to PR #160 with an updated description.

- [ ] **Step 1: Merge main and verify**

```bash
cd /home/davert/projects/explorbot-fisherman-reliability
git fetch origin && git merge origin/main
bun test tests/unit/ && bun test tests/integration/
```

Expected: clean merge (resolve conflicts if any, rerun tests), all tests PASS.

- [ ] **Step 2: Update CHANGELOG**

Add under a `## 2026-08-30` heading, following the existing entry style:

```markdown
- [Fisherman] In replicate mode, API requests now authenticate with the current browser session: cookies are taken from the live jar filtered to the API origin, the CSRF token is read from the page, and auth headers are never reused from previous sessions' captured requests. Achieve mode authenticates solely through `api.headers` config.
```

- [ ] **Step 3: Format, commit, push**

```bash
bun run format
git add CHANGELOG.md
git commit -m "Changelog for live-session auth"
git push origin fisherman-reliability
```

- [ ] **Step 4: Update the PR #160 description**

Append a section to the PR body via `gh pr edit 160 --body-file` (fetch the current body with `gh pr view 160 --json body -q .body` first, never overwrite blindly): one paragraph stating that trace `de95bd1cffce09169599d99d1bee56cd` exposed stale-credential assembly (unfiltered cookie jar + auth headers scraped from months-old captures) and that Fisherman now authenticates with the live browser session per `docs/superpowers/specs/2026-08-30-fisherman-live-session-auth-design.md`.

Do NOT touch the `regression` label or workflow.
