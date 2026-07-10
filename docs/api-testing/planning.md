# Planning API Tests

Chief plans the scenarios; how good they are depends on the context you give it. Start by feeding it what it needs, then choose how aggressively it should probe.

## Give Chief context

**The API spec.** Chief reads the OpenAPI spec from your `spec` config to learn paths, methods, and request/response schemas. It also fetches live sample data from the endpoint — real IDs, enum values, field names — so the scenarios it writes reference data that actually exists instead of guessing. A good spec is the single biggest lever on plan quality.

**Endpoint knowledge.** The spec says what an endpoint accepts, not how your business rules work. Add that with `know`:

```bash
npx explorbot api know /users "CRUD for users. Admin role required for writes. IDs are UUIDs."
```

This writes a markdown file under `knowledge/` with `endpoint:` frontmatter:

```markdown
---
endpoint: "/users"
---
CRUD for users. Admin role required for writes. IDs are UUIDs.
```

Chief loads knowledge matching the endpoint it's planning. Running `know` again on the same endpoint appends to the file. See [knowledge](../workflow/knowledge.md) for how matching and files work.

## Choose a planning style

A style tells Chief what kind of tests to prioritize. Four ship by default:

| Style | Focus |
|-------|-------|
| `normal` | Standard CRUD and happy paths — create, read, update, delete, verify status codes and schemas |
| `curious` | Maximum coverage — every field, every enum value, arrays, defaults |
| `psycho` | Malformed and extreme input — missing fields, injection payloads, wrong content types, boundary values |
| `hacker` | Security probing — infers hidden endpoints and undocumented fields from responses, then tries privilege escalation, IDOR, and auth-bypass against them |

Pick one with `--style`:

```bash
npx explorbot api plan /users --style hacker
```

Without `--style`, Chief uses `normal`. Styles are markdown files in `rules/chief/styles/`, so you can edit them or drop in your own. The cycling and customization mechanism is shared with web planning — see [planning styles](../workflow/planning-styles.md).

## Replan from scratch or add to a plan

By default a `plan` run generates a fresh set of scenarios. When a plan already exists in the same run, Chief compares against it and adds only new, non-duplicate scenarios — it won't re-propose behavior it already covered, even under a different style. Pass `--fresh` to discard the in-progress plan and start clean:

```bash
npx explorbot api plan /users --fresh
```

This is what [`explore`](./running-tests.md) uses to give each style its own clean plan.

## Where plans land

Chief saves each plan to `output/plans/`, named after the endpoint (for example `output/plans/users.md`). The file is a standard Explorbot [test plan](../workflow/test-plans.md): a suite of scenarios, each with steps, expected outcomes, and a priority. Read it, edit it, or commit it — then run it as described in [Running API tests](./running-tests.md).
