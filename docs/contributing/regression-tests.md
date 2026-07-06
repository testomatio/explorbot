# Self-Regression Tests

The regression harness runs Explorbot **end-to-end with real AI models** against a controlled local fixture app, then asserts on the artifacts Explorbot produces (research, plans, test results). Unlike the integration tests in `tests/integration/` — which mock the LLM — these runs use a live provider, so they are nondeterministic and gated behind owner approval in CI.

The harness lives in `tests/regression/` and is driven by `regression:*` commands in the repo `Bunoshfile.js`.

## Scenarios

### Scenario A — fresh explore (`regression:basic`)

Runs `explorbot explore /issues --headless` against the Trackly fixture and asserts:

- **Login evidence** — a plan targets a post-login route (`/issues`, `/settings`) and at least one research file describes a post-login page (proves the agent applied the seeded credentials and got past the gate).
- **Research** — at least one research file with a heading, a UI-map table, and enough domain keywords.
- **Scenarios identified** — the plan holds at least `MIN_PLANNED_TESTS` tests covering at least `MIN_FEATURE_GROUPS` feature areas.
- **Tests passed** — the `Results: N passed, N failed` stdout line shows no failures and at least `MIN_PASSED` passing tests, cross-checked against the reporter markdown.

Credentials are supplied through a seeded knowledge file (`tests/regression/seeds/knowledge/login.md`) matched to `/login`, so this scenario also exercises knowledge rules.

### Scenario B — experience reuse (`regression:experience`)

Proves Explorbot reuses prior context to pass a test it cannot pass cold. The Trackly Archive vault (`/vault`) is unlocked only by an access code that exists nowhere in the DOM — only in the server and in the seed files.

- **Control run** (always, once) — runs the seed plan with **empty** knowledge and experience dirs. It must NOT pass. A fully-passing control means the vault gate is broken and fails the harness.
- **Seeded run** (retried) — runs the same plan with the seed knowledge and experience dirs. It must pass.

The plan (`tests/regression/seeds/vault-plan.md`) describes *what* to do but never contains the code. The seeded context supplies it two ways: `seeds/knowledge/vault.md` carries the access **code** (data), and `seeds/experience/vault.md` carries the interaction **recipe** (fill field, click Unlock). Both are prior seeded context; the control has neither and fails.

> The code is carried in a knowledge file, not only experience, on purpose. Knowledge is Explorbot's prominent, deterministic channel for page-specific data — the same mechanism scenario A uses for login credentials. Empirically, cheap models followed an experience-only code recipe only occasionally, so an experience-only gate was a coin-flip; knowledge makes the gate reliable while the experience file still exercises recipe reuse.

## The fixture app — "Trackly"

A self-contained issue tracker served in-process by `tests/regression/fixture/server.ts` (`Bun.serve`, ephemeral port, fresh in-memory store per attempt). No external network, no database.

| Route | Auth | Contents |
|-------|------|----------|
| `/login` | no | credentials form (always native HTML) |
| `/issues` | yes | issue list, search, status filter, label menu (start page) |
| `/issues/new` | yes | create form: title, description, priority, labels + assignees multiselects |
| `/issues/:id` | yes | detail, change-status menu, comment form, delete modal |
| `/settings` | yes | Profile/Preferences tabs + an activity iframe |
| `/vault` | no | scenario B access-code gate |
| `/api/*` | cookie | REST API over the same store, `+ /api/openapi.json` |

The REST API mirrors the store and is served for a future API-testing scenario; the current scenarios do not exercise it.

### Component variants (ARIA on/off)

Every widget (button, text field, select, multiselect, dropdown menu, modal, tabs) renders in one of three variants, selectable per run:

- `native` — semantic HTML (`<button>`, `<select multiple>`, `<dialog>`, `<details>`).
- `aria` — custom `<div>` widgets with correct roles (`role="combobox"`, `aria-modal`, `role="menu"`, …).
- `plain` — bare `<div>` widgets with no roles or labels (the hostile case).
- `random` — a seeded RNG picks a variant per widget; the same `--seed` reproduces identical markup.

Pass `--variant` and `--seed` to any scenario. The login page is always native so variant runs don't fail at the door.

## Running locally

```bash
# No-AI sanity check: fixture routes, auth, API, vault gate, seed parsing, variant rendering
bunx bunosh regression:smoke

# Serve the fixture for manual inspection (append ?variant=plain&seed=7 to any page)
bunx bunosh regression:serve

# Real-AI runs (need a provider key)
export OPENROUTER_API_KEY=sk-...
bunx bunosh regression:experience --retries 0   # cheapest AI path
bunx bunosh regression:basic --retries 0
bunx bunosh regression:all                       # both scenarios, default retries
```

Each attempt runs in an isolated throwaway directory under `tests/regression/.runs/` (gitignored). Inspect `tests/regression/.runs/<scenario>-<variant>-a<n>/output/` for the research, plans, and reporter markdown a run produced, and `tests/regression/.runs/report.md` for the summary.

### Variant matrix

`regression:variants` runs a scenario across variants and reports the outcome per variant **without gating** — a `plain`-variant failure is data about model robustness, not a regression. Only a crashed or timed-out run fails it.

```bash
bunx bunosh regression:variants --scenario basic --variants native,aria,plain
```

## CI and the approval gate

`.github/workflows/regression.yml` runs on `pull_request` and `workflow_dispatch`. The job uses the `regression` GitHub environment, which holds `OPENROUTER_API_KEY` behind a **required reviewer**. Every run — including fork PRs — pauses at the environment gate before the secret is exposed. The job runs the PR's own code, so the reviewer must read the PR diff (workflow, Bunoshfile, fixture, lib) before approving; that review is the security boundary. The workflow never uses `pull_request_target`.

The report is posted as a sticky PR comment (on `pull_request`) or a `Regression Reports` GitHub Discussion (on `workflow_dispatch`). Fork PRs get a read-only token, so comment posting may fail; the report is also written to the job step summary and uploaded as the `regression-runs` artifact.

The report also embeds the **Session Analysis** from the fresh-explore run — Explorbot's Analyst agent writes a prose summary of what works, defects, UX issues, and execution issues, which the harness reads from `output/reports/<label>.md` and appends to the comment. The Analyst is enabled in the config template (`ai.agents.analyst.enabled: true`); it adds one AI call per basic run.

## Tuning

- **Thresholds** (`MIN_PLANNED_TESTS`, `MIN_PASSED`, `MIN_KEYWORD_HITS`, `MIN_FEATURE_GROUPS`) live at the top of `tests/regression/lib/assertions.ts`.
- **Models** live in `tests/regression/fixture/explorbot.config.js`. If cheap models are too flaky, promote a stronger model to `ai.model` or lower `MIN_PASSED`.
- **Run size** — adjust `--max-tests` in `runBasicScenario` and the per-CLI `timeout` values in `Bunoshfile.js`.

## Owner prerequisites (one-time)

1. Settings → Environments → create `regression`; add the repo owner as a **Required reviewer**; deployment branch policy "No restriction".
2. Add the environment secret `OPENROUTER_API_KEY` (a dedicated key with a low spend limit).
3. Create a Discussions category named exactly `Regression Reports`.
4. Ensure the OpenRouter account has credit for the models in the config template.
