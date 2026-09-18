# Judge Decision Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional decision-model tier — a `judge` tool plus code-level calls at fixed sites — that answers narrow typed questions with calibrated confidence, leaving every run without `ai.decisionModel` byte-identical to today.

**Architecture:** One module, `src/ai/judge.ts`, owns the HTTP call to a System One endpoint and returns `null` on every failure. It reaches agents through `AgentDeps` and tools through `ToolDeps`, so nothing reads config directly. Call sites run their existing deterministic prefilter, ask judge, gate on confidence, and fall through to today's code path whenever judge declines or is unconfigured.

**Tech Stack:** Bun, TypeScript (ESM only), Zod for tool schemas, `bun:test`, Biome for format/lint. The decision model is `typesafe/jev-1.13` served at `POST https://openrouter.ai/api/alpha/decisions`.

**Spec:** `docs/superpowers/specs/2026-09-18-judge-decision-model-design.md`

## Global Constraints

- **Never Node.js.** Bun only. ESM only — `export default`, never `module.exports`, never `require()`.
- **Unconfigured runs are unchanged.** No `ai.decisionModel` ⇒ the `judge` tool is absent from every tool list and no direct site calls out.
- **Judge never throws.** Timeout, non-2xx, malformed body and network error all return `null`.
- **Judge answers never enter `verifications`.** Never call `addVerification` from a judge result.
- **No selector, code, or prose ever comes back from judge.** It returns an option key from a set the caller supplied.
- **Prompts stay general.** No example drawn from a trace, bug report, or debug session goes into any tool description or question text. Describe the principle.
- **Formatting:** run `bun run format` after each code change; `bun run lint:fix` after each phase.
- **Style:** no comments unless asked; early return over if/else; no ternaries; no `...(cond ? {} : {})` spread; private methods after public ones; types at end of file.
- **Endpoint facts:** 32,000-token context; `$0.000000042` per prompt token; free completion; request body is `{model, state, questions}`; answers are `{type:'noul', noul}` or `{type:'choice', choice, probabilities, confidence}`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/ai/judge.ts` (create) | The only place that knows the decision endpoint exists. `Judge.ask()`, request building, answer normalisation, activity line, observability span. |
| `src/config.ts` (modify) | Parse and normalise `ai.decisionModel`; expose it in `configuredModels`. |
| `src/ai/agent.ts` (modify) | Add `judge` to `AgentDeps`, which widens `ToolDeps` automatically. |
| `src/explorbot.ts` (modify) | Construct the singleton and pass it into `createAgent`. |
| `src/ai/judge-tool.ts` (create) | The `judge` tool definition and its description. Kept out of `tools.ts`, which is already 1412 lines. |
| `src/ai/tools.ts` (modify) | Register the tool; ask judge in the multi-element branch. |
| `src/ai/navigator.ts` (modify) | Dedup question before the HTML prompt; inexpressible-branch question. |
| `src/ai/task-agent.ts`, `src/ai/pilot.ts` (modify) | Experience block filter; supervision gate; verdict question in shadow. |
| `boat/prima/src/prima.ts`, `boat/prima/src/envelope.ts` (modify) | Prima's `go()` navigation and `check()` expectation settling. |
| `tests/unit/judge.test.ts` and per-site test files (create/modify) | A stub judge returning fixed confidences; both branches asserted at every site. |

---

## Phase 1 — Foundation

### Task 1: Config resolves `ai.decisionModel`

**Files:**
- Modify: `src/config.ts` — `AIConfig` interface near line 186; `configuredModels` near line 827
- Test: `tests/unit/decision-model-config.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `export interface DecisionModelSettings { model: string; baseUrl: string; apiKey: string; tool: boolean; direct: boolean }` and `export function resolveDecisionModel(ai?: AIConfig): DecisionModelSettings | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { resolveDecisionModel } from '../../src/config.ts';

describe('resolveDecisionModel', () => {
  it('returns null when unset', () => {
    expect(resolveDecisionModel({ model: {} } as any)).toBeNull();
  });

  it('accepts a bare string and enables both paths', () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const settings = resolveDecisionModel({ model: {}, decisionModel: 'typesafe/jev-1.13' } as any);
    expect(settings).toEqual({
      model: 'typesafe/jev-1.13',
      baseUrl: 'https://openrouter.ai/api/alpha/decisions',
      apiKey: 'k',
      tool: true,
      direct: true,
    });
  });

  it('honours each toggle independently', () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const settings = resolveDecisionModel({ model: {}, decisionModel: { model: 'm', tool: false } } as any);
    expect(settings?.tool).toBe(false);
    expect(settings?.direct).toBe(true);
  });

  it('takes the TypeSafe key when the base url is TypeSafe', () => {
    process.env.TYPESAFE_API_KEY = 't';
    const settings = resolveDecisionModel({ model: {}, decisionModel: { model: 'jev-latest', baseUrl: 'https://api.typesafe.ai/v1/systemone' } } as any);
    expect(settings?.apiKey).toBe('t');
  });

  it('returns null when no key is available', () => {
    process.env.OPENROUTER_API_KEY = '';
    expect(resolveDecisionModel({ model: {}, decisionModel: 'typesafe/jev-1.13' } as any)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/decision-model-config.test.ts`
Expected: FAIL — `resolveDecisionModel` is not exported from `src/config.ts`.

- [ ] **Step 3: Add the field and the resolver**

In `src/config.ts`, add to the `AIConfig` interface beside `agenticModel`:

```ts
  decisionModel?: string | DecisionModelConfig;
```

Add at the bottom of the file, with the other types:

```ts
export interface DecisionModelConfig {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  tool?: boolean;
  direct?: boolean;
}

export interface DecisionModelSettings {
  model: string;
  baseUrl: string;
  apiKey: string;
  tool: boolean;
  direct: boolean;
}
```

Add above those types, with the other exported functions:

```ts
const DECISION_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';

export function resolveDecisionModel(ai?: AIConfig): DecisionModelSettings | null {
  const configured = ai?.decisionModel;
  if (!configured) return null;

  const spec: DecisionModelConfig = typeof configured === 'string' ? { model: configured } : configured;
  if (!spec.model) return null;

  const baseUrl = spec.baseUrl || DECISION_ENDPOINT;
  const envKey = baseUrl.includes('typesafe.ai') ? process.env.TYPESAFE_API_KEY : process.env.OPENROUTER_API_KEY;
  const apiKey = spec.apiKey || envKey;
  if (!apiKey) return null;

  return {
    model: spec.model,
    baseUrl,
    apiKey,
    tool: spec.tool !== false,
    direct: spec.direct !== false,
  };
}
```

In `configuredModels`, after the `visionModel` line:

```ts
  const decision = resolveDecisionModel(ai);
  if (decision) models.decisionModel = { name: decision.model, provider: 'decisions' };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/decision-model-config.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/config.ts tests/unit/decision-model-config.test.ts
git commit -m "feat(config): resolve ai.decisionModel with independent tool and direct toggles"
```

---

### Task 2: `Judge.ask()` — the only module that knows the endpoint

**Files:**
- Create: `src/ai/judge.ts`
- Test: `tests/unit/judge.test.ts` (create)

**Interfaces:**
- Consumes: `DecisionModelSettings` from Task 1
- Produces:
  - `export interface JudgeQuestion { instructions: string; options?: Record<string, string> }`
  - `export interface JudgeAnswer { answer: string; confidence: number; probabilities: Record<string, number> }`
  - `export class Judge { constructor(settings: DecisionModelSettings); get toolEnabled(): boolean; get directEnabled(): boolean; ask(state: unknown, questions: Record<string, JudgeQuestion>): Promise<Record<string, JudgeAnswer> | null> }`

Yes/no questions are sent as a two-option Choice so every answer carries a native `confidence`; there is no derived number anywhere.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { Judge } from '../../src/ai/judge.ts';

const settings = { model: 'm', baseUrl: 'https://example.test/decisions', apiKey: 'k', tool: true, direct: true };

function judgeWith(responder: (body: any) => Response | Promise<Response>): Judge {
  const judge = new Judge(settings);
  (judge as any).fetchImpl = async (_url: string, init: any) => responder(JSON.parse(init.body));
  return judge;
}

describe('Judge.ask', () => {
  it('sends yes/no questions as a two-option choice', async () => {
    let sent: any = null;
    const judge = judgeWith((body) => {
      sent = body;
      return new Response(JSON.stringify({ answers: { q: { type: 'choice', choice: 'yes', probabilities: { yes: 0.9, no: 0.1 }, confidence: 0.8 } } }));
    });

    const answers = await judge.ask({ page: 'x' }, { q: { instructions: 'The form is submitted.' } });

    expect(sent.model).toBe('m');
    expect(sent.questions.q.type).toBe('choice');
    expect(Object.keys(sent.questions.q.criteria)).toEqual(['yes', 'no']);
    expect(answers?.q).toEqual({ answer: 'yes', confidence: 0.8, probabilities: { yes: 0.9, no: 0.1 } });
  });

  it('passes supplied options through as criteria', async () => {
    let sent: any = null;
    const judge = judgeWith((body) => {
      sent = body;
      return new Response(JSON.stringify({ answers: { pick: { type: 'choice', choice: 'a', probabilities: { a: 0.6, b: 0.4 }, confidence: 0.2 } } }));
    });

    const answers = await judge.ask('state', { pick: { instructions: 'Which one?', options: { a: 'The first', b: 'The second' } } });

    expect(sent.questions.pick.criteria).toEqual({ a: 'The first', b: 'The second' });
    expect(answers?.pick.confidence).toBe(0.2);
  });

  it('returns null on a non-2xx response', async () => {
    const judge = judgeWith(() => new Response('{"error":{"message":"no endpoints"}}', { status: 404 }));
    expect(await judge.ask('s', { q: { instructions: 'x' } })).toBeNull();
  });

  it('returns null when the transport throws', async () => {
    const judge = new Judge(settings);
    (judge as any).fetchImpl = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await judge.ask('s', { q: { instructions: 'x' } })).toBeNull();
  });

  it('returns null on a malformed body', async () => {
    const judge = judgeWith(() => new Response('{"answers":null}'));
    expect(await judge.ask('s', { q: { instructions: 'x' } })).toBeNull();
  });

  it('reports both toggles', () => {
    expect(new Judge({ ...settings, tool: false }).toolEnabled).toBe(false);
    expect(new Judge({ ...settings, direct: false }).directEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/judge.test.ts`
Expected: FAIL — cannot resolve `src/ai/judge.ts`.

- [ ] **Step 3: Write the module**

```ts
import { setActivity } from '../activity.ts';
import type { DecisionModelSettings } from '../config.ts';
import { Observability } from '../observability.ts';
import { createDebug } from '../utils/logger.ts';

const debugLog = createDebug('explorbot:judge');

const YES_NO: Record<string, string> = {
  yes: 'The statement is true.',
  no: 'The statement is false.',
};

export class Judge {
  private fetchImpl: typeof fetch = fetch;

  constructor(private settings: DecisionModelSettings) {}

  get toolEnabled(): boolean {
    return this.settings.tool;
  }

  get directEnabled(): boolean {
    return this.settings.direct;
  }

  async ask(state: unknown, questions: Record<string, JudgeQuestion>): Promise<Record<string, JudgeAnswer> | null> {
    if (!Object.keys(questions).length) return null;

    return Observability.run('judge.ask', { tags: ['judge'] }, async () => {
      setActivity('⚖️ Asking judge...', 'ai');
      const answers = await this.post(state, questions);
      if (!answers) debugLog('judge declined, caller falls through');
      return answers;
    });
  }

  private async post(state: unknown, questions: Record<string, JudgeQuestion>): Promise<Record<string, JudgeAnswer> | null> {
    const body = {
      model: this.settings.model,
      state,
      questions: Object.fromEntries(
        Object.entries(questions).map(([id, question]) => [
          id,
          { type: 'choice', instructions: question.instructions, criteria: question.options || YES_NO },
        ])
      ),
    };

    const response = await this.fetchImpl(this.settings.baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch((error: unknown) => {
      debugLog('transport failed: %s', error);
      return null;
    });

    if (!response) return null;
    if (!response.ok) {
      debugLog('endpoint returned %d', response.status);
      return null;
    }

    const payload = await response.json().catch(() => null);
    return normalizeAnswers(payload);
  }
}

function normalizeAnswers(payload: any): Record<string, JudgeAnswer> | null {
  const answers = payload?.answers;
  if (!answers || typeof answers !== 'object') return null;

  const normalized: Record<string, JudgeAnswer> = {};
  for (const [id, answer] of Object.entries<any>(answers)) {
    if (typeof answer?.choice !== 'string') continue;
    if (typeof answer?.confidence !== 'number') continue;
    normalized[id] = { answer: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities || {} };
  }

  if (!Object.keys(normalized).length) return null;
  return normalized;
}

export interface JudgeQuestion {
  instructions: string;
  options?: Record<string, string>;
}

export interface JudgeAnswer {
  answer: string;
  confidence: number;
  probabilities: Record<string, number>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/judge.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify the real endpoint answers this body shape**

Run:

```bash
curl -s --max-time 60 -X POST https://openrouter.ai/api/alpha/decisions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"typesafe/jev-1.13","state":{"page":"A dialog is open with an enabled Create button."},
       "questions":{"ready":{"type":"choice","instructions":"The dialog can be submitted.","criteria":{"yes":"The statement is true.","no":"The statement is false."}}}}'
```

Expected: JSON with `answers.ready.choice`, `answers.ready.probabilities` and `answers.ready.confidence`. If the shape differs, fix `normalizeAnswers` and its tests before continuing — every later task depends on it.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/ai/judge.ts tests/unit/judge.test.ts
git commit -m "feat(judge): add decision model client that returns null on every failure"
```

---

### Task 3: Inject judge through the DI container

**Files:**
- Modify: `src/ai/agent.ts` — `AgentDeps` interface
- Modify: `src/explorbot.ts` — `createAgent` near line 207
- Test: `tests/unit/judge-injection.test.ts` (create)

**Interfaces:**
- Consumes: `Judge` from Task 2, `resolveDecisionModel` from Task 1
- Produces: `AgentDeps.judge?: Judge` — therefore `ToolDeps` gains `judge` too, since `ToolDeps` is `Pick<AgentDeps, 'explorer' | 'stateManager' | 'ai'>`; widen that Pick to include `'judge'`. `ExplorBot.judge(): Judge | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { Judge } from '../../src/ai/judge.ts';
import { resolveDecisionModel } from '../../src/config.ts';

describe('judge injection', () => {
  it('builds no judge when decisionModel is unset', () => {
    expect(resolveDecisionModel({ model: {} } as any)).toBeNull();
  });

  it('builds a judge from resolved settings', () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const settings = resolveDecisionModel({ model: {}, decisionModel: 'typesafe/jev-1.13' } as any);
    expect(settings).not.toBeNull();
    const judge = new Judge(settings!);
    expect(judge.toolEnabled).toBe(true);
    expect(judge.directEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/judge-injection.test.ts`
Expected: PASS for the first case, FAIL only if Task 1 or 2 regressed. This task's real gate is Step 4's typecheck.

- [ ] **Step 3: Wire it**

In `src/ai/agent.ts`:

```ts
  judge?: Judge;
```

added to `AgentDeps`, and:

```ts
export type ToolDeps = Pick<AgentDeps, 'explorer' | 'stateManager' | 'ai' | 'judge'>;
```

In `src/explorbot.ts`, add the accessor beside the other service accessors:

```ts
  judge(): Judge | null {
    if (this.judgeInstance !== undefined) return this.judgeInstance;
    const settings = resolveDecisionModel(this.config.ai);
    this.judgeInstance = settings ? new Judge(settings) : null;
    return this.judgeInstance;
  }
```

with `private judgeInstance: Judge | null | undefined;` as a field, and pass it in `createAgent`:

```ts
      judge: this.judge() || undefined,
```

- [ ] **Step 4: Typecheck the changed files**

Run: `bunx tsc --noEmit src/ai/agent.ts src/explorbot.ts src/ai/judge.ts 2>&1 | head -20`
Expected: no errors referencing `judge`. CI runs `tsc --noCheck`, so this check only happens if you run it.

- [ ] **Step 5: Run the full unit suite for regressions**

Run: `bun test tests/unit/`
Expected: no new failures.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/ai/agent.ts src/explorbot.ts tests/unit/judge-injection.test.ts
git commit -m "feat(judge): inject judge through AgentDeps and ToolDeps"
```

---

## Phase 2 — The tool

### Task 4: The `judge` tool

**Files:**
- Create: `src/ai/judge-tool.ts`
- Modify: `src/ai/tools.ts` — `createAgentTools` near line 590
- Test: `tests/unit/judge-tool.test.ts` (create)

**Interfaces:**
- Consumes: `Judge`, `JudgeAnswer` from Task 2; `ToolDeps` from Task 3
- Produces: `export function createJudgeTool(deps: ToolDeps, buildState: () => Promise<Record<string, unknown>>): Record<string, any>` — returns `{}` when there is no judge or `toolEnabled` is false.

The state is assembled by code: `task`, `page` (compact ARIA under a cap), `recentActions`. The model supplies only `question`, optional `options`, and optional extra `context`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { createJudgeTool } from '../../src/ai/judge-tool.ts';

const stubJudge = (answer: any, capture?: (state: any, questions: any) => void) => ({
  toolEnabled: true,
  directEnabled: true,
  ask: async (state: any, questions: any) => {
    capture?.(state, questions);
    return answer;
  },
});

describe('judge tool', () => {
  it('is absent without a judge', () => {
    expect(createJudgeTool({} as any, async () => ({}))).toEqual({});
  });

  it('is absent when the tool toggle is off', () => {
    const deps = { judge: { ...stubJudge(null), toolEnabled: false } } as any;
    expect(createJudgeTool(deps, async () => ({}))).toEqual({});
  });

  it('returns answer, confidence and probabilities', async () => {
    const deps = { judge: stubJudge({ q: { answer: 'yes', confidence: 0.91, probabilities: { yes: 0.95, no: 0.05 } } }) } as any;
    const tool = createJudgeTool(deps, async () => ({ task: 't', page: 'p', recentActions: [] }));
    const result = await tool.judge.execute({ question: 'The list shows the new row.' });
    expect(result).toMatchObject({ success: true, answer: 'yes', confidence: 0.91 });
  });

  it('merges caller context into the assembled state', async () => {
    let seen: any = null;
    const deps = { judge: stubJudge({ q: { answer: 'a', confidence: 0.5, probabilities: {} } }, (state) => (seen = state)) } as any;
    const tool = createJudgeTool(deps, async () => ({ task: 't', page: 'p', recentActions: [] }));
    await tool.judge.execute({ question: 'Which?', options: { a: 'First', b: 'Second' }, context: 'extra detail' });
    expect(seen.task).toBe('t');
    expect(seen.context).toBe('extra detail');
  });

  it('reports a failure the caller can act on when judge declines', async () => {
    const deps = { judge: stubJudge(null) } as any;
    const tool = createJudgeTool(deps, async () => ({}));
    const result = await tool.judge.execute({ question: 'x' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/judge-tool.test.ts`
Expected: FAIL — cannot resolve `src/ai/judge-tool.ts`.

- [ ] **Step 3: Write the tool**

```ts
import { tool } from 'ai';
import dedent from 'dedent';
import { z } from 'zod';
import type { ToolDeps } from './agent.ts';
import { failedToolResult, successToolResult } from './tools.ts';

export function createJudgeTool(deps: ToolDeps, buildState: () => Promise<Record<string, unknown>>): Record<string, any> {
  const judge = deps.judge;
  if (!judge?.toolEnabled) return {};

  return {
    judge: tool({
      description: dedent`
        Settle one judgement about the current page and get back a calibrated answer.

        Ask when a decision turns on reading the page rather than on running a command, and you would otherwise
        be guessing. Prefer asking over deciding alone.

        Give options when the answer is one of a known set; leave them out for a yes/no. State the condition
        literally and concretely, naming what you expect to see, rather than in abstract terms — an abstract
        question gets an uncertain answer. Ask one judgement per call.

        Do not ask for anything code can establish exactly, such as whether a URL changed or an element exists.
        Do not ask it to write a locator, a command, or any text — it only picks from the options you gave.

        The reply carries confidence from 0 to 1. Act on a high one. On a low one the page does not separate the
        options: gather more context or take a different route rather than picking anyway.
      `,
      inputSchema: z.object({
        question: z.string().describe('The judgement to settle, written as one complete question or statement about the page'),
        options: z.record(z.string(), z.string()).optional().describe('Option key to its meaning. Omit for a yes/no question'),
        context: z.string().optional().describe('Anything the page observation does not already carry that this judgement needs'),
      }),
      execute: async ({ question, options, context }) => {
        const state = await buildState();
        if (context) state.context = context;

        const answers = await judge.ask(state, { q: { instructions: question, options } });
        if (!answers?.q) {
          return failedToolResult('judge', 'The decision model did not answer.', {
            suggestion: 'Decide with the tools you already have — context(), see(), or an assertion.',
          });
        }

        const { answer, confidence, probabilities } = answers.q;
        return successToolResult('judge', { answer, confidence, probabilities, question });
      },
    }),
  };
}
```

Register it in `createAgentTools` (`src/ai/tools.ts:590`) by spreading `createJudgeTool(deps, buildState)` into the returned object, with `buildState` defined there as:

```ts
  const buildState = async () => {
    const state = stateManager.getCurrentState();
    const result = state ? ActionResult.fromState(state) : null;
    return {
      task: task.scenario || task.instructions || '',
      page: result?.getCompactARIA().slice(0, 12000) || '',
      recentActions: task.recentToolLabels?.() || [],
    };
  };
```

Pilot gets the same tool from its own tool list, built with the same helper against Pilot's task and current state — the spec registers it for Tester and Pilot alike.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/judge-tool.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/ai/judge-tool.ts src/ai/tools.ts tests/unit/judge-tool.test.ts
git commit -m "feat(judge): add the judge tool with code-assembled state"
```

---

## Phase 3 — Direct sites in Explorbot core

Every task in this phase follows the same shape: deterministic prefilter, ask judge, gate on confidence, fall through on a low answer or a `null`. Thresholds are named constants so they can be tuned from traces; start each at `0.7` and treat that as provisional.

**Which sites act and which only observe.** Tasks 5, 6, 7 and 8 act on a confident answer, because each falls back to exactly today's behaviour otherwise and each has a bound on a wrong answer: the element pick returns to the numbered list, the dedup returns to the full verification, the experience filter keeps the block, the supervision gate has three vetoes and a floor. Task 9 — the verdict — only observes, because the spec measured its generic phrasing at 0.58 and a wrong verdict has no downstream check. This split is the spec's design decision 9 as amended; if you are reading an older copy of the spec that says all direct sites ship in shadow, the plan is authoritative and the spec was updated on the same day.

### Task 5: Multi-element ambiguity resolves inside the tool

**Files:**
- Modify: `src/ai/tools.ts` — `failedToolResult` multi-element branch near line 1277, `formatElementList` near line 1369
- Test: `tests/unit/click-ambiguity.test.ts` (extend the existing file)

**Interfaces:**
- Consumes: `Judge.ask` from Task 2, `MatchedElement` (already in `tools.ts`)
- Produces: no new exports. The branch gains `result.judgedElement?: number` when judge answered confidently.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/click-ambiguity.test.ts`:

```ts
it('picks the intended match when judge is confident', async () => {
  const judge = {
    toolEnabled: true,
    directEnabled: true,
    ask: async () => ({ pick: { answer: '2', confidence: 0.92, probabilities: { '1': 0.05, '2': 0.92, none: 0.03 } } }),
  };
  const result = await failedToolResult('click', 'Multiple elements (2) found', { judge } as any, multipleElementsError());
  expect(result.judgedElement).toBe(2);
});

it('leaves the numbered list alone when judge is uncertain', async () => {
  const judge = {
    toolEnabled: true,
    directEnabled: true,
    ask: async () => ({ pick: { answer: '1', confidence: 0.2, probabilities: { '1': 0.5, '2': 0.48, none: 0.02 } } }),
  };
  const result = await failedToolResult('click', 'Multiple elements (2) found', { judge } as any, multipleElementsError());
  expect(result.judgedElement).toBeUndefined();
  expect(result.multipleElementsDetected).toBe(true);
});

it('leaves the numbered list alone with no judge', async () => {
  const result = await failedToolResult('click', 'Multiple elements (2) found', {}, multipleElementsError());
  expect(result.judgedElement).toBeUndefined();
  expect(result.multipleElementsDetected).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/click-ambiguity.test.ts`
Expected: FAIL — `judgedElement` is always undefined.

- [ ] **Step 3: Ask judge in the branch**

In the multi-element branch of `failedToolResult`, after `result.elements = formatElementList(matched)`:

```ts
    const judged = await judgeMatchedElement(data?.judge, matched, data?.intent);
    if (judged) {
      result.judgedElement = judged;
      result.suggestion = `Element ${judged} is the one meant. Repeat the action against it.`;
    }
    return result;
```

and at the bottom of the file, with the other private helpers:

```ts
const ELEMENT_CONFIDENCE = 0.7;

async function judgeMatchedElement(judge: Judge | undefined, matched: MatchedElement[] | null, intent?: string): Promise<number | null> {
  if (!judge?.directEnabled) return null;
  if (!matched || matched.length < 2) return null;

  const options: Record<string, string> = { none: 'None of these is the element meant.' };
  matched.forEach((element, index) => {
    options[String(index + 1)] = `${element.text || 'no text'} — ${element.html}`;
  });

  const answers = await judge.ask(
    { intent: intent || 'the element the last action aimed at', matches: options },
    { pick: { instructions: 'Which listed element does the intent name?', options } }
  );

  const pick = answers?.pick;
  if (!pick) return null;
  if (pick.answer === 'none') return null;
  if (pick.confidence < ELEMENT_CONFIDENCE) return null;

  const index = Number(pick.answer);
  if (!Number.isInteger(index)) return null;
  if (index < 1 || index > matched.length) return null;
  return index;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/click-ambiguity.test.ts`
Expected: PASS, including the three pre-existing cases.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/ai/tools.ts tests/unit/click-ambiguity.test.ts
git commit -m "feat(judge): resolve multi-element ambiguity inside the tool"
```

---

### Task 6: Navigator — verification dedup and the inexpressible branch

**Files:**
- Modify: `src/ai/navigator.ts` — `verifyState` near line 685, `checkAlreadyVerified`
- Test: `tests/unit/navigator-judge.test.ts` (create)

**Interfaces:**
- Consumes: `Judge.ask` from Task 2
- Produces: `verifyState` returns `{ ..., judged?: { answer: string; confidence: number } }` on the inexpressible branch only. It must not call `addVerification` for a judged answer.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';

describe('navigator judge questions', () => {
  it('treats a confident match as already verified', async () => {
    const judge = {
      directEnabled: true,
      ask: async () => ({ same: { answer: 'c1', confidence: 0.88, probabilities: { c1: 0.88, none: 0.12 } } }),
    };
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(judge as any, 'the row is listed', { 'The new row appears in the list': true })).toBe('The new row appears in the list');
  });

  it('returns null when uncertain', async () => {
    const judge = { directEnabled: true, ask: async () => ({ same: { answer: 'c1', confidence: 0.3, probabilities: {} } }) };
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(judge as any, 'x', { 'y': true })).toBeNull();
  });

  it('returns null with no judge and with no prior claims', async () => {
    const { judgeAlreadyVerified } = await import('../../src/ai/navigator.ts');
    expect(await judgeAlreadyVerified(undefined, 'x', { y: true })).toBeNull();
    expect(await judgeAlreadyVerified({ directEnabled: true, ask: async () => null } as any, 'x', {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/navigator-judge.test.ts`
Expected: FAIL — `judgeAlreadyVerified` is not exported.

- [ ] **Step 3: Add both questions**

Export from `src/ai/navigator.ts`, below the class:

```ts
const CLAIM_CONFIDENCE = 0.7;

export async function judgeAlreadyVerified(judge: Judge | undefined, claim: string, prior: Record<string, boolean>): Promise<string | null> {
  if (!judge?.directEnabled) return null;

  const claims = Object.keys(prior);
  if (!claims.length) return null;

  const options: Record<string, string> = { none: 'None of these means the same thing.' };
  claims.forEach((text, index) => {
    options[`c${index + 1}`] = text;
  });

  const answers = await judge.ask({ claim, already_checked: claims }, { same: { instructions: 'Which already-checked claim means the same as the claim under consideration?', options } });
  const same = answers?.same;
  if (!same) return null;
  if (same.answer === 'none') return null;
  if (same.confidence < CLAIM_CONFIDENCE) return null;

  const index = Number(same.answer.replace('c', '')) - 1;
  return claims[index] ?? null;
}
```

In `verifyState`, before building the prompt, call it and short-circuit exactly as the `ALREADY_VERIFIED:` path does today. In the `inexpressible` branch, before returning, ask the page question and attach it to the result without calling `addVerification`:

```ts
    if (inexpressible) {
      tag('warning').log('No assertion could express this claim');
      const judged = await this.judgePageClaim(message, actionResult);
      return { verified: false, inexpressible, results, successfulCodes, assertionSteps, totalAttempted, judged };
    }
```

with the private method after the public ones:

```ts
  private async judgePageClaim(claim: string, actionResult: ActionResult): Promise<{ answer: string; confidence: number } | undefined> {
    const judge = this.judge;
    if (!judge?.directEnabled) return undefined;

    const answers = await judge.ask(
      { claim, page: actionResult.getCompactARIA().slice(0, PAGE_STATE_CAP) },
      { holds: { instructions: 'Does the page show that the claim is true?' } }
    );

    const holds = answers?.holds;
    if (!holds) return undefined;
    return { answer: holds.answer, confidence: holds.confidence };
  }
```

Add `const PAGE_STATE_CAP = 12000;` beside the other constants. The `verify` tool in `src/ai/tools.ts` renders `judged` into its message when present, and states the confidence.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/navigator-judge.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Confirm no verification is recorded from a judged answer**

Run: `grep -n "addVerification" src/ai/navigator.ts`
Expected: exactly one call, on the assertion path, outside the `inexpressible` branch.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/ai/navigator.ts src/ai/tools.ts tests/unit/navigator-judge.test.ts
git commit -m "feat(judge): dedup verification claims and answer inexpressible ones"
```

---

### Task 7: Filter experience blocks at the renderer

**Files:**
- Modify: `src/ai/task-agent.ts` — `renderExperience` near line 82
- Test: `tests/unit/experience-judge-filter.test.ts` (create)

**Interfaces:**
- Consumes: `Judge.ask` from Task 2
- Produces: `export async function filterExperienceBlocks(judge: Judge | undefined, blocks: string[], page: string): Promise<string[]>` in `src/ai/task-agent.ts`. `ExperienceTracker` is not touched — its matching stays structural.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { filterExperienceBlocks } from '../../src/ai/task-agent.ts';

describe('filterExperienceBlocks', () => {
  it('keeps everything without a judge', async () => {
    expect(await filterExperienceBlocks(undefined, ['a', 'b'], 'page')).toEqual(['a', 'b']);
  });

  it('drops only blocks judged irrelevant with confidence', async () => {
    const judge = {
      directEnabled: true,
      ask: async () => ({
        b0: { answer: 'yes', confidence: 0.9, probabilities: {} },
        b1: { answer: 'no', confidence: 0.9, probabilities: {} },
        b2: { answer: 'no', confidence: 0.4, probabilities: {} },
      }),
    };
    expect(await filterExperienceBlocks(judge as any, ['a', 'b', 'c'], 'page')).toEqual(['a', 'c']);
  });

  it('keeps everything when judge declines', async () => {
    const judge = { directEnabled: true, ask: async () => null };
    expect(await filterExperienceBlocks(judge as any, ['a', 'b'], 'page')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/experience-judge-filter.test.ts`
Expected: FAIL — `filterExperienceBlocks` is not exported.

- [ ] **Step 3: Implement the filter**

```ts
const EXPERIENCE_CONFIDENCE = 0.7;

export async function filterExperienceBlocks(judge: Judge | undefined, blocks: string[], page: string): Promise<string[]> {
  if (!judge?.directEnabled) return blocks;
  if (blocks.length < 2) return blocks;

  const questions: Record<string, JudgeQuestion> = {};
  blocks.forEach((block, index) => {
    questions[`b${index}`] = { instructions: `This recorded note applies to the page shown: ${block.slice(0, 600)}` };
  });

  const answers = await judge.ask({ page }, questions);
  if (!answers) return blocks;

  return blocks.filter((_, index) => {
    const answer = answers[`b${index}`];
    if (!answer) return true;
    if (answer.answer !== 'no') return true;
    return answer.confidence < EXPERIENCE_CONFIDENCE;
  });
}
```

Call it from `renderExperience` between the tracker's structural match and the render.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/experience-judge-filter.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/ai/task-agent.ts tests/unit/experience-judge-filter.test.ts
git commit -m "feat(judge): filter structurally-matched experience at the renderer"
```

---

### Task 8: The supervision gate

**Files:**
- Modify: `src/ai/pilot.ts` — `stepsToReview` near line 63, the periodic review call site
- Test: `tests/unit/pilot-supervision-gate.test.ts` (create)

**Interfaces:**
- Consumes: `Judge.ask` from Task 2
- Produces: `export async function shouldSkipReview(judge: Judge | undefined, state: SupervisionState): Promise<boolean>` and `export interface SupervisionState { task: string; page: string; recentActions: string[]; deadLoop: boolean; allFailed: boolean; ariaUnchanged: boolean; skippedLast: boolean }`

A review is skipped only when `pilot_needed` is a confident `no` **and** `progressing` is a confident `yes`, no veto fired, and the previous scheduled review was not skipped.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { shouldSkipReview } from '../../src/ai/pilot.ts';

const base = { task: 't', page: 'p', recentActions: ['click - ok'], deadLoop: false, allFailed: false, ariaUnchanged: false, skippedLast: false };
const judgeReturning = (needed: any, progressing: any) => ({
  directEnabled: true,
  ask: async () => ({ pilot_needed: needed, progressing: progressing }),
});

describe('shouldSkipReview', () => {
  it('skips a healthy round', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.85, probabilities: {} }, { answer: 'yes', confidence: 0.9, probabilities: {} });
    expect(await shouldSkipReview(judge as any, base)).toBe(true);
  });

  it('reviews when progress is unclear even if supervision seems unneeded', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.8 , probabilities: {} }, { answer: 'yes', confidence: 0.4, probabilities: {} });
    expect(await shouldSkipReview(judge as any, base)).toBe(false);
  });

  it('reviews when supervision is wanted', async () => {
    const judge = judgeReturning({ answer: 'yes', confidence: 0.9, probabilities: {} }, { answer: 'no', confidence: 0.9, probabilities: {} });
    expect(await shouldSkipReview(judge as any, base)).toBe(false);
  });

  it('never skips on a deterministic veto', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.99, probabilities: {} }, { answer: 'yes', confidence: 0.99, probabilities: {} });
    expect(await shouldSkipReview(judge as any, { ...base, deadLoop: true })).toBe(false);
    expect(await shouldSkipReview(judge as any, { ...base, allFailed: true })).toBe(false);
    expect(await shouldSkipReview(judge as any, { ...base, ariaUnchanged: true })).toBe(false);
  });

  it('never skips twice in a row', async () => {
    const judge = judgeReturning({ answer: 'no', confidence: 0.99, probabilities: {} }, { answer: 'yes', confidence: 0.99, probabilities: {} });
    expect(await shouldSkipReview(judge as any, { ...base, skippedLast: true })).toBe(false);
  });

  it('never skips without a judge or when judge declines', async () => {
    expect(await shouldSkipReview(undefined, base)).toBe(false);
    expect(await shouldSkipReview({ directEnabled: true, ask: async () => null } as any, base)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/pilot-supervision-gate.test.ts`
Expected: FAIL — `shouldSkipReview` is not exported.

- [ ] **Step 3: Implement the gate**

```ts
const SUPERVISION_CONFIDENCE = 0.7;

export async function shouldSkipReview(judge: Judge | undefined, state: SupervisionState): Promise<boolean> {
  if (!judge?.directEnabled) return false;
  if (state.deadLoop) return false;
  if (state.allFailed) return false;
  if (state.ariaUnchanged) return false;
  if (state.skippedLast) return false;

  const answers = await judge.ask(
    { task: state.task, page: state.page, recentActions: state.recentActions },
    {
      pilot_needed: { instructions: 'A supervisor should review this run now.' },
      progressing: { instructions: 'The recent actions moved the run closer to completing the task.' },
    }
  );
  if (!answers) return false;

  const needed = answers.pilot_needed;
  const progressing = answers.progressing;
  if (!needed || !progressing) return false;
  if (needed.answer !== 'no') return false;
  if (needed.confidence < SUPERVISION_CONFIDENCE) return false;
  if (progressing.answer !== 'yes') return false;
  if (progressing.confidence < SUPERVISION_CONFIDENCE) return false;

  tag('substep').log('Skipping scheduled review — run reads as healthy');
  return true;
}
```

At the periodic review call site, build `SupervisionState` from what Pilot already holds — `stateManager.isInDeadLoop()`, the window of tool executions, the window's `ariaDiff` — and track `skippedLast` on the Pilot instance. Log the two values and the vetoes so a skipped review is auditable.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/pilot-supervision-gate.test.ts`
Expected: PASS, 8 assertions across 6 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/ai/pilot.ts tests/unit/pilot-supervision-gate.test.ts
git commit -m "feat(judge): skip a scheduled pilot review only on a confident healthy read"
```

---

### Task 9: The verdict question, in shadow

**Files:**
- Modify: `src/ai/pilot.ts` — `reviewDecision` near line 118
- Test: `tests/unit/pilot-verdict-shadow.test.ts` (create)

**Interfaces:**
- Consumes: `Judge.ask` from Task 2
- Produces: nothing exported. The verdict is unchanged; the judge answer is logged only.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { judgePresumedState } from '../../src/ai/pilot.ts';

describe('judgePresumedState', () => {
  it('returns the answer and confidence for the trace', async () => {
    const judge = { directEnabled: true, ask: async () => ({ held: { answer: 'no', confidence: 0.62, probabilities: {} } }) };
    expect(await judgePresumedState(judge as any, 'scenario', 'page', ['note'])).toEqual({ answer: 'no', confidence: 0.62 });
  });

  it('returns null without a judge', async () => {
    expect(await judgePresumedState(undefined, 's', 'p', [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/pilot-verdict-shadow.test.ts`
Expected: FAIL — `judgePresumedState` is not exported.

- [ ] **Step 3: Implement it and call it without acting on it**

```ts
export async function judgePresumedState(judge: Judge | undefined, scenario: string, page: string, notes: string[]): Promise<{ answer: string; confidence: number } | null> {
  if (!judge?.directEnabled) return null;

  const answers = await judge.ask(
    { task: scenario, page, notes },
    { held: { instructions: 'The application held the data and prior state the task assumes were already there.' } }
  );

  const held = answers?.held;
  if (!held) return null;
  return { answer: held.answer, confidence: held.confidence };
}
```

In `reviewDecision`, call it before `generateObject` and log the result to the trace. Do not branch on it — the verdict stays exactly as it is today. The spec records why: phrased generically by code this question measured 0.58, so it needs trace data before it can gate anything.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/pilot-verdict-shadow.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the whole suite and lint the phase**

Run: `bun test tests/unit/ && bun test tests/integration/ && bun run lint:fix`
Expected: no failures.

- [ ] **Step 6: Commit**

```bash
git add src/ai/pilot.ts tests/unit/pilot-verdict-shadow.test.ts
git commit -m "feat(judge): record the verdict presumed-state question in shadow"
```

---

## Phase 4 — Prima

### Task 10: `go()` picks a ref before falling back to Navigator

**Files:**
- Modify: `boat/prima/src/prima.ts` — `go` near line 438, `refAriaSnapshot` near line 923
- Test: `boat/prima/tests/prima-judge-go.test.ts` (create)

**Interfaces:**
- Consumes: `Judge.ask` from Task 2, `ariaRefSnapshot` and `ariaRefSelector` (already imported in Prima)
- Produces: `export async function judgeNavigationRef(judge: Judge | undefined, target: string, refSnapshot: string): Promise<string | null>` in `boat/prima/src/prima.ts`

The ref table must come from `ariaRefSnapshot`; a plain `ariaSnapshot()` wipes Playwright's per-document ref index and the refs then time out rather than error.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'bun:test';
import { judgeNavigationRef } from '../src/prima.ts';

const snapshot = '- link "Plans" [ref=e4]\n- link "Suites" [ref=e7]\n- button "New" [ref=e9]';

describe('judgeNavigationRef', () => {
  it('returns the ref when confident', async () => {
    const judge = { directEnabled: true, ask: async () => ({ target: { answer: 'e7', confidence: 0.9, probabilities: {} } }) };
    expect(await judgeNavigationRef(judge as any, 'the suites page', snapshot)).toBe('e7');
  });

  it('returns null when uncertain', async () => {
    const judge = { directEnabled: true, ask: async () => ({ target: { answer: 'e7', confidence: 0.3, probabilities: {} } }) };
    expect(await judgeNavigationRef(judge as any, 'the suites page', snapshot)).toBeNull();
  });

  it('returns null when nothing on the page leads there', async () => {
    const judge = { directEnabled: true, ask: async () => ({ target: { answer: 'none', confidence: 0.95, probabilities: {} } }) };
    expect(await judgeNavigationRef(judge as any, 'the billing page', snapshot)).toBeNull();
  });

  it('returns null without a judge or with no refs', async () => {
    expect(await judgeNavigationRef(undefined, 't', snapshot)).toBeNull();
    expect(await judgeNavigationRef({ directEnabled: true, ask: async () => null } as any, 't', 'no refs here')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test boat/prima/tests/prima-judge-go.test.ts`
Expected: FAIL — `judgeNavigationRef` is not exported.

- [ ] **Step 3: Implement it and call it from `go`**

```ts
const NAVIGATION_CONFIDENCE = 0.7;
const REF_PATTERN = /^-\s*(\S+)\s+"([^"]*)"\s*\[ref=([a-z]\d+)\]/;

export async function judgeNavigationRef(judge: Judge | undefined, target: string, refSnapshot: string): Promise<string | null> {
  if (!judge?.directEnabled) return null;

  const options: Record<string, string> = { none: 'Nothing listed leads to the target.' };
  for (const line of refSnapshot.split('\n')) {
    const match = line.trim().match(REF_PATTERN);
    if (!match) continue;
    options[match[3]] = `${match[1]} named "${match[2]}"`;
  }
  if (Object.keys(options).length < 2) return null;

  const answers = await judge.ask(
    { task: `Reach: ${target}`, controls: options },
    { target: { instructions: 'Which listed control leads to the target?', options } }
  );

  const pick = answers?.target;
  if (!pick) return null;
  if (pick.answer === 'none') return null;
  if (pick.confidence < NAVIGATION_CONFIDENCE) return null;
  return pick.answer;
}
```

In `go`, for a non-URL target after the guard passes: take `refAriaSnapshot`, ask, and on a confident ref run the same `page.locator(ariaRefSelector(ref)).click()` path `clickRef` uses, then capture and return a success envelope. On `null`, call `agentNavigator().visit(target)` exactly as today.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test boat/prima/tests/prima-judge-go.test.ts`
Expected: PASS, 5 assertions across 4 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add boat/prima/src/prima.ts boat/prima/tests/prima-judge-go.test.ts
git commit -m "feat(prima): pick a navigation ref with the decision model before falling back"
```

---

### Task 11: Expectations settle per-question and carry confidence

**Files:**
- Modify: `boat/prima/src/envelope.ts` — `EnvelopeData.expectations` at line 32
- Modify: `boat/prima/src/prima.ts` — `check` near line 371
- Test: `boat/prima/tests/prima.test.ts` (extend)

**Interfaces:**
- Consumes: `Judge.ask` from Task 2; `SettledExpectation` from `src/ai/pilot.ts`
- Produces: `expectations?: Array<{ text: string; status: 'passed' | 'failed' | 'unverified' | 'contradiction'; evidence?: string; confidence?: number }>`

`envelope.ok` stays derived from the statuses alone. A `passed` below threshold becomes `unverified` before that calculation runs, so confidence never enters it directly.

- [ ] **Step 1: Write the failing test**

Append to `boat/prima/tests/prima.test.ts`:

```ts
it('downgrades a weakly settled pass to unverified', async () => {
  const { downgradeWeakExpectations } = await import('../src/prima.ts');
  const settled = [
    { text: 'the row is listed', status: 'passed' as const, confidence: 0.35 },
    { text: 'the dialog closed', status: 'passed' as const, confidence: 0.9 },
    { text: 'the toast appeared', status: 'passed' as const },
  ];
  expect(downgradeWeakExpectations(settled)).toEqual([
    { text: 'the row is listed', status: 'unverified', confidence: 0.35 },
    { text: 'the dialog closed', status: 'passed', confidence: 0.9 },
    { text: 'the toast appeared', status: 'passed' },
  ]);
});

it('keeps ok true when a weak pass is the only doubt', async () => {
  const { downgradeWeakExpectations } = await import('../src/prima.ts');
  const downgraded = downgradeWeakExpectations([{ text: 'x', status: 'passed' as const, confidence: 0.2 }]);
  const unreached = downgraded.filter((e) => e.status === 'failed');
  const contradicted = downgraded.filter((e) => e.status === 'contradiction');
  expect(!unreached.length && !contradicted.length).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test boat/prima/tests/prima.test.ts`
Expected: FAIL — `downgradeWeakExpectations` is not exported.

- [ ] **Step 3: Implement it**

Add `confidence?: number;` to the expectation entry type in `boat/prima/src/envelope.ts`, and in `boat/prima/src/prima.ts`:

```ts
const EXPECTATION_CONFIDENCE = 0.6;

export function downgradeWeakExpectations(expectations: SettledExpectation[]): SettledExpectation[] {
  return expectations.map((expectation) => {
    if (expectation.status !== 'passed') return expectation;
    if (expectation.confidence === undefined) return expectation;
    if (expectation.confidence >= EXPECTATION_CONFIDENCE) return expectation;
    return { ...expectation, status: 'unverified' };
  });
}
```

In `check`, apply it immediately after `settleExpectations` and before the `unreached`/`contradicted` filters. In `src/ai/pilot.ts`, add `confidence?: number;` to the `SettledExpectation` interface (line 1206), and in `settleExpectations` take the judge route first on the text-only path — when there is no image:

```ts
    const judged = await this.judgeOutcomes(undecided, task);
    if (judged) return task.expected.map((text) => judged[text] || { text, status: decided(text) });
```

with, after the public methods:

```ts
  private async judgeOutcomes(undecided: string[], task: Test): Promise<Record<string, SettledExpectation> | null> {
    const judge = this.judge;
    if (!judge?.directEnabled) return null;

    const questions: Record<string, JudgeQuestion> = {};
    undecided.forEach((text, index) => {
      questions[`o${index}`] = {
        instructions: `What did this run establish about the expected outcome: ${text}`,
        options: {
          passed: 'The run shows the outcome happened.',
          failed: 'The run shows the outcome did not happen.',
          unverified: 'The run neither shows it happening nor shows it failing.',
        },
      };
    });

    const answers = await judge.ask({ task: task.scenario, run_log: task.notesToString() || 'No steps recorded.' }, questions);
    if (!answers) return null;

    const settled: Record<string, SettledExpectation> = {};
    undecided.forEach((text, index) => {
      const answer = answers[`o${index}`];
      if (!answer) return;
      settled[text] = { text, status: answer.answer as SettledExpectation['status'], confidence: answer.confidence };
    });
    return settled;
  }
```

The vision path is untouched, because Jev takes no images and `contradiction` only exists when a screenshot backs it.

Keep the existing `envelope.warning` for the no-screenshot case — it says something different — and extend it only when a downgrade happened, naming how many outcomes were weakly settled.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test boat/prima/tests/prima.test.ts`
Expected: PASS, including the pre-existing Prima cases.

- [ ] **Step 5: Confirm the envelope is unchanged when unconfigured**

Run: `bun test boat/prima/tests/prima.test.ts -t envelope`
Expected: PASS. No entry carries a `confidence` key when no judge settled it.

- [ ] **Step 6: Full suite, lint, commit**

```bash
bun test tests/unit/ && bun test tests/integration/ && bun test boat/prima/tests/ && bun run lint:fix
git add boat/prima/src/envelope.ts boat/prima/src/prima.ts src/ai/pilot.ts boat/prima/tests/prima.test.ts
git commit -m "feat(prima): settle expectations per-question and carry confidence into the envelope"
```

---

## Final verification

- [ ] **Unconfigured parity.** With `ai.decisionModel` unset, run `bun test tests/unit/ && bun test tests/integration/ && bun test boat/prima/tests/`. Every suite passes and `grep -rn "judge" src/ai/tools.ts` shows the tool guarded behind `toolEnabled`.
- [ ] **Dead endpoint parity.** Set `decisionModel: { model: 'typesafe/jev-1.13', baseUrl: 'https://127.0.0.1:1/decisions' }` and run one `explorbot plan /` — it completes, and the trace carries judge spans with `null` results.
- [ ] **Changelog.** Run the `/changelog` skill to add the entry before the branch is proposed.
- [ ] **Regression.** This branch needs a regression run. Say so and let the user apply the `regression` label — never start one.
