# AI Agent Integration Tests

We test AI agents with [`@copilotkit/aimock`](https://github.com/CopilotKit/aimock), an HTTP mock server that speaks LLM provider protocols. Unlike in-process model stubs, it runs the real `Provider` class and lets you inspect the HTTP requests through its Journal.

Reference implementation: `tests/integration/planner.test.ts`.

## Principles

### What we mock

- **The AI provider** — via the aimock HTTP server. Point the Vercel AI SDK at `mock.url/v1` with `createOpenAI({ compatibility: 'compatible' })` and `openai.chat('model-name')`. SDK v6 defaults to the Responses API, which aimock does not fully implement, so `compatible` mode is required.
- **Explorer, StateManager, Researcher, ExperienceTracker** — duck-typed mocks with only the methods the agent under test calls. Each agent runs in isolation; downstream agents (such as Researcher when testing Planner) return canned output.
- **`playwrightLocatorCount`** — for agents that validate locators, since no browser runs in these tests.

### What we don't mock

- The real `Provider` class, so tests exercise serialization, retry, and telemetry paths.
- Parsers, result objects, and markdown processing — the real pipeline runs.
- `ActionResult.fromState()`, which works without the filesystem when `state.html` is inline.

### What we test

- **Output correctness**: the plan or research markdown the agent returns matches the canned AI response.
- **Prompt construction** (via Journal): `mock.getLastRequest()` returns the messages sent to the AI, so you assert on what the agent prompted, not just what it returned. This is the main reason to use aimock.
- **Control flow**: cache hits, dedup, retries, error paths, and style or feature injection. Inspect the request count and prompt content.

### Fixture types

- Text response (for `chat()` / `invokeConversation()`): `mock.on({}, { content: 'text' })`
- Structured output (for `generateObject()`): `mock.on({}, { content: JSON.stringify(obj) })` — the SDK parses it back via `response_format: json_schema`
- Sequential responses: `mock.on({ sequenceIndex: 0 }, ...)`, `sequenceIndex: 1`, ...
- Errors: `mock.on({}, { error: {...}, status: 500 })`
- See aimock docs for matching by user message, tool name, regex, or predicate.

### Test data

- Canned UI maps live in `test-data/ui-maps/`.
- Use fictional applications (Task Tracker, and so on). Never use real product data or user names.
- Two formats exist, depending on the agent under test:
  - **Planner-input** (`task-board.md`): Element and Type columns only — what the Planner sees after its own table-column filtering.
  - **Researcher-output** (`task-board-research.md`): full Element, Type, ARIA, CSS, and Coordinates columns — the raw Researcher AI output format.

### Module-level caches

Many agents hold module-level state: plan registry, session dedup, style cache, research cache. Each module that caches across calls must export a `clearXxx()` function for use in `beforeEach`. See the existing exports:

- `src/ai/planner/subpages.ts` — `clearPlanRegistry()`
- `src/ai/planner/session-dedup.ts` — `clearSessionDedup()`
- `src/ai/planner/styles.ts` — `clearStyleCache()`
- `src/ai/researcher/cache.ts` — `clearResearchCache()`

## Running

```bash
bun test tests/integration/planner.test.ts
bun test tests/integration/
```
