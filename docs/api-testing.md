# API Testing

Explorbot can autonomously test REST APIs alongside web applications. The API testing module (codename **api-tester**) uses AI agents to plan and execute HTTP-based test scenarios against your API endpoints.

## Quick Start

**1. Add API config** to your `explorbot.config.js`:

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

**2. Explore an endpoint:**

```bash
explorbot api explore /users
```

This runs the full cycle: plan tests across multiple styles, execute them, and report results.

## Commands

| Command | Description |
|---------|-------------|
| `explorbot api plan <endpoint>` | Generate a test plan for an endpoint |
| `explorbot api test <planfile> [index]` | Execute tests from a plan file |
| `explorbot api explore <endpoint>` | Full cycle: plan all styles, execute, report |
| `explorbot api init` | Initialize a standalone API testing project |
| `explorbot api know <endpoint> [desc]` | Add API knowledge for an endpoint |

### Planning

```bash
explorbot api plan /users                  # generate test plan
explorbot api plan /users --style hacker   # use specific planning style
explorbot api plan /users --fresh          # discard previous plan, start fresh
```

The planner generates scenarios with priorities, steps, and expected outcomes. Plans are saved as markdown in `output/plans/`.

### Running Tests

```bash
explorbot api test output/plans/users.md 1       # run first test
explorbot api test output/plans/users.md 1-3     # run tests 1 to 3
explorbot api test output/plans/users.md 1,3,5   # run specific tests
explorbot api test output/plans/users.md *       # run all pending tests
```

### Full Exploration

```bash
explorbot api explore /users
```

Runs all planning styles (normal, curious, psycho, hacker), generates tests for each, executes them, and produces a combined report.

## Configuration

### Unified Config

API testing works from your main `explorbot.config.js` — no separate config file needed. Add an `api` section:

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

Use `bootstrap` to dynamically obtain auth tokens before tests run:

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

The object returned by `bootstrap` is merged into the default headers for all subsequent requests.

### Standalone Config

For dedicated API testing projects, you can use a standalone `apibot.config.ts` instead:

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

API testing uses two specialized agents:

### Chief

Plans API test scenarios for an endpoint. Analyzes the OpenAPI spec, fetches sample data, and generates test cases with priorities and expected outcomes.

**Planning styles** cycle automatically during `explore`:

| Style | Focus |
|-------|-------|
| `normal` | Standard CRUD and validation tests |
| `curious` | Edge cases, unusual inputs, coverage gaps |
| `psycho` | Stress testing, boundary values, extreme inputs |
| `hacker` | Security-focused: injection, auth bypass, privilege escalation |

Custom styles can be added in `rules/chief/styles/`.

### Curler

Executes test scenarios step-by-step using AI-driven tool calling. Available tools:

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

Both Chief and Curler use `agenticModel` by default (falling back to `model`). Override per-agent:

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

Add API-specific knowledge to help agents understand your endpoints:

```bash
explorbot api know /users "CRUD endpoint for user management. Requires admin role."
explorbot api know /auth "Login with email/password, returns JWT token"
```

Knowledge files are saved in `knowledge/` with endpoint frontmatter:

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

- [Configuration](./configuration.md) — Full configuration reference
- [Agents](./agents.md) — Agent descriptions and capabilities
- [Observability](./observability.md) — Langfuse tracing for API tests
