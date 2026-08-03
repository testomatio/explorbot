# Prima Boat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `boat/prima` — an intent-level browser driver CLI (`explorbot prima ...`) that lets an orchestrating agent act on pages via Playwright calls or natural language while explorbot's cheap models handle perception, healing, and evidence.

**Architecture:** A boat following the `boat/doc-collector` pattern: `Prima` class wraps `ExplorBot`, reuses Navigator/Researcher/Explorer/StateManager, adds a pure envelope renderer and a pw function wrapper. Core changes are minimal: named browser-server instances, a Navigator heal-attempt hook, and a global-config/per-host-state ladder in config loading.

**Tech Stack:** TypeScript on Bun (Node.js supported through the package build step), commander, CodeceptJS/Playwright via Explorer, `bun:test`, Biome.

**Spec:** `docs/superpowers/specs/2026-08-01-prima-boat-design.md` — read it first.

**Execution model:** Run implementation subagents on Opus (user directive).

## Global Constraints

- Tests via `bun:test`; keep sources compatible with the existing package build step (`dist/` output runs on Node.js, `bun` condition points at `src/` — see `docs/contributing/npm-package.md`).
- No code comments unless explicitly specified; premature exit over if/else; no ternary operators; no `...(cond ? {} : {})` spreads; `?.` over `&&` chains; private methods after public; types at end of file; `dedent` for prompts.
- Prompts and tool descriptions must be GENERAL — never encode a specific failing example.
- Business logic lives in the `Prima` class / agents; CLI handlers only parse options and delegate (repo rule).
- Run `bun run format` after each code change; `bun run lint:fix` after big ones.
- Clean stdout: respect `EXPLORBOT_NO_BANNER`; envelope output goes to `console.log`, logs go through `tag()` logger.
- DO NOT duplicate existing code — reuse `src/utils/aria.ts`, `src/action-result.ts`, `src/browser-server.ts`, Historian converters.

## File Structure

```
boat/prima/
├── package.json               # name "prima", bin prima
├── bin/prima-cli.ts          # standalone CLI entry
├── src/
│   ├── cli.ts                 # createPrimaCommands(name = 'prima')
│   ├── prima.ts               # Prima class (all business logic)
│   ├── envelope.ts            # EnvelopeData type, renderEnvelope(), writeArtifacts()
│   └── pw-parser.ts           # isFunctionExpression(), toCodeceptWrapper()
└── tests/
    ├── envelope.test.ts
    ├── pw-parser.test.ts
    └── prima.test.ts          # duck-typed ExplorBot mocks
Core modifications:
├── src/browser-server.ts      # named instances (endpoint file per instance)
├── src/ai/navigator.ts        # resolveState onAttempt hook (small)
├── src/config.ts              # global config + global .env + per-host state dir
└── bin/explorbot-cli.ts       # program.addCommand(createPrimaCommands('prima'))
```

---

### Task 1: Envelope module

**Files:**
- Create: `boat/prima/package.json`, `boat/prima/src/envelope.ts`
- Test: `boat/prima/tests/envelope.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–7 and 9):

```typescript
export interface InstanceInfo {
  name: string;
  tabs: number;
  startedAgo?: string;
  attached?: string;
  others: Array<{ name: string; tabs: number }>;
}
export interface HealAttempt {
  code: string;
  outcome: string;
}
export interface EnvelopeData {
  ok: boolean;
  command: string;
  healed?: boolean;
  healNote?: string;
  used?: string[];
  page: { url: string; previousUrl?: string; title: string; state: string; visits: number };
  changes?: string | null;
  answer?: string;
  research?: string;
  verdict?: { passed: boolean; evidence: string; code: string };
  failure?: { error: string; attempts: HealAttempt[]; reasoning?: string; compactAria?: string };
  instance: InstanceInfo;
  artifacts?: { aria: string; html: string; network: string };
}
export function renderEnvelope(data: EnvelopeData): string;
export function writeArtifacts(dir: string, snapshot: { aria: string | null; html: string | null; requests: unknown[] }): { aria: string; html: string; network: string };
```

- [ ] **Step 1: Scaffold the boat package**

`boat/prima/package.json` (mirror `boat/api-tester/package.json` shape):

```json
{
  "name": "prima",
  "version": "1.0.0",
  "description": "High-level browser driver CLI for orchestrating agents",
  "type": "module",
  "bin": { "prima": "./bin/prima-cli.ts" },
  "scripts": {
    "format": "biome format --write .",
    "lint:fix": "biome lint --write .",
    "check:fix": "biome check --write ."
  },
  "dependencies": {
    "commander": "^14.0.1",
    "dedent": "^1.6.0"
  }
}
```

- [ ] **Step 2: Write failing envelope tests**

`boat/prima/tests/envelope.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { type EnvelopeData, renderEnvelope, writeArtifacts } from '../src/envelope.ts';

const base: EnvelopeData = {
  ok: true,
  command: "pw ({ page }) => page.click('text=Login')",
  used: ["I.click('Login')"],
  page: { url: 'https://app.example.com/dashboard', previousUrl: 'https://app.example.com/login', title: 'Dashboard', state: 'dashboard_h1_dashboard', visits: 1 },
  changes: 'ariaDiff:\n  added:\n    - heading "Dashboard"',
  instance: { name: 'default', tabs: 3, startedAgo: '12m', others: [{ name: 'auth-test', tabs: 1 }] },
  artifacts: { aria: '/tmp/x/aria.yml', html: '/tmp/x/page.html', network: '/tmp/x/network.jsonl' },
};

describe('renderEnvelope', () => {
  test('success envelope contains all sections in order', () => {
    const out = renderEnvelope(base);
    const sections = ['### Result', '### Page', '### Changes', '### Instance', '### Artifacts'];
    const positions = sections.map((s) => out.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(out).toContain('ok: true');
    expect(out).toContain("used: I.click('Login')");
    expect(out).toContain('(changed: https://app.example.com/login → https://app.example.com/dashboard)');
    expect(out).toContain('instance: default (3 tabs) | other instances: auth-test (1 tab)');
  });

  test('unchanged url renders without changed marker', () => {
    const out = renderEnvelope({ ...base, page: { ...base.page, previousUrl: base.page.url } });
    expect(out).not.toContain('(changed:');
  });

  test('failure envelope renders attempts, reasoning and compact aria', () => {
    const out = renderEnvelope({
      ...base,
      ok: false,
      failure: {
        error: "locator 'text=Login' not found",
        attempts: [{ code: "I.click('Login')", outcome: 'not visible' }, { code: 'scroll + retry', outcome: 'covered by cookie banner' }],
        reasoning: 'element hidden behind consent overlay',
        compactAria: '- button "Accept all"',
      },
    });
    expect(out).toContain('### Failure');
    expect(out).toContain('### Healing attempts (2)');
    expect(out).toContain("1. I.click('Login')");
    expect(out).toContain('→ not visible');
    expect(out).toContain('### Current page (compact ARIA)');
    expect(out).toContain('- button "Accept all"');
  });

  test('answer replaces changes for ask', () => {
    const out = renderEnvelope({ ...base, changes: undefined, answer: 'A login form with email and password fields' });
    expect(out).toContain('### Answer');
    expect(out).not.toContain('### Changes');
  });

  test('verdict replaces changes for verify', () => {
    const out = renderEnvelope({ ...base, changes: undefined, verdict: { passed: true, evidence: 'heading "Dashboard" present', code: "I.see('Dashboard')" } });
    expect(out).toContain('### Verdict');
    expect(out).toContain('passed: true');
    expect(out).toContain("I.see('Dashboard')");
  });

  test('healed success carries note', () => {
    const out = renderEnvelope({ ...base, healed: true, healNote: 'dismissed overlay first' });
    expect(out).toContain('healed: true (dismissed overlay first)');
  });
});

describe('writeArtifacts', () => {
  test('writes aria, html and network files and returns absolute paths', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prima-'));
    const result = writeArtifacts(dir, { aria: '- button "Login"', html: '<html></html>', requests: [{ url: '/api/user', status: 200 }] });
    expect(readFileSync(result.aria, 'utf-8')).toContain('button "Login"');
    expect(readFileSync(result.html, 'utf-8')).toContain('<html>');
    expect(readFileSync(result.network, 'utf-8')).toContain('/api/user');
    expect(path.isAbsolute(result.aria)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `bun test boat/prima/tests/envelope.test.ts`
Expected: FAIL — cannot resolve `../src/envelope.ts`.

- [ ] **Step 4: Implement `boat/prima/src/envelope.ts`**

Pure string building. Rules:
- Sections always in order: Result, Page, then exactly one of Changes/Answer/Verdict (Changes only when `changes` is a non-empty string), Failure + Healing attempts + Current page (only when `failure` set), Instance, Artifacts (only when set).
- `healed: true (note)` on one line when healNote present, plain `healed: false` otherwise; omit line when `healed` is undefined.
- `used:` joins multiple codes with `; `.
- Page line: `url: <url>   (changed: <prev> → <url>)` only when previousUrl differs.
- State line: `state: <state>            (visit #<visits>)`.
- Instance line exactly as tested; `others` empty → `| other instances: none`.
- When `attached` is set, the browser line renders `browser: attached (<attached>)` instead of the running/started form (add a render test: `attached: 'playwright-cli session "default", workspace /w'` → contains `browser: attached (playwright-cli session "default"`).
- Network artifact written as JSONL (one `JSON.stringify` per request).
- Every attempt line: `<n>. <code>` padded, then `→ <outcome>`.

Keep it one exported function plus small private helpers below it; no classes.

- [ ] **Step 5: Run tests, verify pass**

Run: `bun test boat/prima/tests/envelope.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add boat/prima
git commit -m "feat(prima): boat scaffold and result envelope"
```

---

### Task 2: pw function wrapper

The `pw` argument is a function expression in the exact shape `I.usePlaywrightTo` accepts — `({ page, browserContext, browser }) => ...` — so callers destructure whichever Playwright objects they need. The parser only answers "is this a parseable function expression" (for clean `tool:` errors) and interpolates it verbatim into the CodeceptJS call that `Action.execute` expects.

**Files:**
- Create: `boat/prima/src/pw-parser.ts`
- Test: `boat/prima/tests/pw-parser.test.ts`

**Interfaces:**
- Produces (used by Task 4):

```typescript
export function isFunctionExpression(expr: string): { valid: boolean; error?: string };
export function toCodeceptWrapper(expr: string): string;
```

- [ ] **Step 1: Write failing tests**

`boat/prima/tests/pw-parser.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { isFunctionExpression, toCodeceptWrapper } from '../src/pw-parser.ts';

describe('isFunctionExpression', () => {
  test.each([
    "({ page }) => page.click('text=Login')",
    "async ({ page }) => { await page.fill('#email', 'user@example.com'); await page.keyboard.press('Enter'); }",
    "({ browserContext }) => browserContext.clearCookies()",
    "({ page, browser }) => browser.version()",
    "function ({ page }) { return page.title() }",
  ])('accepts %s', (expr) => {
    expect(isFunctionExpression(expr).valid).toBe(true);
  });

  test.each([
    "page.click('text=Login')",
    "({ page }) => page.click('a'",
    "just some text",
    "",
  ])('rejects %s', (expr) => {
    const result = isFunctionExpression(expr);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('toCodeceptWrapper', () => {
  test('interpolates the function verbatim into usePlaywrightTo', () => {
    const code = toCodeceptWrapper("({ page }) => page.click('text=Login')");
    expect(code).toBe("I.usePlaywrightTo('pw', ({ page }) => page.click('text=Login'))");
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `bun test boat/prima/tests/pw-parser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `boat/prima/src/pw-parser.ts`**

```typescript
const FUNCTION_SHAPE = /^(async\s+)?(function\b|\()/;

export function isFunctionExpression(expr: string): { valid: boolean; error?: string } {
  const trimmed = expr.trim();
  if (!trimmed) return { valid: false, error: 'empty expression; pass a function like ({ page }) => ...' };
  if (!FUNCTION_SHAPE.test(trimmed)) return { valid: false, error: 'expression must be a function like ({ page }) => ... destructuring the playwright objects it needs' };
  try {
    new Function(`return (${trimmed})`);
  } catch (e) {
    return { valid: false, error: `not a valid function expression: ${(e as Error).message}` };
  }
  return { valid: true };
}

export function toCodeceptWrapper(expr: string): string {
  return `I.usePlaywrightTo('pw', ${expr.trim()})`;
}
```

`new Function` is construction-only — the user's code is never invoked here (invoking would execute non-function inputs). The shape regex rejects bare call chains like `page.click(...)` with an error pointing at the expected form; the construction catch turns syntax errors (unbalanced brackets, garbage text) into the `tool:` error in the envelope. Note the shape regex also requires arrow parameters to be parenthesized — acceptable since the destructured `({ page })` form is the documented contract.

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test boat/prima/tests/pw-parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add boat/prima/src/pw-parser.ts boat/prima/tests/pw-parser.test.ts
git commit -m "feat(prima): pw function wrapper"
```

---

### Task 3: Named browser instances in browser-server

**Files:**
- Modify: `src/browser-server.ts` (exports at line 88: `readEndpoint, removeEndpointFile, isServerRunning, launchServer, getEndpointFilePath, getAliveEndpoint`)
- Modify: `bin/explorbot-cli.ts` browser start/stop/status handlers (lines ~736-821) to pass instance through
- Test: `tests/unit/browser-server-instances.test.ts`

**Interfaces:**
- Produces (used by Tasks 4 and 7): every exported function gains an optional trailing `instance = 'default'` parameter; endpoint file becomes `.browser-endpoint` for `default` and `.browser-endpoint-<name>` otherwise. New export:

```typescript
export function listInstances(): Array<{ name: string; endpoint: string }>;
```

- [ ] **Step 1: Read `src/browser-server.ts` fully** — understand `getEndpointFilePath`, `writeEndpoint`, `getAliveEndpoint` before touching anything.

- [ ] **Step 2: Write failing test**

`tests/unit/browser-server-instances.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { getEndpointFilePath } from '../../src/browser-server.ts';

describe('named instances', () => {
  test('default instance keeps legacy filename', () => {
    expect(path.basename(getEndpointFilePath())).toBe('.browser-endpoint');
    expect(path.basename(getEndpointFilePath('default'))).toBe('.browser-endpoint');
  });

  test('named instance gets suffixed filename', () => {
    expect(path.basename(getEndpointFilePath('staging'))).toBe('.browser-endpoint-staging');
  });
});
```

Add a test for `listInstances()` writing two endpoint files into a temp output dir if `getEndpointFilePath` resolves from a configurable root; if the output root comes from config at import time, keep `listInstances` scanning `path.dirname(getEndpointFilePath())` for files matching `.browser-endpoint*` and test via that dir.

- [ ] **Step 3: Run test, verify fail**

Run: `bun test tests/unit/browser-server-instances.test.ts`
Expected: FAIL — `getEndpointFilePath` does not accept an argument (or wrong filename).

- [ ] **Step 4: Implement**

Thread `instance = 'default'` through `getEndpointFilePath`, `readEndpoint`, `writeEndpoint`, `removeEndpointFile`, `isServerRunning`, `getAliveEndpoint`, `launchServer`. Filename: `default` → `.browser-endpoint` (backward compatible), else `.browser-endpoint-${instance}`. Sanitize instance to `[a-z0-9-]` and reject others with a thrown Error. `listInstances()` scans the endpoint dir with `readdirSync`, maps filenames back to names.

- [ ] **Step 5: Run full unit suite**

Run: `bun test tests/unit/`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
bun run format
git add src/browser-server.ts tests/unit/browser-server-instances.test.ts bin/explorbot-cli.ts
git commit -m "feat: named browser server instances"
```

---

### Task 4: Prima class core — lifecycle and pw command

**Files:**
- Create: `boat/prima/src/prima.ts`
- Test: `boat/prima/tests/prima.test.ts`

**Interfaces:**
- Consumes: `renderEnvelope`/`writeArtifacts`/`EnvelopeData`/`InstanceInfo` (Task 1), `isFunctionExpression`/`toCodeceptWrapper` (Task 2), `getAliveEndpoint(instance)`/`launchServer` (Task 3), `ExplorBot` API (`src/explorbot.ts`: `start()`, `stop()`, `visit(url)`, `getExplorer()`, `stateManager()`, `getCurrentState()`, `agentNavigator()`, `agentResearcher()`, `agentHistorian()`, `requestStore()`), `Explorer.action(): Action` (`src/explorer.ts:151`), `Action.execute(code)` / `Action.capturePageState()` (`src/action.ts:64-68`), `ActionResult` (`getStateHash()`, `ariaSnapshot`, `combinedHtml()`, `url`, `title`), `compactAriaSnapshot` (`src/utils/aria.ts`), `Diff`/`PageDiff` via `ActionResult` (`src/action-result.ts`).
- Produces (used by Tasks 5–7, 9):

```typescript
export interface PrimaOptions {
  verbose?: boolean;
  config?: string;
  path?: string;
  instance?: string;
  session?: string;
  heal?: boolean;
  ephemeral?: boolean;
  framework?: 'codeceptjs' | 'playwright';
  noVision?: boolean;
  url?: string;
}
export class Prima {
  constructor(options?: PrimaOptions);
  async start(): Promise<void>;
  async stop(): Promise<void>;
  async pw(expression: string): Promise<EnvelopeData>;
  async instanceInfo(): Promise<InstanceInfo>;
}
```

- [ ] **Step 1: Study `boat/doc-collector/src/docbot.ts`** — the Prima mirrors how DocBot wraps ExplorBot (constructor builds `new ExplorBot({...})`, `start()` boots it, agents accessed lazily).

- [ ] **Step 2: Write failing tests with duck-typed mocks**

`boat/prima/tests/prima.test.ts` — follow the duck-type-mock style of `tests/integration/` (mock Explorer/StateManager, no real browser):

```typescript
import { describe, expect, test } from 'bun:test';
import { Prima } from '../src/prima.ts';

function fakeState(over: Record<string, unknown> = {}) {
  return {
    url: 'https://app.example.com/login',
    title: 'Login',
    getStateHash: () => 'login_h1_login',
    ariaSnapshot: '- textbox "Email"\n- button "Sign in"',
    combinedHtml: () => '<form></form>',
    ...over,
  };
}

function fakePrima() {
  const prima = new Prima({ instance: 'default' });
  const executed: string[] = [];
  const after = fakeState({ url: 'https://app.example.com/dashboard', title: 'Dashboard', getStateHash: () => 'dashboard_h1_dashboard' });
  (prima as any).bot = {
    getExplorer: () => ({
      action: () => ({
        execute: async (code: string) => {
          executed.push(code);
          return { actionResult: after, lastError: null };
        },
      }),
      capture: async () => after,
    }),
    stateManager: () => ({
      getCurrentState: () => fakeState(),
      getVisitCount: () => 1,
    }),
    requestStore: () => ({ getRequests: () => [] }),
  };
  (prima as any).artifactsDir = '/tmp/prima-test';
  return { prima, executed };
}

describe('Prima.pw', () => {
  test('rejects non-function argument as tool error without executing', async () => {
    const { prima, executed } = fakePrima();
    const envelope = await prima.pw("page.click('text=Login')");
    expect(envelope.ok).toBe(false);
    expect(envelope.failure?.error).toContain('function');
    expect(executed.length).toBe(0);
  });

  test('executes wrapped function and returns success envelope data', async () => {
    const { prima, executed } = fakePrima();
    const envelope = await prima.pw("({ page }) => page.click('text=Login')");
    expect(executed[0]).toContain("I.usePlaywrightTo");
    expect(envelope.ok).toBe(true);
    expect(envelope.used).toEqual(["({ page }) => page.click('text=Login')"]);
    expect(envelope.page.url).toBe('https://app.example.com/dashboard');
    expect(envelope.page.previousUrl).toBe('https://app.example.com/login');
  });
});
```

- [ ] **Step 3: Run tests, verify fail**

Run: `bun test boat/prima/tests/prima.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement Prima core**

`boat/prima/src/prima.ts` responsibilities in this task:
- Constructor stores options, builds `ExplorBot` options (`config`, `path`, `verbose`, `session`, `headless: true`) — but do NOT boot in constructor (DocBot pattern).
- `start()`: resolve instance endpoint via `getAliveEndpoint(this.options.instance ?? 'default')`; when absent, throw an Error instructing the caller to create a session first — start one with playwright-cli (`playwright-cli open <url>`) or `prima browser start` (the CLI renders it as a `tool:` failure envelope, exit 1). NEVER launch a browser implicitly. Then `await this.bot.start()`. When `options.url` is set and no current state exists, `await this.bot.visit(options.url)`. (Task 11 retrofits the playwright-cli attach ladder in front of this owned-instance path — keep the owned-instance lookup in a private method Task 11 calls late in its ladder.)
- `pw(expression)`:
  1. `isFunctionExpression` — invalid → return tool-error envelope (`ok: false`, `failure.error` prefixed `tool:`), never execute.
  2. Capture `before = stateManager.getCurrentState()`.
  3. `const action = explorer.action(); await action.execute(toCodeceptWrapper(expression))`.
  4. On success build `EnvelopeData` with `used: [expression]`, page block from resulting `ActionResult` (`previousUrl` from `before`), `changes` from the pageDiff ariaChanges the Action pipeline computed (see `ActionResult.toToolResult` usage in `src/ai/tools.ts:1122` for how diffs are obtained — reuse the same path, do not recompute).
  5. Write artifacts via `writeArtifacts(this.nextArtifactDir(), { aria: result.ariaSnapshot, html: result.combinedHtml(), requests: this.bot.requestStore().getRequests() })`.
  6. On execution error: this task returns a plain failure envelope (heal comes in Task 5).
- `instanceInfo()`: name from options; tabs from `explorer` playwright context pages count (add a small public accessor if none exists — check `src/explorer.ts:79` `playwrightHelper?.page`); others from `listInstances()` (Task 3) excluding self; tabs for others may be reported as 0 when unreachable — do not connect to other instances.
- `nextArtifactDir()`: `<output>/prima/<ISO-timestamp>/`, one per command invocation.

Mockability rule: everything the tests stub lives behind `this.bot` — keep all ExplorBot access via that single field.

- [ ] **Step 5: Run tests, verify pass**

Run: `bun test boat/prima/tests/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bun run format
git add boat/prima
git commit -m "feat(prima): Prima core with pw execution and instance info"
```

---

### Task 5: Heal loop

**Files:**
- Modify: `src/ai/navigator.ts:192` (`resolveState` signature), `boat/prima/src/prima.ts`
- Test: `boat/prima/tests/prima.test.ts` (extend), `tests/integration/` untouched

**Interfaces:**
- Consumes: `navigator.resolveState(message, actionResult, opts)` (`src/ai/navigator.ts:192`).
- Produces: `resolveState` opts gains `onAttempt?: (attempt: { code: string; error?: string }) => void`, invoked once per executed recovery attempt with the exact code string and the error message when it failed. Prima gains private `heal(...)` used by pw (and Task 6 commands).

- [ ] **Step 1: Extend `resolveState` with the attempt hook**

Read `src/ai/navigator.ts` `resolveState` implementation; find where recovery code executes (each `action.execute`/attempt site). Add `opts.onAttempt` invocation at each attempt completion with `{ code, error: lastError?.message }`. Smallest change possible; no behavior change when the callback is absent.

- [ ] **Step 2: Write failing Prima heal test**

Extend `boat/prima/tests/prima.test.ts`; stub `agentNavigator` on the fake bot:

```typescript
test('failed pw heals via navigator and reports healed envelope', async () => {
  const { prima } = fakePrima();
  (prima as any).bot.getExplorer = () => ({
    action: () => ({
      execute: async () => {
        throw new Error("locator 'text=Login' not found");
      },
    }),
    capture: async () => fakeState(),
  });
  (prima as any).bot.agentNavigator = () => ({
    resolveState: async (_msg: string, _result: unknown, opts: any) => {
      opts?.onAttempt?.({ code: "I.click('Login')", error: 'not visible' });
      opts?.onAttempt?.({ code: "I.click('#login-btn')" });
      return true;
    },
  });
  const envelope = await prima.pw("({ page }) => page.click('text=Login')");
  expect(envelope.ok).toBe(true);
  expect(envelope.healed).toBe(true);
  expect(envelope.used).toEqual(["I.click('#login-btn')"]);
});

test('exhausted heal returns failure envelope with attempts and compact aria', async () => {
  const { prima } = fakePrima();
  (prima as any).bot.getExplorer = () => ({
    action: () => ({
      execute: async () => {
        throw new Error("locator 'text=Login' not found");
      },
    }),
    capture: async () => fakeState(),
  });
  (prima as any).bot.agentNavigator = () => ({
    resolveState: async (_msg: string, _result: unknown, opts: any) => {
      opts?.onAttempt?.({ code: "I.click('Login')", error: 'not visible' });
      return false;
    },
  });
  const envelope = await prima.pw("({ page }) => page.click('text=Login')");
  expect(envelope.ok).toBe(false);
  expect(envelope.failure?.attempts.length).toBe(1);
  expect(envelope.failure?.compactAria).toContain('button');
});
```

- [ ] **Step 3: Run tests, verify fail**

Run: `bun test boat/prima/tests/prima.test.ts`
Expected: new tests FAIL (heal not implemented).

- [ ] **Step 4: Implement heal in Prima**

Private `heal(errorMessage, actionResult, originalCode)`:
- Skip entirely when `options.heal === false` — go straight to failure envelope.
- Skip with an envelope note (`healed: false (ai unavailable)`) when no AI provider is usable — `pw` must keep working without AI.
- Collect attempts array via `onAttempt`; call `navigator.resolveState(errorMessage, actionResult, { onAttempt })`.
- `true` → success envelope: `healed: true`, `healNote` = last attempt outcome summary, `used` = codes of successful attempts (last attempt without error), current state re-read from `stateManager.getCurrentState()`.
- `false` → failure envelope: `error`, `attempts` (map error→outcome, success→'ok'), `compactAria` from `compactAriaSnapshot(state.ariaSnapshot, true)` (`src/utils/aria.ts`), reasoning left to Task 8's compaction if trivial — set `reasoning` to a one-line join of distinct outcomes for now (general, not model-generated).
- Failure envelopes still include artifacts and instance blocks.

- [ ] **Step 5: Run boat tests and repo unit tests**

Run: `bun test boat/prima/tests/ tests/unit/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bun run format
git add src/ai/navigator.ts boat/prima
git commit -m "feat(prima): heal loop over navigator recovery with attempt trace"
```

---

### Task 6: do, click, fill, ask, verify, research commands

**Files:**
- Modify: `boat/prima/src/prima.ts`
- Test: `boat/prima/tests/prima.test.ts` (extend)

**Interfaces:**
- Consumes: `collectInteractiveNodes(snapshot)` (`src/utils/aria.ts`), `createCodeceptJSTools` (`src/ai/tools.ts:30`) — tool objects expose `.execute(input)`; `provider.invokeConversation` with `maxToolRoundtrips` (Driller pattern, `src/ai/driller.ts:325-329`); `researcher.answerQuestionAboutScreenshot(state, question)` and `researcher.summary(state)` (`src/ai/researcher.ts:544, 659`); `navigator.verifyState(message, actionResult)` (`src/ai/navigator.ts:618`) returning `{ verified, successfulCodes, assertionSteps, totalAttempted }`.
- Produces:

```typescript
async do(instructions: string[]): Promise<EnvelopeData>;
async click(target: string): Promise<EnvelopeData>;
async fill(field: string, value: string): Promise<EnvelopeData>;
async ask(question: string): Promise<EnvelopeData>;
async verify(assertion: string): Promise<EnvelopeData>;
async research(opts?: { data?: boolean; deep?: boolean; fresh?: boolean }): Promise<EnvelopeData>;
```

`EnvelopeData` gains an optional `research?: string` field (Task 1's renderer: `### Research` replaces `### Changes` when set, mutually exclusive with `answer`/`verdict` — add a render test alongside the answer/verdict ones).

- [ ] **Step 1: Write failing tests**

```typescript
test('do runs a bounded AI loop over the instruction set', async () => {
  const { prima } = fakePrima();
  const prompts: string[] = [];
  (prima as any).bot.getProvider = () => ({
    startConversation: () => ({ addUserText: (t: string) => prompts.push(t) }),
    invokeConversation: async () => ({ toolExecutions: [{ toolName: 'click', args: { locator: 'Login' }, result: { success: true, code: "I.click('Login')" } }] }),
  });
  const envelope = await prima.do(['open the first invoice', 'download its PDF']);
  expect(prompts.join('\n')).toContain('open the first invoice');
  expect(prompts.join('\n')).toContain('download its PDF');
  expect(envelope.used).toEqual(["I.click('Login')"]);
  expect(envelope.ok).toBe(true);
});

test('click is a single-instruction alias over do', async () => {
  const { prima } = fakePrima();
  const received: string[][] = [];
  (prima as any).do = async (instructions: string[]) => { received.push(instructions); return { ok: true }; };
  await prima.click('the login link');
  expect(received[0].length).toBe(1);
  expect(received[0][0]).toContain('the login link');
});

test('verify returns verdict with assertion code', async () => {
  const { prima } = fakePrima();
  (prima as any).bot.agentNavigator = () => ({
    verifyState: async () => ({ verified: true, successfulCodes: ["I.see('Dashboard')"], assertionSteps: [], totalAttempted: 1 }),
  });
  const envelope = await prima.verify('user sees the dashboard');
  expect(envelope.verdict?.passed).toBe(true);
  expect(envelope.verdict?.code).toBe("I.see('Dashboard')");
});

test('research returns UI map in envelope', async () => {
  const { prima } = fakePrima();
  (prima as any).bot.agentResearcher = () => ({ research: async () => '## Section: Login Form\n| Element | ARIA | CSS |' });
  const envelope = await prima.research({ data: true });
  expect(envelope.research).toContain('Login Form');
  expect(envelope.ok).toBe(true);
});

test('ask defaults to vision via screenshot analysis', async () => {
  const { prima } = fakePrima();
  (prima as any).bot.getProvider = () => ({ hasVision: () => true });
  (prima as any).bot.agentResearcher = () => ({ answerQuestionAboutScreenshot: async () => 'A login page with an email form' });
  const envelope = await prima.ask('what do I see?');
  expect(envelope.answer).toContain('login');
});

test('ask with noVision answers from researcher summary', async () => {
  const { prima } = fakePrima();
  (prima as any).options.noVision = true;
  (prima as any).bot.agentResearcher = () => ({ summary: async () => 'Login form with email and password' });
  (prima as any).bot.getProvider = () => ({ chat: async () => ({ text: 'A login page with an email form' }) });
  const envelope = await prima.ask('what do I see?');
  expect(envelope.answer).toContain('login');
});
```

- [ ] **Step 2: Run tests, verify fail** — `bun test boat/prima/tests/prima.test.ts`.

- [ ] **Step 3: Implement**

- `do(instructions)`: tester-style bounded AI loop, no deterministic path (callers describe elements, they never hold locators — precision belongs to `pw`). One conversation via `provider.startConversation(...)` with a dedent system prompt: current compact ARIA + relevant experience TOC + the numbered instruction list + rule to perform the instructions in order and stop when done. Execute `provider.invokeConversation(conversation, createCodeceptJSTools(explorer, ...), { maxToolRoundtrips: 5 })` per iteration, re-injecting fresh page context between iterations when state changed (same pattern as Driller's bounded loop, `src/ai/driller.ts:325-329`), capped at `min(instructions.length + 2, 6)` iterations. Collect executed codes from tool results into `used`. Failures feed `heal(...)` from Task 5.
- `click(target)`: alias — `this.do([`click ${target}`])`. `fill(field, value)`: alias — `this.do([`fill ${field} with value: ${value}`])`. Phrase construction must stay general (verb + caller's description verbatim), never enumerate app-specific element names.
- AI-availability guard: every model-requiring command (`do`, `click`, `fill`, `ask`, `verify`, `research`, intent-`go`) checks provider availability first (provider construction failed, or no model configured — surface the underlying reason from `bot.getProvider()`/config); on failure return a tool-error envelope whose message states the reason and suggests the fallback: use playwright-cli for direct browser control, or fix AI config (`~/.explorbot/config.js` / `EXPLORBOT_AI_PROVIDER`). Add a test: provider getter throws → `do` returns `ok: false` with error containing 'playwright-cli'. The message must describe the failure layer generally — never hardcode a specific provider's error text.
- `ask(question)`: vision by default — `researcher.answerQuestionAboutScreenshot(state, question)`; falls to the text path when `options.noVision` or `!provider.hasVision()` (`src/ai/provider.ts:635`; append a one-line note to the answer when degrading for the latter reason). Text path: `provider.chat` over dedent prompt containing `researcher.summary(state)` + compact ARIA + the question. Non-mutating: envelope has `answer`, no `changes`, artifacts still written.
- `verify(assertion)`: `explorer.capture()` then `navigator.verifyState(assertion, actionResult)`; verdict `{ passed: verified, evidence: <first successful step or failure note>, code: successfulCodes.join('\n') }`.
- `research(opts)`: `researcher.research(state, { screenshot: true, data: opts.data, deep: opts.deep, force: opts.fresh })` (`src/ai/researcher.ts:94`); envelope `research` = returned UI map verbatim (staleness banner included when cached), no `changes`. Non-mutating; artifacts still written.
- All command methods end by building `used` from actually executed code (never the requested input when they differ).

- [ ] **Step 4: Run tests, verify pass** — `bun test boat/prima/tests/`.

- [ ] **Step 5: Commit**

```bash
bun run format
git add boat/prima
git commit -m "feat(prima): do, click, fill, ask, verify commands"
```

---

### Task 7: go command and browser instance management

**Files:**
- Modify: `boat/prima/src/prima.ts`
- Test: `boat/prima/tests/prima.test.ts` (extend)

**Interfaces:**
- Consumes: `navigator.visit(destination)` (`src/ai/navigator.ts:140` — handles both URLs and NL/state destinations, same call the TUI `/navigate` uses per `src/commands/navigate-command.ts`), Task 3 instance functions.
- Produces:

```typescript
async go(target: string): Promise<EnvelopeData>;
async browserStart(): Promise<void>;
async browserStop(all?: boolean): Promise<void>;
async browserStatus(): Promise<string>;
```

- [ ] **Step 1: Write failing tests**

```typescript
test('go delegates to navigator.visit and returns envelope', async () => {
  const { prima } = fakePrima();
  const visited: string[] = [];
  (prima as any).bot.agentNavigator = () => ({ visit: async (dest: string) => { visited.push(dest); } });
  const envelope = await prima.go('billing settings');
  expect(visited).toEqual(['billing settings']);
  expect(envelope.ok).toBe(true);
  expect(envelope.page.url).toBeTruthy();
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement**

- `go(target)`: `navigator.visit(target)` (it resolves URL vs intent internally); envelope from resulting state; navigation errors feed `heal`.
- `browserStart/Stop/Status`: thin delegation to Task 3's browser-server functions with `options.instance`; `browserStop(true)` iterates `listInstances()`. Status string includes what `instanceInfo()` knows.
- No implicit launch: verify `go` (like every command) fails with the create-a-session guidance when no browser is available. `browserStart()` is the only launch path; with `options.session` set there, the launched context loads storage state (Explorer already honors `session` — `src/explorer.ts:106,337`).

- [ ] **Step 4: Run tests, verify pass; commit**

```bash
bun run format
git add boat/prima
git commit -m "feat(prima): go command and instance management"
```

---

### Task 8: Config ladder — global config, global .env, per-host state dir

**Files:**
- Modify: `src/config.ts` (`ConfigParser.loadConfig` at line 324, `buildEnvConfig` at line 489, `resolveOutputRoot` at line 667)
- Test: `tests/unit/config-ladder.test.ts`

**Interfaces:**
- Produces: `loadConfig` resolution order becomes: explicit `--config` path → project `explorbot.config.js|ts` in cwd → `~/.explorbot/config.js|ts` → env-var config (`buildEnvConfig`). `.env` loading order: cwd `.env` (existing behavior) then `~/.explorbot/.env` (only for keys not already set). All home paths via `os.homedir()` — one cross-platform dir, no XDG/AppData branching. New exported helper:

```typescript
export function resolveStateRoot(baseUrl: string, ephemeral?: boolean): string;
```

returning `~/.explorbot/state/<host>/` (created), or a `mkdtempSync` temp dir when `ephemeral`.

- [ ] **Step 1: Read `src/config.ts` load path fully** (lines 297-560) before changing anything.

- [ ] **Step 2: Write failing tests**

`tests/unit/config-ladder.test.ts`:

```typescript
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveStateRoot } from '../../src/config.ts';

describe('resolveStateRoot', () => {
  test('derives persistent per-host dir', () => {
    const dir = resolveStateRoot('https://app.example.com/login');
    expect(dir).toBe(path.join(os.homedir(), '.explorbot', 'state', 'app.example.com'));
    expect(existsSync(dir)).toBe(true);
  });

  test('ephemeral returns fresh temp dir', () => {
    const a = resolveStateRoot('https://app.example.com', true);
    const b = resolveStateRoot('https://app.example.com', true);
    expect(a).not.toBe(b);
    expect(a).toContain('explorbot');
  });
});
```

Global-config precedence test: point `ConfigParser.loadConfig` at a temp `HOME` (set `process.env.HOME` in the test, restore in `afterEach`; note `os.homedir()` ignores `$HOME` on Windows — gate the test or stub `homedir` if CI runs there), write `~/.explorbot/config.js` exporting a marker value, assert it loads when cwd has no project config and that a project config wins when both exist. Follow existing config tests in `tests/unit/` for how ConfigParser is instantiated.

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement**

- `resolveStateRoot`: host from `new URL(baseUrl).host`; `mkdirSync(..., { recursive: true })`; ephemeral via `mkdtempSync(path.join(os.tmpdir(), 'explorbot-'))`.
- In `loadConfig`: after project-config lookup misses, try `path.join(os.homedir(), '.config', 'explorbot', 'config.js')` then `.ts` through the existing `loadConfigModule`.
- `.env`: where the existing cwd `.env` loads, additionally load `~/.explorbot/.env` without overwriting already-set keys.
- In `buildEnvConfig` (config-free mode): when no project config, set `dirs` (knowledge/experience/output) under `resolveStateRoot(baseUrl, ephemeralFlag)`; ephemeral flag arrives via new `EXPLORBOT_EPHEMERAL` env var so the boat can pass it without new plumbing.

- [ ] **Step 5: Run full unit suite** — `bun test tests/unit/` — PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
bun run format
git add src/config.ts tests/unit/config-ladder.test.ts
git commit -m "feat: global config ladder and per-host state dirs"
```

---

### Task 9: CLI wiring and --help contract

**Files:**
- Create: `boat/prima/src/cli.ts`, `boat/prima/bin/prima-cli.ts`
- Modify: `bin/explorbot-cli.ts` (add near line 874: `program.addCommand(createPrimaCommands('prima'))`)
- Test: manual smoke via `--help` (Step 4)

**Interfaces:**
- Consumes: `Prima`/`PrimaOptions` (Tasks 4-7), `renderEnvelope` (Task 1).
- Produces: `export function createPrimaCommands(name = 'prima'): Command`.

- [ ] **Step 1: Implement `boat/prima/src/cli.ts`**

Mirror `boat/doc-collector/src/cli.ts` structure (`addCommonOptions`, `buildOptions`, subcommands). Subcommands: `pw <fn>`, `do <instructions...>` (variadic — each arg is one high-level instruction), `click <target>`, `fill <field> <value>`, `ask <question>`, `verify <assertion>` (alias `assert`), `research` (flags `--data`, `--deep`, `--fresh`), `go <target>`, `browser <start|stop|status|list>`. Common options:

```
-v, --verbose            --debug
-c, --config <path>      -p, --path <path>
-i, --instance <name>    --session [file]
--no-heal                --ephemeral
--framework <name>       --no-vision   (ask only)
--url <url>              (start page for config-free mode)
--endpoint <ep>          --pw-session <title>   (attach to playwright-cli browser, Task 11)
```

Every action handler: `setPreserveConsoleLogs(true)`, build `Prima`, `await prima.start()`, run the method, `console.log(renderEnvelope(result))`, `await prima.stop()`, `process.exit(result.ok ? 0 : 1)`. `--ephemeral` sets `process.env.EXPLORBOT_EPHEMERAL = '1'` before Prima construction. Zero business logic in handlers.

- [ ] **Step 2: Write the --help contract text**

The command description plus `addHelpText('after', ...)` on the `prima` group is the sole teaching surface for orchestrating agents. It must compactly cover (dedent block, ~40 lines): the tiering (pw = precise with a locator you hold, click/fill = one described action AI-resolved, do = a set of high-level instructions run tester-style — never pass locators to NL commands, never pass descriptions to pw), the recommended loop (research once for verified locators → drive with pw → verify; reach for do/click when you have no locator), the envelope sections and their meaning, `used:` as reusable verified code, heal semantics and `--no-heal`, failure = inline compact ARIA + artifact file paths for deep dives, `--instance` vs `--session`, the no-implicit-launch rule (create sessions via playwright-cli or `prima browser start`), the AI-unavailable fallback (use playwright-cli directly), the close-when-finished convention driven by `### Instance`, and one usage example per tier. General shapes only — no app-specific examples.

- [ ] **Step 3: Wire into main CLI and standalone bin**

- `bin/explorbot-cli.ts`: `import { createPrimaCommands } from '../boat/prima/src/cli.ts';` + `program.addCommand(createPrimaCommands('prima'));` next to the existing api/docs registrations (line ~874).
- `boat/prima/bin/prima-cli.ts`: mirror `boat/api-tester/bin` entry — a commander program that mounts the same subcommands at top level.

- [ ] **Step 4: Smoke the help output**

Run: `bun bin/explorbot-cli.ts prima --help` and `bun boat/prima/bin/prima-cli.ts --help`
Expected: full contract text, all 8 subcommands listed, no banner noise with `EXPLORBOT_NO_BANNER=1`.

- [ ] **Step 5: Commit**

```bash
bun run format && bun run lint:fix
git add boat/prima bin/explorbot-cli.ts
git commit -m "feat(prima): prima CLI namespace and standalone prima bin"
```

---

### Task 10: End-to-end smoke, changelog, docs

**Files:**
- Create: `tests/node/prima-smoke.test.ts` (or `tests/regression/` — match where existing browser-driving tests live; inspect both dirs first)
- Modify: `docs/reference/commands.md`, `CHANGELOG.md` (via `/changelog` skill at commit time)

- [ ] **Step 1: Inspect existing e2e/browser test setup** — `tests/node/` and `tests/regression/` — reuse their fixture-server pattern for a local page (a form with a button and an input; fictional content only).

- [ ] **Step 2: Write the smoke test**

Scenarios, driven through the `Prima` class directly against the local fixture (real browser, no AI provider needed for these paths):
1. `pw "({ page }) => page.click('text=Submit')"` on the fixture → `ok: true`, envelope contains `### Changes` and artifact files exist on disk.
2. `pw` with a non-function argument → `ok: false`, `tool:`-prefixed error, exit path returns without browser action.
3. `do`/`click` are NOT in the browser smoke (they always require a model) — cover them in `tests/integration/prima-do.test.ts` via aimock: mock model returns click tool calls for a two-instruction `do`, assert both instructions appear in the prompt, `used` collects executed codes, envelope `ok: true`.
4. No implicit launch: run without any browser session → failure envelope containing the create-a-session guidance (`playwright-cli open` mentioned), exit code 1, and no endpoint file created.
5. `pw` with no AI provider configured: executes normally, envelope notes healing unavailable.

Heal-path e2e requires an AI provider — cover it with an aimock integration test in `tests/integration/prima-heal.test.ts` following `tests/integration/planner.test.ts` (mock provider returns a recovery instruction; assert `healed: true` envelope and `onAttempt` trace).

- [ ] **Step 3: Run everything**

Run: `bun test boat/prima/tests/ tests/unit/ tests/integration/` plus the smoke file.
Expected: all PASS.

- [ ] **Step 4: Document**

Add an "Prima boat" section to `docs/reference/commands.md`: command table, envelope sample, tiering guidance, instance/session flags, config-free example (`EXPLORBOT_AI_PROVIDER=groq explorbot prima go https://app.example.com`).

- [ ] **Step 5: Final checks and commit**

```bash
bun run format && bun run check:fix
```

Invoke the `/changelog` skill, then:

```bash
git add -A
git commit -m "feat(prima): e2e smoke, docs and changelog"
```

---

### Task 11: playwright-cli browser attach (Playwright-protocol registry)

Prima's default browser source becomes the playwright-cli daemon's browser for this workspace; prima's own daemon is the fallback. Every playwright-cli daemon browser is auto-`bind()`-ed as a Playwright-protocol server with a descriptor JSON in `~/.cache/ms-playwright/b/<guid>` (Linux `$XDG_CACHE_HOME/ms-playwright/b` fallback `~/.cache/...`; macOS `~/Library/Caches/ms-playwright/b`; Windows `%LOCALAPPDATA%\ms-playwright\b`) shaped `{ playwrightVersion, playwrightLib, title, endpoint, workspaceDir, browser: { browserName } }` where `title` is the playwright-cli session name (`default` unless `-s=`/`PLAYWRIGHT_CLI_SESSION`).

**Files:**
- Create: `boat/prima/src/pw-registry.ts`
- Modify: `boat/prima/src/actor.ts` (`start()` ladder), `boat/prima/src/cli.ts` (`--endpoint`, `--pw-session`), `src/explorer.ts` (attach path: adopt existing browser/context)
- Test: `boat/prima/tests/pw-registry.test.ts`, `boat/prima/tests/prima.test.ts` (extend)

**Interfaces:**
- Consumes: `PrimaOptions` (Task 4) gains `endpoint?: string; pwSession?: string`; `InstanceInfo.attached` (Task 1); Explorer internals `playwrightHelper.browser` / `_createContextPage` (`src/explorer.ts:107,146` — Explorer already assigns `playwrightHelper.browser`, so injection is supported).
- Produces:

```typescript
export interface PwServerDescriptor {
  file: string;
  title: string;
  endpoint: string;
  workspaceDir: string;
  browserName: string;
  playwrightLib: string;
}
export function registryDir(): string;
export function readDescriptors(dir?: string): PwServerDescriptor[];
export function selectDescriptor(descriptors: PwServerDescriptor[], opts: { workspaceDir: string; title?: string }): { match?: PwServerDescriptor; candidates: PwServerDescriptor[] };
```

- [ ] **Step 1: Write failing registry tests**

`boat/prima/tests/pw-registry.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDescriptors, selectDescriptor } from '../src/pw-registry.ts';

function writeDescriptor(dir: string, name: string, data: Record<string, unknown>) {
  writeFileSync(path.join(dir, name), JSON.stringify({ playwrightVersion: '1.62.0', playwrightLib: '/lib/pw', endpoint: `/tmp/pw/${name}.sock`, browser: { browserName: 'chromium' }, ...data }));
}

describe('readDescriptors', () => {
  test('parses descriptor files and skips malformed ones', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
    writeDescriptor(dir, 'a', { title: 'default', workspaceDir: '/work/app' });
    writeFileSync(path.join(dir, 'broken'), 'not json');
    const list = readDescriptors(dir);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('default');
    expect(list[0].browserName).toBe('chromium');
  });
});

describe('selectDescriptor', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
  writeDescriptor(dir, 'a', { title: 'default', workspaceDir: '/work/app' });
  writeDescriptor(dir, 'b', { title: 'auth', workspaceDir: '/work/app' });
  writeDescriptor(dir, 'c', { title: 'default', workspaceDir: '/work/other' });
  const all = readDescriptors(dir);

  test('explicit title wins within workspace', () => {
    const { match } = selectDescriptor(all, { workspaceDir: '/work/app', title: 'auth' });
    expect(match?.title).toBe('auth');
  });

  test('default title picked for workspace when present', () => {
    const { match } = selectDescriptor(all, { workspaceDir: '/work/app' });
    expect(match?.title).toBe('default');
  });

  test('single survivor for workspace picked without title', () => {
    const { match } = selectDescriptor(all, { workspaceDir: '/work/other' });
    expect(match?.workspaceDir).toBe('/work/other');
  });

  test('no workspace match returns candidates empty', () => {
    const { match, candidates } = selectDescriptor(all, { workspaceDir: '/elsewhere' });
    expect(match).toBeUndefined();
    expect(candidates.length).toBe(0);
  });

  test('ambiguity returns no match with candidates listed', () => {
    const noDefault = all.filter((d) => d.title !== 'default');
    const extra = [...noDefault, { ...noDefault[0], title: 'second' }];
    const { match, candidates } = selectDescriptor(extra, { workspaceDir: '/work/app' });
    expect(match).toBeUndefined();
    expect(candidates.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `bun test boat/prima/tests/pw-registry.test.ts`.

- [ ] **Step 3: Implement `pw-registry.ts`**

- `registryDir()`: per-OS cache root (`process.platform`: darwin → `~/Library/Caches/ms-playwright/b`; win32 → `path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright', 'b')`; else `path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'ms-playwright', 'b')`).
- `readDescriptors(dir = registryDir())`: `readdirSync` (return `[]` when dir missing), JSON.parse each file, skip on parse error or missing `endpoint`/`title`/`workspaceDir`, map to `PwServerDescriptor`.
- `selectDescriptor`: filter by `workspaceDir` (compare `path.resolve` of both); explicit title → exact match; no title → prefer `title === 'default'`, else single survivor; ambiguity or explicit-title miss → `{ candidates }` with no match.

- [ ] **Step 4: Run, verify pass; commit**

```bash
bun run format
git add boat/prima/src/pw-registry.ts boat/prima/tests/pw-registry.test.ts
git commit -m "feat(prima): playwright-cli browser-server registry discovery"
```

- [ ] **Step 5: Write failing attach-ladder test in `prima.test.ts`**

```typescript
test('start attaches to workspace playwright-cli browser before own daemon', async () => {
  const prima = new Prima({});
  const calls: string[] = [];
  (prima as any).discover = () => ({ match: { title: 'default', endpoint: '/tmp/pw/a.sock', workspaceDir: process.cwd(), browserName: 'chromium', playwrightLib: '/lib/pw', file: 'a' }, candidates: [] });
  (prima as any).attachToEndpoint = async (d: unknown) => { calls.push('attach'); };
  (prima as any).connectOwnInstance = async () => { calls.push('own'); return true; };
  await prima.start();
  expect(calls).toEqual(['attach']);
});

test('start uses explicitly started own instance when nothing attachable', async () => {
  const prima = new Prima({});
  const calls: string[] = [];
  (prima as any).discover = () => ({ candidates: [] });
  (prima as any).attachToEndpoint = async () => { calls.push('attach'); };
  (prima as any).connectOwnInstance = async () => { calls.push('own'); return true; };
  await prima.start();
  expect(calls).toEqual(['own']);
});

test('start fails with playwright-cli guidance when no session exists anywhere', async () => {
  const prima = new Prima({});
  (prima as any).discover = () => ({ candidates: [] });
  (prima as any).connectOwnInstance = async () => false;
  await expect(prima.start()).rejects.toThrow(/playwright-cli open/);
});

test('ambiguous sessions surface as tool error listing candidates', async () => {
  const prima = new Prima({});
  (prima as any).discover = () => ({ candidates: [{ title: 'auth' }, { title: 'smoke' }] });
  await expect(prima.start()).rejects.toThrow(/auth.*smoke|smoke.*auth/);
});
```

- [ ] **Step 6: Run, verify fail; implement the ladder in `Prima.start()`**

Order: `options.endpoint` (skip discovery, attach directly) → `discover()` = `selectDescriptor(readDescriptors(), { workspaceDir: resolved cwd, title: options.pwSession ?? process.env.PLAYWRIGHT_CLI_SESSION })` → match → `attachToEndpoint(descriptor)` → no match, candidates non-empty → throw Error listing candidate titles (CLI renders it as a `tool:` failure envelope) → no candidates → `connectOwnInstance()` (Task 4's alive-endpoint lookup, extracted private method returning boolean; it never launches) → false → throw Error with the create-a-session guidance naming `playwright-cli open <url>` first and `prima browser start` second. Record attachment description for `InstanceInfo.attached` (`playwright-cli session "<title>", workspace <dir>`).

`attachToEndpoint(descriptor)`:
- Liveness probe: attempt `playwright[descriptor.browserName].connect(descriptor.endpoint, { timeout: 3000 })` with our own playwright-core import; on handshake/version failure, retry once with `require(descriptor.playwrightLib)` (daemon's own lib — the version-skew escape playwright-cli itself uses); on both failing, treat descriptor as dead and continue the ladder.
- Inject into Explorer: assign the connected browser to `playwrightHelper.browser` and adopt the browser's existing default context and its last open page instead of `_createContextPage()` (add an Explorer attach path beside `src/explorer.ts:107`; keep it the smallest change that skips context creation and skips `storageState` — `--session` is ignored in attached mode).
- Lifecycle guards: mark `this.attachedExternally = true`; `stop()`/`browserStop()` call `browser.close()`, which for a `connect()`ed browser is documented as disconnect-only ("clears all created contexts belonging to this browser and disconnects from the browser server" — pre-existing contexts survive; since prima adopts the existing context rather than creating one, nothing of the shared browser is torn down). Never remove registry/endpoint files. Add a unit test asserting `stop()` in attached mode does not invoke the daemon-kill path.

- [ ] **Step 7: Run all boat tests** — `bun test boat/prima/tests/` — PASS.

- [ ] **Step 8: Wire CLI flags and help**

`--endpoint <ep>` and `--pw-session <title>` in `addCommonOptions` (Task 9); extend `browser list` output with attachable playwright-cli sessions from `readDescriptors()` for this workspace; extend the `--help` contract text: prima attaches to the workspace's playwright-cli browser by default — mixed playwright-cli + prima workflows on the same tabs are the intended usage.

- [ ] **Step 9: Commit**

```bash
bun run format
git add boat/prima src/explorer.ts
git commit -m "feat(prima): attach to playwright-cli browser via protocol registry"
```

---

## Self-Review Notes

- Spec coverage: pw/do/click/fill/ask/verify+assert/research/go (Tasks 4-7, 9), playwright-cli attach ladder + `--endpoint`/`--pw-session` + attached lifecycle (Task 11), envelope + used code (1, 4), heal + attempt trace + `--no-heal` + ai-unavailable skip (5), instances + no-implicit-launch + `--session` reuse (3, 4, 7), AI-unavailable fallback guidance (6), config-free ladder + per-host state + `--ephemeral` (8), `--help`-only discovery (9), testing incl. aimock heal test (10). Framework flag (`--framework`) is parsed (9) and stored (4); Historian-based conversion of `used:` into Playwright dialect is deliberately deferred until `used` collection stabilizes — v1 emits the executed CodeceptJS (pw commands echo the Playwright expression itself), which satisfies "actual used locator" for both dialect inputs. If reviewers want full conversion in v1, extend Task 6 with `historian.toPlaywrightCode` per `src/ai/historian/playwright.ts:21`.
- Vision `ask` degrades to text path when no `visionModel` configured (`provider.hasVision()`, `src/ai/provider.ts:635`) — implementer: guard in `ask`.
- Type consistency: `EnvelopeData`/`InstanceInfo`/`HealAttempt` defined once in Task 1 and only consumed elsewhere; `PrimaOptions` defined in Task 4 and consumed by 9.
