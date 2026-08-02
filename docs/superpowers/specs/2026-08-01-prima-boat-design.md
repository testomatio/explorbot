# Prima Boat — High-Level Browser Driver for Orchestrating Agents

**Date:** 2026-08-01
**Status:** Draft for review
**Implementation model:** Opus

## Problem

Coding agents (Claude Code on Opus/Fable) drive browsers through playwright-cli or Playwright MCP. Every action forces page state (aria snapshots) into the orchestrator's context: the expensive model pays to read the tree, pick a ref, and re-read after every step, and each snapshot stays in conversation history compounding cost for the rest of the session. A 20-step flow means 20+ expensive perception roundtrips.

Explorbot already owns the layers that fix this: cheap-model perception (Navigator, Researcher), semantic diffs (ariaDiff, pageDiff), state tracking, and experience replay. The Prima boat exposes those layers as an intent-level CLI so the orchestrator sends instructions and receives compact evidence — page data never enters the expensive context on the happy path.

## Goals

- Orchestrator issues precise Playwright calls or natural-language instructions; explorbot's cheap models run the perception–action micro-loop.
- Every response is a uniform envelope: evidence of what happened, never a raw page dump.
- Failures exhaust cheap healing first, then return a compacted investigation so the orchestrator can drop down a level and drive directly.
- Zero project setup: works from any directory via env vars and a global user config, with per-host persistent state.
- Every successful action reports the exact code that worked, so sessions double as verified-locator material for test generation.

## Non-Goals

- Not a replacement for playwright-cli as a general browser tool.
- No MCP server, no SKILL.md package in v1 — the contract is taught entirely by `--help` text.
- No new core agents unless heal orchestration proves to need one (then it lives inside the boat).

## Architecture

A boat, following the existing `boat/api-tester` / `boat/doc-collector` pattern:

```
boat/prima/
├── package.json          # name: "prima", own bin
├── bin/prima-cli.ts     # standalone CLI
└── src/
    ├── cli.ts            # createPrimaCommands('prima') → composed into main CLI
    ├── prima.ts          # Prima class wrapping ExplorBot (like DocBot)
    ├── envelope.ts       # result envelope: inline render + artifact files
    └── config.ts
```

Registered in `bin/explorbot-cli.ts` via `program.addCommand(createPrimaCommands('prima'))`. The `Prima` class wraps `ExplorBot`, reusing `agentNavigator()`, `agentResearcher()`, `stateManager()`, Historian, and the Explorer/Action capture pipeline. Business logic lives in the Prima class and agents; CLI handlers stay thin, per repo convention.

## Command Surface

```
explorbot prima pw "({ page }) => page.click('text=Login')"   # raw Playwright fn, healed on failure
explorbot prima do "click the login link"        # NL action via Navigator
explorbot prima click "Login"                    # targeted click via existing fallback ladder
explorbot prima fill "Search" "wireless mouse"   # targeted fill via existing ladder
explorbot prima ask "what do I see here?"        # cheap-model page Q&A via Researcher
explorbot prima research [--data] [--deep] [--fresh]  # verified UI map for precise pw driving
explorbot prima verify "user is logged in"       # AI assertion (alias: assert)
explorbot prima go "billing settings"            # URL or NL navigation
explorbot prima browser start|stop|status|list   # instance management (stop --all)
```

Tiering: `pw` = precise (no AI on happy path), `click`/`fill` = targeted with deterministic fallback ladders (AI only on ambiguity), `do` = intent (cheap-model planning). `select`, `pressKey`, `hover`, `drag` intentionally stay behind `pw` — a subcommand without a ladder is surface without value.

### Common flags

- `--instance <name>` / `-i` — which named browser daemon to talk to. Default instance otherwise.
- `--session [file]` — existing auth-session semantics; an autostarted instance launches with the saved cookies/storage state.
- `--no-heal` — fail fast without cheap-model recovery.
- `--ephemeral` — throwaway temp state dir instead of the per-host persistent one.
- `--framework playwright|codeceptjs` — output dialect for `used:` code (default from `ai.agents.historian.framework`).
- `--vision` — force screenshot pass for `ask`.

### Execution paths

- **pw**: the argument is a function expression in the exact shape `I.usePlaywrightTo` accepts — `({ page, browserContext, browser }) => ...` — checked only for being a parseable function, then interpolated directly into `I.usePlaywrightTo('pw', <fn>)` and executed through the Explorer/Action pipeline so state capture, ariaDiff, and experience recording come for free. Destructure whichever Playwright objects the call needs. Deterministic and near-instant on the happy path.
- **do**: one bounded Navigator invocation (max ~3 tool roundtrips) reusing the existing click/type/form tool ladders. Deterministic fast path first: if the instruction resolves to exactly one interactive ARIA node by role+name, execute with zero AI calls.
- **click / fill**: the existing multi-fallback ladders directly (text → ARIA → experience candidates); cheap-model disambiguation only when multiple candidates match.
- **ask**: Researcher answers from current compact ARIA / cached UI map; `--vision` routes through the vision model. Non-mutating.
- **research**: `researcher.research(state, { screenshot: true, data, deep, force })`. The envelope's `### Research` section carries the UI map inline — it is the deliverable: verified, live-tested locators that let the orchestrator drive `pw` precisely without reading raw ARIA. `--data` adds extracted data sections, `--deep` deep analysis, `--fresh` bypasses the cache; cached results keep the existing staleness banner. Non-mutating.
- **verify / assert**: `navigator.verifyState()` on the cheap model; verdict plus the assertion code that proved it.
- **go**: URL-shaped input navigates directly; intent-shaped input uses Navigator's stateful navigation with visited-state history and knowledge. Autostarts the instance like every other command.

### Examples of `do`

- `prima do "click the login link"` → ARIA has one `link "Login"` → `I.click('Login')`, zero AI.
- `prima do "search for 'wireless mouse'"` → cheap model plans fill + Enter → both lines reported in `used:`.
- `prima do "dismiss the cookie banner"` → ambiguous → cheap model picks `button "Accept all"` from compact ARIA.
- `prima do "open the newest invoice"` → list interpretation → cheap model over the UI map picks the first row link.

## The Envelope

The uniform response contract: every command prints the same block structure in the same order to stdout, success or failure. Two jobs: evidence (prove what happened without showing the page) and housekeeping (what is open, what to clean up, where to dig deeper).

### Success (~200–400 tokens inline)

```
### Result
ok: true
command: pw ({ page }) => page.click('text=Login')
healed: false
used: I.click('Login')

### Page
url: https://app.example.com/dashboard   (changed: /login → /dashboard)
title: Dashboard
state: dashboard_h1_dashboard            (new state, visit #1)

### Changes
ariaDiff:
  added:
    - heading "Dashboard"
    - button "New Project"
  removed:
    - textbox "Email"

### Instance
instance: default (3 tabs) | other instances: auth-test (1 tab)
browser: running (started 12m ago)

### Artifacts
aria:    <abs path>/output/prima/<ts>/aria.yml
html:    <abs path>/output/prima/<ts>/page.html
network: <abs path>/output/prima/<ts>/network.jsonl
```

- `used:` — the exact code that worked (healed form when healed), rendered in the configured framework via Historian's converters. Sessions thereby double as a verified-locator oracle for test generation.
- `### Changes` becomes `### Answer` for `ask`, `### Verdict` (pass/fail + evidence line + assertion code) for `verify`, and `### Research` (the UI map, inline) for `research`.
- `### Instance` appears on every response — tab counts and other live instances — so the orchestrator sees leftover state and knows to close it when finished.
- Artifact paths are always absolute; full HTML, full ARIA, and the network log are always written, never inlined.

### Failure (after healing exhausted, ~1–2k tokens inline)

Same sections, plus:

```
### Failure
error: locator 'text=Login' not found (timeout 5s)

### Healing attempts (3)
1. I.click('Login')                    → not visible
2. scroll + retry                      → covered by cookie banner
3. click 'Accept cookies', retry       → navigation timeout
reasoning (compacted): ~5-line cheap-model summary of what it observed and why each attempt was chosen

### Current page (compact ARIA, inline)
- button "Accept cookies"
- link "Login"
...
```

Inline: ariaDiff, error, compact ARIA. On disk: full HTML, full ARIA, network log. The orchestrator investigates from the inline compact ARIA and reads artifact files only when it needs depth.

## Heal Loop

On `pw`, `do`, `click`, or `fill` failure, the failing intent goes to Navigator's existing recovery ladder on the cheap model: alternative locators from ARIA/experience, scroll-into-view, overlay dismissal, retry. Capped at 3 attempts by default; `--no-heal` disables. Every attempt logs `{action, code, result, ariaDiff}`; reasoning is compacted to ~5 lines at the end. Heal success returns a success envelope with `healed: true` and writes the fix to experience so the next run replays it without AI. Heal exhaustion returns the failure envelope.

Tool errors (daemon unreachable, AI provider missing, invalid `pw` expression) are reported as `ok: false` with a `### Failure` naming the failed layer — never disguised as page failures.

## Instances & Sessions

- Named browser daemons via `--instance`; state persists across CLI invocations through the existing `explorbot browser start` server and `.browser-endpoint` discovery.
- Any `prima` command with no running daemon autostarts one for its instance; combined with `--session [file]`, the autostarted browser launches already authenticated.
- `prima browser start|stop|status|list` manages instances explicitly; `stop --all` kills everything.

## Config-Free Operation

Resolution ladder, first hit wins per setting:

1. Project config — `explorbot.config.js|ts` in cwd.
2. Global user config — `~/.config/explorbot/config.js|ts` (models, providers, keys).
3. Env vars — existing `EXPLORBOT_*` set, from process env, cwd `.env`, or `~/.config/explorbot/.env`.

The ladder lives in core config loading (`buildEnvConfig` grows global-config and global-`.env` sources); the boat inherits it.

With no project config, working dirs move to a persistent per-host state dir:

```
~/.local/state/explorbot/<host>/
├── experience/
├── knowledge/
└── output/prima/...
```

Experience accumulates per target host across runs from any directory — zero-setup feel with memory. `--ephemeral` opts into a throwaway temp dir (CI, demos).

## Discovery

`explorbot prima --help` (and `prima --help`) is the sole teaching surface: it must compactly document the envelope shape, heal semantics, tiering (`pw` vs `click`/`fill` vs `do`), instance/session flags, and the artifact-file pattern. Clean stdout throughout (no banner).

## Testing

- Unit: envelope rendering (success, failure, ask/verify variants), `pw` expression validation, config ladder resolution.
- Integration: heal-loop prompts via the existing `@copilotkit/aimock` harness per `docs/contributing/ai-integration-tests.md`; fictional fixture data only.
- End-to-end smoke against a local fixture page: `pw` success, healed failure, exhausted failure, `do` fast path (zero AI), instance autostart with `--session`.

## Decisions Log

- Heal-first on all action failures (not fail-fast, not opt-in). `--no-heal` escape hatch.
- Failure delivery: ariaDiff + error + compact ARIA inline; full HTML/ARIA/network as files.
- Full command surface in v1 (pw, do, click, fill, ask, verify/assert, go, browser mgmt).
- Discovery via `--help` only; no SKILL.md or MCP in v1.
- Boat architecture (`boat/prima`, namespace `prima`), not core commands.
- `--instance` for daemon switching; `--session` keeps existing auth-state meaning.
- Persistent per-host state dir by default in config-free mode; `--ephemeral` for temp.
- `used:` code in envelope via Historian converters; `verify` exposes assertion code.
- click/fill exposed as ladder-backed sugar; select/pressKey/hover/drag stay behind `pw`.
- `research` exposed with `--data`/`--deep`/`--fresh`; UI map inline as the deliverable (verified locators enable precise `pw` driving).
- Implementation runs on Opus.
