# API Testing

Explorbot tests REST APIs alongside web applications. The API testing module (codename **api-tester**) plans and runs HTTP test scenarios against your endpoints.

## Quick Start

Add API config to your `explorbot.config.js`:

```javascript
export default {
  web: {
    url: 'http://localhost:3000',
  },
  ai: {
    model: openrouter('openai/gpt-oss-20b'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
  api: {
    baseEndpoint: 'http://localhost:3000/api/v1',
    spec: ['http://localhost:3000/api/openapi.json'],
    headers: {
      'Authorization': 'Bearer <token>',
      'Content-Type': 'application/json',
    },
  },
};
```

Explore an endpoint:

```bash
npx explorbot api explore /users
```

This runs the full cycle: plan tests across several styles, run them, and report results.

## Commands

| Command | Description |
|---------|-------------|
| `npx explorbot api plan <endpoint>` | Generate a test plan for an endpoint |
| `npx explorbot api test <planfile> [index]` | Execute tests from a plan file |
| `npx explorbot api explore <endpoint>` | Full cycle: plan all styles, execute, report |
| `npx explorbot api init` | Initialize a standalone API testing project |
| `npx explorbot api know <endpoint> [desc]` | Add API knowledge for an endpoint |

### Planning

```bash
npx explorbot api plan /users                  # generate test plan
npx explorbot api plan /users --style hacker   # use specific planning style
npx explorbot api plan /users --fresh          # discard previous plan, start fresh
```

The planner generates scenarios with priorities, steps, and expected outcomes. It saves plans as markdown in `output/plans/`.

### Running Tests

```bash
npx explorbot api test output/plans/users.md 1       # run first test
npx explorbot api test output/plans/users.md 1-3     # run tests 1 to 3
npx explorbot api test output/plans/users.md 1,3,5   # run specific tests
npx explorbot api test output/plans/users.md *       # run all pending tests
```

### Full Exploration

```bash
npx explorbot api explore /users
```

Runs every planning style (normal, curious, psycho, hacker), generates tests for each, runs them, and writes a combined report.

## Configuration

### Unified Config

API testing works from your main `explorbot.config.js`. No separate config file is needed. Add an `api` section:

```javascript
export default {
  web: {
    url: 'http://localhost:3000',
  },
  ai: {
    model: openrouter('openai/gpt-oss-20b'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
  api: {
    baseEndpoint: 'http://localhost:3000/api/v1',
    spec: ['http://localhost:3000/api/openapi.json'],
    headers: {
      'Content-Type': 'application/json',
    },
  },
};
```

### API Config Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `baseEndpoint` | `string` | Yes | Base URL for all API requests |
| `spec` | `string[]` | No | OpenAPI spec URLs or file paths |
| `headers` | `Record<string, string>` | No | Default headers sent with every request |
| `bootstrap` | `function` | No | Runs before tests (e.g., obtain auth token) |
| `teardown` | `function` | No | Runs after tests (e.g., cleanup data) |

### Authentication Hooks

Use `bootstrap` to obtain an auth token before tests run:

```javascript
api: {
  baseEndpoint: 'http://localhost:3000/api/v1',
  bootstrap: async ({ headers, baseEndpoint }) => {
    const res = await fetch(`${baseEndpoint}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'secret' }),
    });
    const { token } = await res.json();
    return { Authorization: `Bearer ${token}` };
  },
  teardown: async ({ headers, baseEndpoint }) => {
    // cleanup test data if needed
  },
},
```

The object returned by `bootstrap` merges into the default headers for every later request.

### Standalone Config

For a dedicated API testing project, use a standalone `apibot.config.ts` instead:

```typescript
import { openai } from '@ai-sdk/openai';

export default {
  ai: {
    model: openai('gpt-4o'),
  },
  api: {
    baseEndpoint: 'https://api.example.com/v1',
    spec: ['https://api.example.com/openapi.json'],
    headers: {
      'Authorization': 'Bearer <token>',
    },
  },
  dirs: {
    output: 'output',
    knowledge: 'knowledge',
  },
};
```

When both files exist, `apibot.config.*` takes precedence over `explorbot.config.*`.

## Agents

API testing uses two agents.

### Chief

Plans API test scenarios for an endpoint. Reads the OpenAPI spec, fetches sample data, and generates test cases with priorities and expected outcomes.

Planning styles cycle during `explore`:

| Style | Focus |
|-------|-------|
| `normal` | Standard CRUD and validation tests |
| `curious` | Edge cases, unusual inputs, coverage gaps |
| `psycho` | Stress testing, boundary values, extreme inputs |
| `hacker` | Security-focused: injection, auth bypass, privilege escalation |

Add custom styles in `rules/chief/styles/`.

### Curler

Runs test scenarios step by step through AI tool calling. Available tools:

| Tool | Purpose |
|------|---------|
| `request` | Make HTTP requests with full tracing |
| `verifyStructure` | Validate response shape with schemas |
| `verifyData` | Run assertions on response data |
| `schemaFor` | Look up endpoint definitions from OpenAPI spec |
| `record` | Document findings and notes |
| `finish` | Mark test as complete |
| `stop` | Abandon test (scenario impossible) |

### Agent Model Configuration

Both Chief and Curler use `agenticModel` by default and fall back to `model`. Override per agent:

```javascript
ai: {
  model: openrouter('openai/gpt-oss-20b'),
  agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  agents: {
    chief: { model: openrouter('x-ai/grok-4-fast') },
    curler: { model: openrouter('x-ai/grok-4-fast') },
  },
},
```

## Knowledge

Add API knowledge to help agents understand your endpoints:

```bash
npx explorbot api know /users "CRUD endpoint for user management. Requires admin role."
npx explorbot api know /auth "Login with email/password, returns JWT token"
```

Explorbot saves knowledge files in `knowledge/` with endpoint frontmatter:

```markdown
---
endpoint: "/users"
---
CRUD endpoint for user management.
Requires admin role for write operations.
User IDs are UUIDs.
```

## Output

| Output | Location | Description |
|--------|----------|-------------|
| Test plans | `output/plans/*.md` | Markdown plans with scenarios and priorities |
| Request logs | `output/requests/` | Recorded HTTP request/response pairs |

## See Also

- [Configuration](../reference/configuration.md) — full configuration reference
- [Agents](../reference/agents.md) — agent descriptions and capabilities
- [Observability](../contributing/observability.md) — Langfuse tracing for API tests
