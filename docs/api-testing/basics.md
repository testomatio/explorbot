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
- **`headers`** — sent with every request. This is where API keys and auth tokens go. `-H "Name: value"` on the command line and `EXPLORBOT_API_HEADERS` add to them without a config file.

See the [full configuration reference](../reference/configuration.md) for every option and [providers](../basics/providers.md) for choosing an AI model.

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

### Without a config file

Chief and Curler need three things: where the API is, what its spec says, and how to authenticate. Pass all three on the command line and no config file is needed:

```bash
npx explorbot api explore https://api.example.com/v1 \
  --spec ./openapi.yaml \
  -H "Authorization: Bearer $TOKEN"
```

`api explore` takes an endpoint or a pattern as its argument, so one line covers the whole run: it plans, executes each plan, and reports the totals. Passing the base endpoint covers every collection the spec describes. The other commands take a path within the API and read the base from `--endpoint`:

```bash
npx explorbot api plan /users \
  --endpoint https://api.example.com/v1 \
  --spec ./openapi.yaml \
  -H "Authorization: Bearer $TOKEN"
```

Each flag has an environment twin — `EXPLORBOT_URL`, `EXPLORBOT_API_SPEC` and `EXPLORBOT_API_HEADERS` — and the flag wins when both are set. `-H` is repeatable and takes one `Name: value` per use; the variable takes one per line. Headers land on every request, the startup health check included, and merge over any `headers` a config file sets. `--knowledge` adds to the facts `EXPLORBOT_KNOWLEDGE` and `EXPLORBOT_KNOWLEDGE_FILE` bring in rather than replacing them. Configure your models once with `npx explorbot init --global` and every run stores its plans and requests per host under `~/.explorbot/sites/<host>/`, so a later `api test` against the same API picks up where the last one left off. Knowledge given on the command line lasts for the run; `api know` is what writes it down.

The base endpoint keeps its path prefix: given `https://api.example.com/v1`, steps stay relative (`/users`) and Curler sends them to `https://api.example.com/v1/users`. `api test`, which takes a plan file rather than an endpoint, reads the base from the flag or the variable.

### A dedicated API project

If you don't have a web `explorbot.config.js`, run `npx explorbot api init`. It asks for your base endpoint, spec, and a one-line description of the API, then writes a standalone `apibot.config.js` (with an `ai` and `api` section) plus `output/` and `knowledge/` directories. When both files exist, `apibot.config.*` takes precedence over `explorbot.config.*`.

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

### Covering many endpoints

`api explore` runs the whole loop for you: plan, test, re-plan. Given one endpoint it plans in every style.

```bash
npx explorbot api explore /users
```

The endpoint may be a pattern. `*` stands for one path segment, and a pattern also covers the paths below it, so `/users` and `/users/*` both cover `/users/{id}`. Quote it, or your shell will try to expand it first.

```bash
npx explorbot api explore '/projects/acme/*'
```

Explorbot explores collections, not raw paths: `/users/{id}` and `/users/{id}/posts` fold into `/users`, whose spec lookup brings them along anyway. When a pattern matches several collections the planning styles spread across them, one style per collection, so covering a whole API stays one plan per collection rather than one per style.

Pass `/` to take every collection in the spec. The path parameters have to come from somewhere, so put them in the base endpoint.

```bash
npx explorbot api explore / --endpoint https://api.example.com/v2/acme
```

If a parameter is left with no value the run stops and names it, rather than sending requests to a literal `{project_id}`. Collections whose own parameters no pattern can fill, like `/analytics/stats/{kind}`, are listed and skipped.

## Output files

| Output | Location | What it is |
|--------|----------|------------|
| Test plans | `output/plans/*.md` | Chief's scenarios — priorities, steps, expected outcomes |
| Request logs | `output/requests/*.request.yaml` | Every HTTP request and response, for debugging |
| Reports | via the shared [reporter](../workflow/reporting.md) | Pass/fail results, optionally sent to Testomat.io |

## Next steps

- [Planning API tests](./planning.md) — give Chief context and steer what it tests.
- [Running API tests](./running-tests.md) — execute plans, read request logs, and run the full autonomous cycle.
