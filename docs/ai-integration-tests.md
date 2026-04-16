# AI Agent Integration Tests

We test AI agents using [`@copilotkit/aimock`](https://github.com/CopilotKit/aimock) — a real HTTP mock server that speaks LLM provider protocols. Unlike in-process model stubs, it lets us use the real `Provider` class and inspect actual HTTP requests via its **Journal**.

Reference implementation: **`tests/integration/planner.test.ts`**.

## Principles

### What we mock

- **The AI provider** — via aimock HTTP server. Point the Vercel AI SDK at `mock.url/v1` with `createOpenAI({ compatibility: 'compatible' })` + `openai.chat('model-name')`. The `compatible` mode is required because SDK v6 defaults to the Responses API which aimock doesn't fully implement.
- **Explorer, StateManager, Researcher, ExperienceTracker** — duck-typed mocks with only the methods the agent under test calls. Each agent is tested in isolation; downstream agents (e.g., Researcher when testing Planner) return canned output.
- **`playwrightLocatorCount`** — for agents that validate locators, since no real browser runs in these tests.

### What we don't mock

- The real `Provider` class — so tests exercise serialization, retry, telemetry paths.
- Parsers, result objects, markdown processing — we test the real pipeline.
- `ActionResult.fromState()` — works filesystem-free when `state.html` is inline.

### What we test

- **Output correctness**: the Plan/research markdown returned by the agent matches the canned AI response.
- **Prompt construction** (via Journal): `mock.getLastRequest()` lets us assert on the actual messages sent to the AI. This is the core value — we verify *what* the agent prompted, not just *what* it returned.
- **Control flow**: cache hits, dedup, retries, error paths, style/feature injection — by inspecting request count and prompt content.

### Fixture types

- Text response (for `chat()` / `invokeConversation()`): `mock.on({}, { content: 'text' })`
- Structured output (for `generateObject()`): `mock.on({}, { content: JSON.stringify(obj) })` — the SDK parses it back via `response_format: json_schema`
- Sequential responses: `mock.on({ sequenceIndex: 0 }, ...)`, `sequenceIndex: 1`, ...
- Errors: `mock.on({}, { error: {...}, status: 500 })`
- See aimock docs for matching by user message, tool name, regex, or predicate.

### Test data

- Canned UI maps live in `test-data/ui-maps/`.
- Use **fictional** applications (Task Tracker, etc.) — never real product data or user names.
- Two formats exist depending on the agent under test:
  - **Planner-input** (`task-board.md`): Element + Type columns only — what the Planner sees after its own table-column filtering.
  - **Researcher-output** (`task-board-research.md`): full Element, Type, ARIA, CSS, Coordinates columns — the raw Researcher AI output format.

### Module-level caches

Many agents have module-level state (plan registry, session dedup, style cache, research cache). Each module that caches across calls must export a `clearXxx()` function used in `beforeEach`. See the existing exports in:

- `src/ai/planner/subpages.ts` — `clearPlanRegistry()`
- `src/ai/planner/session-dedup.ts` — `clearSessionDedup()`
- `src/ai/planner/styles.ts` — `clearStyleCache()`
- `src/ai/researcher/cache.ts` — `clearResearchCache()`

## Running

```bash
bun test tests/integration/planner.test.ts
bun test tests/integration/
```
