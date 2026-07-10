# API Testing Basics

Explorbot tests REST APIs the same way it tests web apps: it plans scenarios, runs them, and reports results — no test scripts. Two AI agents do the work.

**Chief** reads your endpoint, its OpenAPI spec, and any [knowledge](../workflow/knowledge.md) you've written, then plans test scenarios: what to send, and what a correct response looks like.

**Curler** takes each scenario and executes it as real HTTP requests, checking the responses with assertions.

The plans Chief writes are ordinary Explorbot [test plans](../workflow/test-plans.md) — plain markdown you can read, edit, and commit. The web and API sides share the same plan format and the same [reporting](../workflow/reporting.md).

## Configure

Point Explorbot at your API by adding an `api` key to your `explorbot.config.js`:

```javascript
export default {
  ai: {
    model: openrouter('openai/gpt-oss-20b:nitro'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
  api: {
    baseEndpoint: 'http://localhost:3000/api/v1',
    spec: ['http://localhost:3000/api/openapi.json'],
    headers: {
      Authorization: 'Bearer <token>',
    },
  },
};
```

- **`baseEndpoint`** (required) — the base URL prepended to every request. Test steps use relative paths like `/users`; Curler adds the base for you.
- **`spec`** (required) — one or more OpenAPI specs, given as HTTP(S) URLs or local file paths, in YAML or JSON. Chief uses the spec to plan; Curler uses it to look up schemas. Both agents refuse to run without one.
- **`headers`** — sent with every request. This is where API keys and auth tokens go.

See the [full configuration reference](../reference/configuration.md) for every option and [providers](../setup/providers.md) for choosing an AI model.

### Authenticating

If a static token in `headers` is enough, you're done. If you need to log in and fetch a token first, use the `bootstrap` hook — it runs once before any tests, and whatever headers it returns merge into every later request:

```javascript
api: {
  baseEndpoint: 'http://localhost:3000/api/v1',
  spec: ['http://localhost:3000/api/openapi.json'],
  bootstrap: async ({ baseEndpoint }) => {
    const res = await fetch(`${baseEndpoint}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'secret' }),
    });
    const { token } = await res.json();
    return { Authorization: `Bearer ${token}` };
  },
},
```

A matching `teardown` hook runs after all tests finish — use it to clean up data.

### A dedicated API project

If you don't have a web `explorbot.config.js`, run `npx explorbot api init`. It asks for your base endpoint, spec, and a one-line description of the API, then writes a standalone `apibot.config.ts` (with an `ai` and `api` section) plus `output/` and `knowledge/` directories. When both files exist, `apibot.config.*` takes precedence over `explorbot.config.*`.

## Your first run

The minimal loop is plan, then test. Point Chief at an endpoint:

```bash
npx explorbot api plan /users
```

On startup Explorbot does a health check — a `GET /` against your base endpoint — so a bad URL or token fails immediately. Then Chief fetches sample data, reads the spec, and writes scenarios to `output/plans/users.md`. Hand that file to Curler:

```bash
npx explorbot api test output/plans/users.md
```

Curler runs the scenarios and prints how many passed and failed.

## What you get

| Output | Location | What it is |
|--------|----------|------------|
| Test plans | `output/plans/*.md` | Chief's scenarios — priorities, steps, expected outcomes |
| Request logs | `output/requests/*.request.yaml` | Every HTTP request and response, for debugging |
| Reports | via the shared [reporter](../workflow/reporting.md) | Pass/fail results, optionally sent to Testomat.io |

## Next steps

- [Planning API tests](./planning.md) — give Chief context and steer what it tests.
- [Running API tests](./running-tests.md) — execute plans, read request logs, and run the full autonomous cycle.
