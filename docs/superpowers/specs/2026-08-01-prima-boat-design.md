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
explorbot prima click "the login link"           # single AI-resolved action (alias over do)
explorbot prima fill "search box" "wireless mouse"  # single AI-resolved fill (alias over do)
explorbot prima ask "what do I see here?"        # cheap-model page Q&A via Researcher
explorbot prima research [--data] [--deep] [--fresh]  # verified UI map for precise pw driving
explorbot prima verify "user is logged in"       # AI assertion (alias: assert)
explorbot prima go "billing settings"            # URL or NL navigation
explorbot prima browser start|stop|status|list   # instance management (stop --all)
```

Tiering: `pw` = precise, no AI — for when the orchestrator already holds a verified locator (from `research`) or drives via playwright-cli conventions; `click`/`fill` = one high-level action, always AI-resolved — the orchestrator never sees ARIA/HTML, so "the login link" is a description, not a locator, and the cheap model resolves it against the page; `do` = a set of high-level instructions executed tester-style in one AI loop. There are NO deterministic no-AI paths in the NL commands — precision without AI is exactly what `pw`/playwright-cli exist for, and duplicating it here would be surface without value. `select`, `pressKey`, `hover`, `drag` stay behind `pw`.

### Common flags

- `--endpoint <ep>` / `--pw-session <title>` — attach to a specific Playwright-protocol browser server (playwright-cli registry) instead of the ladder's automatic pick.
- `--instance <name>` / `-i` — which named prima-owned browser daemon to talk to when not attached. Default instance otherwise.
- `--session [file]` — existing auth-session semantics; a browser launched via explicit `prima browser start` loads the saved cookies/storage state. Ignored in attached mode.
- `--no-heal` — fail fast without cheap-model recovery.
- `--ephemeral` — throwaway temp state dir instead of the per-host persistent one.
- `--framework playwright|codeceptjs` — output dialect for `used:` code (default from `ai.agents.historian.framework`).
- `--no-vision` — `ask` answers from compact ARIA/UI map instead of the default screenshot pass.

### Execution paths

- **pw**: the argument is a function expression in the exact shape `I.usePlaywrightTo` accepts — `({ page, browserContext, browser }) => ...` — checked only for being a parseable function, then interpolated directly into `I.usePlaywrightTo('pw', <fn>)` and executed through the Explorer/Action pipeline so state capture, ariaDiff, and experience recording come for free. Destructure whichever Playwright objects the call needs. Deterministic and near-instant on the happy path.
- **do**: takes one or more high-level instructions and performs them tester-style — a bounded cheap-model loop over the existing CodeceptJS tools (click/type/form ladders), holding page context (compact ARIA + relevant experience) the orchestrator never sees, iterating until the instructions are done or the budget is exhausted. Multi-step by design: `prima do "open the first invoice" "download its PDF"`.
- **click / fill**: shorter aliases over the same AI resolution — a single instruction (`click <description>`, `fill <field description> <value>`) resolved by the cheap model against the current page (Navigator-style state resolution) and executed via the tool ladders. Never deterministic: the caller supplies a description, not a locator.
- **ask**: vision by default — Researcher answers from a fresh screenshot via the vision model; `--no-vision` (or no `visionModel` configured, with a note in the envelope) falls back to compact ARIA / cached UI map. Non-mutating.
- **research**: `researcher.research(state, { screenshot: true, data, deep, force })`. The envelope's `### Research` section carries the UI map inline — it is the deliverable: verified, live-tested locators that let the orchestrator drive `pw` precisely without reading raw ARIA. `--data` adds extracted data sections, `--deep` deep analysis, `--fresh` bypasses the cache; cached results keep the existing staleness banner. Non-mutating.
- **verify / assert**: `navigator.verifyState()` on the cheap model; verdict plus the assertion code that proved it.
- **go**: URL-shaped input navigates directly; intent-shaped input uses Navigator's stateful navigation with visited-state history and knowledge. Like every command, requires an existing browser session — it never launches one.

### Examples of `do`

- `prima do "click the login link"` → cheap model resolves the description against compact ARIA → `I.click('Login')`.
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

## Connectivity — Sharing the Browser with playwright-cli

Prima is a smart layer over whatever browser already exists, not an owner of a competing one. Every playwright-cli daemon browser is auto-`bind()`-ed as a Playwright-protocol browser server (public `browser.bind()` API, Playwright 1.62+), with a descriptor JSON in `~/.cache/ms-playwright/b/<guid>`: `{ playwrightVersion, playwrightLib, title: <session name>, endpoint, workspaceDir, browser: { browserName, ... } }`. Connecting to `endpoint` yields the same live Browser — same contexts, same tabs — exactly what `playwright-cli attach` does internally.

**Browser resolution ladder (every prima command):**

1. Explicit `--endpoint <ep>` (raw Playwright-protocol endpoint) or `--pw-session <title>` (registry lookup by title).
2. `PLAYWRIGHT_CLI_SESSION` env, matched against registry titles for this workspace.
3. Live registry descriptor with `workspaceDir` equal to the resolved cwd and `title` of `default`.
4. Exactly one live descriptor for this workspace → use it; multiple → tool-error envelope listing candidate titles.
5. A prima-owned instance previously started explicitly via `prima browser start` (`--instance` semantics below), if alive.
6. Nothing available → **fail** with a tool-error envelope instructing the caller to create a session first: start one with playwright-cli (`playwright-cli open <url>`) — the preferred path — or `prima browser start`. Prima never launches a browser implicitly.

Descriptors may be stale — always liveness-probe (attempt connect) before selecting; skip dead ones. Version skew: prefer connecting with our own playwright-core; if the wire handshake rejects, load the daemon's own lib from `descriptor.playwrightLib` (the same trick playwright-cli uses).

**Attached-mode rules:** prima never closes a browser it did not launch — `prima browser stop` detaches only; `--session` (auth storage-state) is ignored in attached mode (the attached browser owns its cookies); prima adopts the browser's existing default context and active page rather than creating a fresh context. The envelope's `### Instance` block reports the attachment (`browser: attached (playwright-cli session "default", workspace <dir>)`) so the orchestrator knows this browser is not its to kill.

A CDP attach mode (`--cdp <url>`, for a user's real Chrome, CI browsers, or a playwright-cli browser with `launchOptions.args: ["--remote-debugging-port=..."]` injected via `.playwright/cli.config.json`) is a documented follow-up, not v1.

## Instances & Sessions

- Named browser daemons via `--instance`; state persists across CLI invocations through the existing `explorbot browser start` server and `.browser-endpoint` discovery. Used only when the resolution ladder found no playwright-cli browser to attach to.
- No implicit launching: a `prima` command with no attachable browser and no running owned instance fails with the create-a-session guidance above.
- `prima browser start|stop|status|list` manages owned instances explicitly; `start` combined with `--session [file]` launches already authenticated; `stop --all` kills every owned instance (attached browsers are only detached). `list` shows owned instances and attachable playwright-cli sessions for this workspace.

## Degraded Modes

Prima is a layer over playwright-cli, so when prima itself cannot help, its job is to say so and point back down:

- **No browser session** (ladder step 6 above): tool-error envelope with the create-a-session instruction. Exit code 1.
- **AI unavailable** — no provider configured, missing/expired credentials, provider errors at startup: commands that require a model (`do`, `click`, `fill`, `ask`, `verify`, `research`, intent-`go`) fail fast with a tool-error envelope stating the specific reason (general shape: which layer failed and why) and suggesting the fallback: use playwright-cli for direct browser control, or fix the AI config (`~/.explorbot/config.js` / `EXPLORBOT_AI_PROVIDER`). No partial AI attempts.
- **`pw` stays useful without AI**: it executes normally (it needs no model); healing is skipped with a `healed: false (ai unavailable)` note in the envelope. URL-`go` likewise works.

The distinction rule from the heal section applies everywhere: tool-layer failures (browser missing, AI missing, invalid input) are never disguised as page failures.

## Config-Free Operation

Resolution ladder, first hit wins per setting:

1. Project config — `explorbot.config.js|ts` in cwd.
2. Global user config — `~/.explorbot/config.js|ts` (models, providers, keys).
3. Env vars — existing `EXPLORBOT_*` set, from process env, cwd `.env`, or `~/.explorbot/.env`.

All global paths resolve through `os.homedir()`, so the same single directory works on Linux (`/home/<user>/.explorbot`), macOS (`/Users/<user>/.explorbot`), and Windows (`C:\Users\<user>\.explorbot`) — no per-OS conventions (XDG, Library, AppData) to document or branch on.

The ladder lives in core config loading (`buildEnvConfig` grows global-config and global-`.env` sources); the boat inherits it.

With no project config, working dirs move to a persistent per-host state dir:

```
~/.explorbot/sites/<host>/
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
- End-to-end smoke against a local fixture page: `pw` success, healed failure, exhausted failure, no-browser failure with create-a-session guidance, `pw` without AI (heal-skipped note); `do`/`click` covered by aimock integration tests (they always require a model), plus an AI-unavailable test asserting the playwright-cli fallback suggestion.

## Decisions Log

- Heal-first on all action failures (not fail-fast, not opt-in). `--no-heal` escape hatch.
- Failure delivery: ariaDiff + error + compact ARIA inline; full HTML/ARIA/network as files.
- Full command surface in v1 (pw, do, click, fill, ask, verify/assert, go, browser mgmt).
- Discovery via `--help` only; no SKILL.md or MCP in v1.
- Boat architecture (`boat/prima`, namespace `prima`), not core commands.
- `--instance` for daemon switching; `--session` keeps existing auth-state meaning.
- Persistent per-host state dir by default in config-free mode; `--ephemeral` for temp.
- All global paths under a single cross-platform `~/.explorbot/` dir (config.js, .env, state/<host>/) — no XDG/Library/AppData branching.
- `ask` is vision-first; `--no-vision` opts into the ARIA text path.
- Prima attaches to playwright-cli's browser by default via the Playwright-protocol registry (`~/.cache/ms-playwright/b/`), matched by `workspaceDir` + session `title`; own daemon is the fallback, never the first choice.
- Attached browsers are never closed by prima; CDP attach (`--cdp`) deferred to a follow-up.
- No implicit browser launch: missing session → fail with "create one via playwright-cli" guidance; own daemon only via explicit `prima browser start`.
- AI unavailable → NL commands fail fast suggesting playwright-cli as fallback; `pw`/URL-`go` keep working with healing skipped.
- `used:` code in envelope via Historian converters; `verify` exposes assertion code.
- click/fill are single-instruction aliases over the same AI resolution as `do`; `do` accepts multiple high-level instructions run tester-style. No deterministic no-AI paths in NL commands — precision belongs to `pw`/playwright-cli. select/pressKey/hover/drag stay behind `pw`.
- `research` exposed with `--data`/`--deep`/`--fresh`; UI map inline as the deliverable (verified locators enable precise `pw` driving).
- Implementation runs on Opus.
