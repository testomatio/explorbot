# Terminal Commands Reference

Explorbot runs the same commands two ways: from your shell (CLI) and inside an interactive session (TUI).

- **CLI** — run from your shell. Each command launches a browser, runs the task, prints output, and exits `0` on success or `1` on failure. Use it for CI, scripting, and chaining commands.
- **TUI** — the interactive terminal UI from `npx explorbot start`. The same commands run as slash commands against a long-lived browser.

Both share the same code, so behavior and options match.

## Most used commands

| Goal | Command |
|------|---------|
| Start an interactive session | `npx explorbot start /path` |
| Explore a feature end to end | `npx explorbot explore /path --focus "feature"` |
| Analyze a page without running tests | `npx explorbot research /path` |
| Create a focused test plan | `npx explorbot plan /path --focus "user goal and boundaries"` |
| Run a saved plan | `npx explorbot test output/plans/plan.md` |
| List generated runnable tests | `npx explorbot runs` |
| Re-run generated tests with healing | `npx explorbot rerun output/tests/suite.js --session` |
| Teach Explorbot an app-specific fact | `npx explorbot learn /path "note"` |

Inside the TUI, use the matching slash command: `/explore`, `/research`, `/plan`, `/test`, `/runs`, or `/rerun`.

## Command Reference

| Capability | CLI | TUI | Notes |
|---|---|---|---|
| Start interactive session | `npx explorbot start [path]` | — | Boots the TUI |
| Autonomous exploration | `npx explorbot explore <path>` | `/explore [focus]` | Full research → plan → test cycle |
| Continuous exploration | `npx explorbot freesail [url]` | `/freesail` | Explore page after page until stopped |
| Research a page | `npx explorbot research <url>` | `/research [url]` | UI analysis only |
| Generate test plan | `npx explorbot plan <path>` | `/plan [--focus <feature>]` | Writes plan markdown |
| List saved plans | `npx explorbot plans [plan]` | `/plans [plan]` | Show plans and their tests |
| Navigate to a URL | `npx explorbot navigate <url>` | `/navigate <target>` | Reachability probe + session capture |
| Drill page components | `npx explorbot drill <url>` | `/drill [--knowledge <path>] [--max-components <n>]` | Learn interactions |
| Execute plan tests | `npx explorbot test <planfile> [index]` | `/test [scenario\|number\|*]` | Run scenarios |
| Re-run generated tests | `npx explorbot rerun <file> [index]` | `/rerun <file> [index]` | With AI auto-healing |
| List generated tests | `npx explorbot runs [file]` | `/runs [file]` | Index + dry-run |
| Store domain knowledge | `npx explorbot learn [url] [note]` | `/learn [note]` | Persisted to `knowledge/` |
| Show stored knowledge | `npx explorbot knows [url]` | `/knows [url]` | List all or match a URL |
| List stored experience | `npx explorbot experience [filter]` | `/experience [filter]` | Grouped by URL |
| Compact experience files | `npx explorbot compact [target]` | `/compact [target]` | AI compression |
| Print page context | `npx explorbot context <url>` | `/context` | Knowledge, experience, elements |
| Execute CodeceptJS command | `npx explorbot shell <url> <command>` | `I.click(...)` etc. inline | One-shot vs interactive |
| Load saved plan | `npx explorbot plan:load <file> [index]` | `/plan:load <file>` | Preview a plan |
| Collect documentation | `npx explorbot docs collect <path-or-url>` | — | See [doc-collector](../doc-collection/basics.md) |
| Drive an already-open browser | `npx explorbot prima <command>` | — | One command per process, see [Prima boat](#prima-boat) |
| Extract built-in rules | `npx explorbot extract-rules <agent>` | — | Customizable rules to `rules/` |
| Create a rule file | `npx explorbot add-rule [agent] [name]` | `/add-rule [agent] [name]` | Writes `rules/<agent>/<name>.md` |
| Manage persistent browser | `npx explorbot browser {start\|stop\|status}` | — | Share browser across runs |
| Initialize project | `npx explorbot init` | — | Generates `explorbot.config.*`, or `~/.explorbot` with `--global` |
| List registered sites | `npx explorbot sites` | — | Sites stored in the global installation |
| Clean generated files | `npx explorbot clean [target]` | `/clean [target]` | Same targets both ways |

## Common CLI Options

Every CLI command that drives a browser accepts these options (`start`, `explore`, `freesail`, `plan`, `navigate`, `drill`, `research`, `test`, `rerun`, `shell`, `docs collect`):

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Enable verbose logging |
| `--debug` | Enable debug logging (same as `--verbose`) |
| `-c, --config <path>` | Path to configuration file |
| `-p, --path <path>` | Working directory path |
| `-s, --show` | Show browser window |
| `--headless` | Run browser in headless mode |
| `--incognito` | Run without recording experiences |
| `--session [file]` | Save/restore browser session (cookies, localStorage) from file |

### `--session`

Saves browser state (cookies, localStorage, sessionStorage) to a JSON file. The next run restores the session, so you skip login and setup steps.

```bash
npx explorbot start /login --session                # default output/session.json
npx explorbot start /dashboard --session auth.json  # custom session file
npx explorbot navigate /login --session             # probe + capture auth in one shot
npx explorbot research /dashboard --session auth.json   # reuse captured auth
```

Without a file path, the flag defaults to `session.json` inside the resolved configuration's output directory. In config-free mode that is the site folder `~/.explorbot/sites/<host>/output/`, or whatever `EXPLORBOT_OUTPUT` points at.

## Environment Variables

Every command accepts `EXPLORBOT_*` variables in place of a config file. Set `EXPLORBOT_AI_PROVIDER` and Explorbot builds its configuration from the environment when no `explorbot.config.*` is found:

```bash
EXPLORBOT_URL=https://app.example.com \
EXPLORBOT_AI_PROVIDER=openrouter \
  npx explorbot explore /login --max-tests 3
```

<!-- START env -->
| Variable | Meaning |
|---|---|
| `EXPLORBOT_AI_PROVIDER` | Provider name; fills every model role from its recommended models. Turns on config-free mode |
| `EXPLORBOT_AI_MODEL` | Pins the main model — a model id for the provider, or a standalone provider/model-id |
| `EXPLORBOT_URL` | Base URL to test; the API boat reads it as the base endpoint |
| `EXPLORBOT_VISION_MODEL` | Screenshot analysis; overrides the provider recommendation |
| `EXPLORBOT_AGENTIC_MODEL` | Captain and Pilot decisions; overrides the provider recommendation |
| `EXPLORBOT_OUTPUT` | Output root for states, plans, research, and reports. Defaults to the site dir under ~/.explorbot/sites |
| `EXPLORBOT_EPHEMERAL` | Keep no state between runs — output goes to a fresh temp directory instead of the site dir |
| `EXPLORBOT_KNOWLEDGE` | Inline knowledge text, applied to every page |
| `EXPLORBOT_KNOWLEDGE_FILE` | Path to a knowledge markdown file |
| `EXPLORBOT_API_SPEC` | OpenAPI spec path for the API boat |
| `EXPLORBOT_NO_BANNER` | Suppress the startup banner, for machine-readable output |
<!-- END env -->

Explorbot resolves its configuration in this order: the path given to `--config`, then `explorbot.config.*` in the working directory, then the `EXPLORBOT_*` variables, and finally `~/.explorbot/config.*` from the global installation. A bare provider name fills every model role from the recommendations in [Providers](../basics/providers.md); a `provider/model-id` spec pins one model and splits on the first slash, so `openrouter/openai/gpt-oss-120b:nitro` selects OpenRouter with model `openai/gpt-oss-120b:nitro`. Supported providers: `openai`, `anthropic`, `google`, `groq`, `mistral`, `openrouter`, `sambanova`.

In this mode output goes to `~/.explorbot/sites/<host>/output/` (or `EXPLORBOT_OUTPUT`, or a temp directory with `EXPLORBOT_EPHEMERAL=1`), experience is kept beside it unless the run is ephemeral, and the Historian is off, so no generated test files appear. See [Agentic Usage](../workflow/agentic-usage.md) for the full picture.

## Persistent Browser

By default, every CLI command that needs a browser (`start`, `explore`, `plan`, `navigate`, `drill`, `research`, `context`) starts a fresh Chromium process and shuts it down when done. That is slow when you restart explorbot often during development.

Run `npx explorbot browser` to keep a browser server alive across sessions. Commands that need a browser detect the running server and connect to it instead of starting a new one.

### `npx explorbot browser start`

Start a persistent browser server. The process runs until you press Ctrl+C.

```bash
npx explorbot browser start            # headless (default)
npx explorbot browser start --show     # headed — see the browser window
npx explorbot browser start --headless # explicitly headless
```

The WebSocket endpoint is written to `output/.browser-endpoint` so other commands can find it.

### `npx explorbot browser stop`

Stop a running browser server and delete the endpoint file.

```bash
npx explorbot browser stop
```

### `npx explorbot browser status`

Check whether a persistent browser server is running.

```bash
npx explorbot browser status
```

### Workflow

```bash
# Terminal 1: start persistent browser
npx explorbot browser start --show

# Terminal 2: run commands — they reuse the same browser
npx explorbot navigate /login --session
npx explorbot research /login
npx explorbot plan /login --focus authentication
npx explorbot start /dashboard

# Each command connects to the running browser instead of launching a new one.
# When explorbot exits, the browser stays open for the next run.

# When done, stop the browser
npx explorbot browser stop
```

| Option | Description |
|--------|-------------|
| `-s, --show` | Launch browser in headed mode (visible window) |
| `--headless` | Launch browser in headless mode |
| `-c, --config <path>` | Path to configuration file |
| `-p, --path <path>` | Working directory path |

## Navigation

### navigate

Drive the AI Navigator to a URL. The Navigator handles redirects, login walls, and recoverable errors. It does more than call `I.amOnPage`.

```bash
# CLI — exits 0 if reachable, 1 otherwise
npx explorbot navigate /settings
npx explorbot navigate /login --session             # capture session into output/session.json
npx explorbot navigate /dashboard --session auth.json
```

```
# TUI
/navigate /settings
/navigate login page
/navigate back to dashboard
```

**CLI exit code:** `0` when the Navigator confirms it reached the page, `1` when navigation failed (unreachable URL, unresolved redirect, connection refused, and so on).

**Session capture:** combine with `--session` to capture an authenticated session for downstream agents. A typical CI pattern:

```bash
# 1. Establish authenticated session, fail fast if the app is down
npx explorbot navigate /login --session ./auth.json || exit 1

# 2. Reuse the captured session in subsequent commands
npx explorbot research /dashboard --session ./auth.json
npx explorbot explore /reports --session ./auth.json --max-tests 10
```

The TUI form accepts looser targets, such as state descriptions like "back to dashboard". The CLI form expects a URL or path.

## Exploration

### explore

Run a full exploration cycle: research → plan → test.

```bash
# CLI
npx explorbot explore /dashboard
npx explorbot explore /checkout --max-tests 10 --focus checkout
```

```
# TUI
/explore
/explore checkout
```

The CLI form navigates to `<path>` first. The TUI form always runs on the current page — positional arguments become the focus feature (same as `--focus`), not a URL. When the cycle finishes in the TUI, run `/navigate` or `/explore` again to continue.

#### Options

| Option | Description |
|---|---|
| `--max-tests <n>` | Hard cap on tests executed in this run. Sub-page expansion stops once the cap is hit. |
| `--focus <feature>` | Narrow planning to a single feature area (e.g. `--focus checkout`). The focus also becomes part of the saved plan filename. |
| `--configure <spec>` | Reuse a saved plan, mix old + new tests, filter by style/priority, control sub-page behavior. See below. |
| `--dry-run` | Mark every picked test as `skipped` instead of executing. New-test planning still runs (so you can preview what would be picked) but no AI tester actions and no plan-file writes. |

#### `--configure <spec>` — reuse, ratio, filters

Pass one string of pairs separated by `;`. Write each pair as `key:value` or `key=value`. Whitespace is allowed.

| Key | Values | Default | Effect |
|---|---|---|---|
| `new` | `0%`–`100%` (or `0`–`1.0`) | `100%` | Share of `--max-tests` reserved for newly planned tests. The remainder is filled from old tests. **Setting `new` < 100% enables reuse.** |
| `from` | path to a plan `.md` file | auto-lookup | Explicit plan source. **Also enables reuse.** When omitted, looks for `output/plans/<auto-named>.md` matching the current URL + focus. |
| `style` | comma list (e.g. `normal,curious`) | all styles | Filters new generation to these planning styles AND filters old picks to tests tagged with one of these styles. (Old tests with no style metadata are kept either way.) |
| `priority` | comma list of `critical,important,high,normal,low` | all priorities | Filters BOTH old picks AND newly-planned tests to the listed priorities. Generated tests outside the list are dropped. |
| `pick_by` | `priority` \| `random` \| `index` | `priority` | Order in which old tests are picked (and executed). `priority`: critical → low. `random`: shuffled. `index`: file order. |
| `subpages` | `none` \| `same` \| `new` \| `both` | `both` | Sub-page behavior in reuse mode. `same`: re-plan only sub-pages already in the loaded plan. `new`: only discover sub-pages not in the plan. `both`: both. `none`: skip sub-page expansion. |

Reuse is off unless `--configure` sets `new` or `from`. Without them, `npx explorbot explore` plans fresh every time.

If you request reuse but the lookup file is missing, explorbot logs a warning and falls back to fresh planning.

#### Examples

**Re-run a saved plan as-is** (no AI generation, just the saved scenarios):

```bash
npx explorbot explore /checkout --max-tests 10 --configure="new:0%"
```

**Mix 75% old + 25% new** — top-priority old tests fill 7 slots, planner fills the remaining 3 with fresh ideas (deduped against the loaded plan):

```bash
npx explorbot explore /checkout --max-tests 10 --configure="new:25%"
```

**Random sample of high-priority old tests + half new:**

```bash
npx explorbot explore /dashboard --max-tests 8 \
  --configure="new:50%;priority=critical,high;pick_by=random"
```

**Preview without spending tester time** — see exactly which old + new tests would run, all marked `skipped`:

```bash
npx explorbot explore /dashboard --max-tests 10 --configure="new:25%" --dry-run
```

**Use a specific plan file from a previous branch:**

```bash
npx explorbot explore /reports \
  --configure="from=output/plans/reports_v2.md;new:0%"
```

**Skip sub-page expansion** — only the main page is replanned:

```bash
npx explorbot explore /admin --max-tests 5 --configure="new:25%;subpages=none"
```

**Filter to one planning style only** (no reuse — just narrows generation):

```bash
npx explorbot explore /admin --configure="style=curious"
```

**Reuse + restrict to chaos-style tests in the plan + pick a random batch:**

```bash
npx explorbot explore /admin --max-tests 6 \
  --configure="new:0%;style=psycho;pick_by=random"
```

#### How picking interacts with the budget

With `--max-tests N` and `new:R%`:

- `oldQuota = N − round(N × R)` — number of old tests selected from the loaded plan
- `newQuota = round(N × R)` — slots reserved for the planner

Selection order for old tests:

1. Drop old tests not matching `style=` (if set)
2. Drop old tests not matching `priority=` (if set)
3. Order the survivors by `pick_by` (`priority` is the default)
4. Take the first `oldQuota`; mark the rest `enabled = false` so they don't run

For new tests, the planner generates freely. The loaded plan is registered for scenario-level dedup, so the planner won't propose duplicates. Any test whose priority falls outside `priority=` is dropped before execution. Without `--max-tests`, both quotas are unbounded.

#### See also

- [Test Plans](../workflow/test-plans.md) — markdown format for saved plans
- [Planner](../web-testing/planner.md) — how new test scenarios are generated

### freesail

Explore continuously: run the explore cycle on a page, then let the agent pick the next page and repeat until stopped or `--max-tests` is reached.

```bash
# CLI
npx explorbot freesail                      # starts from /
npx explorbot freesail /dashboard --scope /app --max-tests 20
```

```
# TUI
/freesail
/freesail --deep
```

| Option | Description |
|---|---|
| `--deep` | Depth-first: prioritize newly discovered pages |
| `--shallow` | Breadth-first: pick the globally least-visited page |
| `--scope <prefix>` | Restrict navigation to URLs starting with this prefix |
| `--max-tests <n>` | Maximum number of tests to run |

### research

Analyze a page using the Researcher agent.

```bash
# CLI
npx explorbot research /settings
npx explorbot research /dashboard --data --deep
```

```
# TUI
/research
/research /settings
/research --data
```

With a URL, explorbot navigates there first.

| Option | Description |
|---|---|
| `--data` | Extract structured data from the page |
| `--deep` | Enable deep analysis (expand hidden elements) |
| `--no-fix` | Skip locator fix cycle (for debugging) |

### plan

Generate test scenarios using the Planner agent.

```bash
# CLI
npx explorbot plan /login
npx explorbot plan /login --focus authentication
npx explorbot plan /checkout --append --style curious
```

```
# TUI
/plan
/plan --focus login
/plan --focus "checkout flow"
```

The `--focus` flag narrows generated tests to one feature area.

| Option | Description |
|---|---|
| `-a, --append` | Add tests to existing plan file |
| `--style <name>` | Planning style: `normal`, `curious`, `psycho` |
| `--focus <feature>` | Focus area for test planning |

### test

Execute test scenarios using the Tester agent.

```bash
# CLI
npx explorbot test output/plans/login.md          # run all enabled tests
npx explorbot test output/plans/login.md 3        # run test #3
npx explorbot test output/plans/login.md 1-5      # range
npx explorbot test output/plans/login.md 1,3,7    # selection
npx explorbot test output/plans/login.md --grep authentication
npx explorbot test 3 --from-plan output/plans/login.md   # index first, plan via option
```

```
# TUI
/test              # Run next pending test
/test *            # Run all pending tests
/test 2            # Run test #2 from plan
/test login        # Run tests matching "login"
/test User can logout successfully   # Create and run ad-hoc test
```

| Option | Description |
|---|---|
| `--grep <pattern>` | Run only tests whose scenario matches the pattern |
| `--from-plan <file>` | Load this plan file when the first argument is a test index |

### drill

Drill all components on a page to learn interactions.

```bash
# CLI
npx explorbot drill /components
npx explorbot drill /components --max-components 10
npx explorbot drill /login --knowledge /login
```

```
# TUI
/drill
/drill --knowledge /login --max-components 10
```

| Option | Description |
|---|---|
| `--knowledge <path>` | Save learned interactions to a knowledge file at this URL path |
| `--max-components <count>` | Maximum number of components to drill |

## Test Rerun

### runs

List generated test files or dry-run a specific file to preview steps.

```bash
# CLI
npx explorbot runs
npx explorbot runs output/tests/suite.js
```

```
# TUI
/runs
/runs output/tests/suite.js
```

Each test is numbered, so you can reference it with `rerun`.

### rerun

Re-run generated tests with AI auto-healing. When a step fails, the Rerunner agent diagnoses the problem and runs a fix.

```bash
# CLI
npx explorbot rerun output/tests/suite.js
npx explorbot rerun output/tests/suite.js 3
npx explorbot rerun output/tests/suite.js 1-5
npx explorbot rerun output/tests/suite.js 1,3,7
npx explorbot rerun output/tests/suite.js --session
```

```
# TUI
/rerun output/tests/suite.js
/rerun output/tests/suite.js 3
/rerun output/tests/suite.js 1-5
/rerun output/tests/suite.js 1,3,7
```

Tests without assertions (`I.see`, `I.seeElement`, and so on) are skipped.

See [Rerunning Tests](../web-testing/rerun.md) for the full workflow and healing configuration.

## Knowledge Management

### knows

List all knowledge or show matching knowledge for a URL.

```bash
# CLI
npx explorbot knows
npx explorbot knows /login
```

```
# TUI
/knows
/knows /login
```

### learn

Store knowledge about the current page for future reference.

```bash
# CLI
npx explorbot learn                             # interactive mode
npx explorbot learn /login "Use admin credentials"
```

```
# TUI
/learn
/learn Test user credentials: test@example.com / test123
```

Without arguments, `learn` opens an interactive editor. Knowledge is saved to `./knowledge/` and used by agents during exploration.

## Experience Management

### experience

List stored experiences grouped by URL. Pass a URL substring to filter, or a section ref (like `A.1`) to expand one section.

```bash
# CLI
npx explorbot experience
npx explorbot experience /login
npx explorbot experience A.1
```

```
# TUI
/experience
/experience /login
```

| Option | Description |
|---|---|
| `--recent` | Only files modified within the last 30 days |
| `--old` | Only files modified more than 30 days ago |

### compact

Compress stored experience files with the ExperienceCompactor agent. Pass a filename or URL substring to limit scope.

```bash
# CLI
npx explorbot compact
npx explorbot compact /login
npx explorbot compact --dry-run
```

```
# TUI
/compact
```

| Option | Description |
|---|---|
| `--dry-run` | Preview without running AI or writing files |
| `--no-merge` | Skip the cross-URL merge step when compacting all |

## Documentation Collection (CLI only)

### `npx explorbot docs collect <path-or-url>`

Crawl pages and generate a documentation spec with `Purpose`, `User Can`, and `User Might` sections for each documented page.

```bash
npx explorbot docs collect /users/sign_in
npx explorbot docs collect /docs/openapi#tag/project-analytics-tags --max-pages 20
npx explorbot docs collect https://teleportal.ua/ua/serials/stb/kod --path explorbot-testing --show --session --max-pages 20
```

Output is written to:

- `output/docs/spec.md`
- `output/docs/pages/*.md`

Use `docbot.config.*` to set crawl scope, path filters, dynamic-page collapsing, and low-signal page skipping.

See [Documentation Collection](../doc-collection/basics.md) for full configuration, crawl modes, and examples.

### `npx explorbot docs init`

Create a starter `docbot.config.ts` file.

```bash
npx explorbot docs init
npx explorbot docs init --path explorbot-testing
```

## Prima boat

Prima drives a browser that is already open, one command per process. Every page command prints a plain-text envelope on stdout and exits `0` when the envelope says `ok: true`, `1` when it does not — so a coding agent can act on the result without parsing JSON. The `browser` commands print a status line instead.

Run it as `npx explorbot prima <command>` or through the standalone `prima` bin.

| Command | Purpose |
|---|---|
| `prima check <scenario>` | Run a scenario end to end as a test, verify it, and report the steps it took |
| `prima do <instructions...>` | Run high-level instructions tester-style, one argument per instruction |
| `prima pw <fn>` | Run a Playwright function expression against the open page |
| `prima ask <question>` | Answer a question about the current page |
| `prima verify <assertion>` | Assert a statement about the current page (alias: `assert`) |
| `prima research` | Map the current page and return verified locators |
| `prima go <target>` | Navigate to a url, a path, or a page described in plain words |
| `prima status <hash>` | Show the artifacts and page detail recorded for an earlier command |
| `prima report` | Turn every command of a session into one html and markdown report |
| `prima config` | Show the AI models prima runs on and the config file they come from |
| `prima browser {start\|stop\|status\|list}` | Manage the browsers prima drives |

### Choosing a command

Start at the top and come down only when the tier above cannot hold the work.

- **`check`** takes an outcome rather than a click path, works out how to reach it, verifies it itself, and reports every step with its proof.
- **`do`** takes several described instructions and runs them tester-style in one process.
- **`pw`** is precise: a function expression built from a locator you already verified. No AI on the happy path, so it also works when no model is configured.

Never pass a locator or a function expression to `check` or `do` — describe the target. Never pass a description to `pw` — it takes executable code only.

Pass `do` the whole remaining sequence rather than one instruction per call. Every command is a process of its own, so a sequence split across calls pays the startup and page-capture cost each time. `check` and `do` legitimately run for minutes.

### `check`, `do`, and `verify` in detail

`check` takes `--expected <outcome>`, repeatable for several; without it the scenario text is the single expected outcome. Each comes back under `### Expected outcomes` as `PASSED`, `FAILED` or `not verified` — "not verified" means the run never checked it, which is not the same as false. Page problems seen along the way appear under `### Answer` rather than as step failures.

```bash
prima check "signup rejects a duplicate email" \
  --expected "an error names the email as taken" \
  --expected "no second account is created"
```

`do` numbers every instruction and accounts for it: `### Steps` reports each as `ok` or `FAIL` with what proved it, and one that could not be carried out fails the command. Nothing runs past the last instruction given.

`verify` lists every assertion it could express as `PASSED` or `FAILED` with its Playwright form, and gives no overall verdict — read the lines and decide. `none ran` means the claim could not be expressed at all, which is not the same as false.

### The envelope

```
### Result
ok: true
command: pw ({ page }) => page.click('[data-test=submit]')
used: ({ page }) => page.click('[data-test=submit]')

### Page
url: /orders/4821                     (changed: /orders/new → /orders/4821)
title: Order 4821 - Widget Depot
state: orders_4821_h1_order_placed    (visit #1)

### Changes
ariaDiff:
  added:
    - heading "Order placed" [level=1]
  removed:
    - button "Submit"

### Instance
default (1 tab) | attached to playwright-cli session "default" | details: prima status 7f3a91

### Artifacts
aria: /home/you/.explorbot/sites/app.example.com/output/prima/2026-08-04T10-04-22-285Z/aria.yml
html: /home/you/.explorbot/sites/app.example.com/output/prima/2026-08-04T10-04-22-285Z/page.html
```

`used:` is code that already executed: for `go` the CodeceptJS step it ran, for `pw` the Playwright expression you passed, which a CodeceptJS test needs wrapped in `I.usePlaywrightTo(...)`. Log lines can precede the envelope, so start parsing at the first `###` line.

`### Changes` renders on every action envelope, saying `no change` when the tree is identical — so a successful command proves what it did instead of leaving you to check. `check` and `do` report per step rather than in aggregate: `### Steps` names each step with the code it ran and what proved it, and `page after each step:` points at the captures. `check` adds `### Expected outcomes`; `ask`, `research`, and `verify` add `### Answer`, `### Research`, or `### Assertions`; `pw` adds `### Value` when its expression returns one. `network:` appears under `### Artifacts` only when requests were captured, and everything else recorded for a command is behind `prima status <hash>`.

**A failed action is a failure.** Nothing is retried along a different route and no other element is substituted, so `ok: true` means the action you asked for is the one that landed. A failure adds `### Failure` with the error and the compact ARIA of the page, so you can retarget from the envelope itself instead of opening the artifact files.

### Browsers and sessions

Prima never launches a browser implicitly. Open one first:

```bash
playwright-cli open https://app.example.com   # the session prima attaches to by default
npx explorbot prima browser start             # a prima-owned browser instead
```

By default prima attaches to the playwright-cli browser of the current workspace and works on the tabs it already has open — driving the same session from both tools is the intended usage. Stopping prima disconnects from an attached browser; it never closes it. `prima browser list` shows both kinds of browser, and the `### Instance` block names the one you are on.

Prima reaches every browser over a Playwright browser-server endpoint — a playwright-cli session, an `--endpoint`, or a `prima browser start` instance — and that client needs the Node build, which is what `npx explorbot prima` and the published `prima` bin run on. Driving a browser by running the CLI from source under Bun does not connect.

Every command takes these:

| Option | Description |
|---|---|
| `--pw-session <title>` | Which playwright-cli session, when several are open for the workspace |
| `--endpoint <ep>` | Attach to a browser server endpoint directly, skipping discovery |
| `-i, --instance <name>` | Which prima-owned browser to talk to; parallel work needs one each |
| `--session [file]` | Cookies and storage persisted across processes; ignored while attached, since the attached session keeps its own |
| `--url <url>` | Page to open when the session has no page yet |
| `--ephemeral` | Keep no state between runs. Applies to config-free runs only — with a config file the output directory comes from the config |
| `--framework <name>` | Parsed but not active yet; reported code is CodeceptJS whatever you pass |
| `-c, --config <path>`, `-p, --path <path>` | As on every other Explorbot command |

`--instance` and `--session` answer different questions: `--instance` picks *which browser process* prima drives, `--session` decides *whose cookies* it starts from.

A few commands add their own:

| Command | Option | Description |
|---|---|---|
| `check` | `--expected <outcome>` | An outcome the run must reach; repeat the flag for several |
| `ask` | `--no-vision` | Answer from page structure only, without a screenshot |
| `research` | `--data` | Include data extraction in the map |
| `research` | `--deep` | Expand hidden elements for a deeper map |
| `research` | `--fresh` | Ignore the cached map and research the page again |
| `browser start` | `-s, --show` / `--headless` | Launch the browser with or without a window |
| `browser stop` | `--all` | Stop every running instance |

Prima carries no logging flags of its own. `DEBUG` in front of a command prints everything the run does — config and browser attachment, every step as it executes, and the debug stream of the agents behind it:

```bash
DEBUG='explorbot:*' prima do "open the account menu" "switch the theme to dark"
```

Without it, a running command writes its current activity to stderr as a single line that each new activity overwrites, erased before the envelope is printed. Piped or captured output is unaffected.

### Session reports

Every command is logged to `output/prima/sessions/` as it runs, so `prima report` needs no browser and outlives the session:

```bash
prima report                      # the session used most recently
prima report --pw-session my-app  # a named playwright-cli session
```

It writes one html and one markdown report — each command with its steps, expected outcomes and the proof recorded for them. The log is written in the format the Testomat.io reporter replays, so the same file can be sent as a run:

```bash
TESTOMATIO=<apiKey> npx @testomatio/reporter replay <the path prima report prints>
```

### Without a config file

Prima follows the same [configuration ladder](#environment-variables) as every other command, so a provider name in the environment is enough:

```bash
EXPLORBOT_AI_PROVIDER=groq npx explorbot prima go https://app.example.com
```

`pw` still works when no model is usable at all; commands that need one say so and point at the fallback.

## Plan Management

### plans

List saved plans, or show the tests of one plan.

```bash
# CLI
npx explorbot plans
npx explorbot plans output/plans/checkout.md
```

```
# TUI
/plans
/plans checkout
```

### `/plan:save [filename]`

Save the current plan to a file.

```
/plan:save
/plan:save my-checkout-tests
```

Plans are saved to the `output/plans/` directory.

### `/plan:load <filename>`

Load a previously saved plan.

```
/plan:load output/plans/checkout-plan.md
```

The CLI form `npx explorbot plan:load <file> [index]` previews a plan file from the shell. Pass an index to see details for one test.

### `/plan:reload [feature]`

Clear the current plan and regenerate it with the Planner. Pass a feature to change the focus; otherwise the previous focus is reused.

## Page Inspection (TUI)

### `/context:aria`

Print the full ARIA accessibility snapshot of the current page.

```
/context:aria
```

Use it to debug element selectors and read the page structure.

### `/context:html`

Print the combined HTML snapshot of the current page.

```
/context:html
```

Captures fresh page content when the stored snapshot is empty.

### `/context:data`

Extract structured data (tables, lists) from the current page.

```
/context:data
```

AI finds and formats data on the page.

### `/context`, `/context:knowledge`, `/context:experience`

Print the agent-facing context for the current page: combined snapshot, applicable knowledge, or stored experience.

The CLI counterpart is `npx explorbot context <url>` — see [below](#npx-explorbot-context-url).

## Session Commands (TUI)

### `/clean [target]`

Delete generated files from disk — same targets as the CLI `clean` command below.

```
/clean
/clean plans
```

Without a target, it cleans output artifacts and experience files.

### `/exit`

Exit the application gracefully.

```
/exit
/quit
```

## Other CLI Commands

### `npx explorbot init`

Initialize configuration. In an interactive terminal, plain `init` first asks where it should go: **Local** writes `explorbot.config.js` in the current directory, **Global** sets up `~/.explorbot` so explorbot runs from anywhere. The Global option is disabled once a global config exists — reinstall with `--global --force`.

```bash
npx explorbot init
npx explorbot init --config-path ./explorbot.config.js
npx explorbot init --force
```

Passing `--config-path` or `--path` means local, and so does running outside a terminal (agents, CI): the chooser is skipped and the project config is written as before.

`--global` runs the global wizard instead — pick a provider, paste the API key, optionally check it with one test AI call. The wizard writes `~/.explorbot/config.js` with the recommended model ids of this Explorbot version and stores the key in `~/.explorbot/.env`.

```bash
npx explorbot init --global
npx explorbot init --global --provider openrouter --api-key sk-...   # no wizard
npx explorbot init --global --force                                  # reinstall
```

The global config holds models and keys, never a site: every command names the site it runs against.

| Option | Description |
|--------|-------------|
| `-c, --config-path <path>` | Path for the project config file |
| `-f, --force` | Overwrite an existing config file |
| `-p, --path <path>` | Working directory for initialization |
| `-g, --global` | Configure `~/.explorbot` to run from anywhere |
| `--provider <name>` | AI provider for the global config, skips the wizard |
| `--api-key <key>` | API key stored in `~/.explorbot/.env` |

See [Configuration](configuration.md#running-from-anywhere-the-global-installation) for the directory layout and how a site is resolved.

### `npx explorbot sites`

List the sites registered in the global installation — folder name, base URL, and last run. Sites register themselves the first time you explore them by URL.

```bash
npx explorbot sites
```

### `npx explorbot clean [target]`

Clean generated files. Targets: `states`, `research`, `plans`, `tests`, `experiences`, `output`.

```bash
npx explorbot clean                  # output artifacts + experience files
npx explorbot clean experiences      # only experience files
npx explorbot clean plans            # only test plans
```

Without a target, cleans everything under `output/` plus the `experience/` directory.

### `npx explorbot shell <url> <command>`

Run a single CodeceptJS command on a page and exit. Use it for quick checks from a script.

```bash
npx explorbot shell /login "I.see('Sign in')"
```

### `npx explorbot context <url>`

Print page context (URL, headings, knowledge, experience, interactive elements) for a URL and exit. It does not take the common browser flags — its options are:

```bash
npx explorbot context /dashboard
npx explorbot context /dashboard --full --session auth.json
```

| Option | Description |
|--------|-------------|
| `-p, --path <path>` | Working directory path |
| `-c, --config <path>` | Path to configuration file |
| `--session [file]` | Save/restore browser session from file |
| `--full` | Include HTML and all data |
| `--compact` | Compact view with summaries |
| `--attached` | Only auto-attached sections (default) |
| `--visual` | Annotate elements on screenshot and print screenshot path |
| `--screenshot` | Alias for `--visual` |

### `npx explorbot extract-rules <agent>`

Extract an agent's built-in rules (including planning styles) to your `rules/` directory so you can customize them. Planning styles live under the `styles/` subdirectory and extract with the rest of the agent's rules.

```bash
npx explorbot extract-rules planner        # extracts to rules/planner/ (incl. styles/)
npx explorbot extract-rules chief          # extracts to rules/chief/
npx explorbot extract-rules planner -d ./my-rules  # custom directory
```

After extraction, edit the markdown files to change how the agent behaves. See [Configuration: Rules](./configuration.md#rules) for details.

### `npx explorbot add-rule [agent] [name]`

Create a rule file for an agent under `rules/<agent>/`. Without arguments, opens an interactive form. Also available in the TUI as `/add-rule [agent] [name]`.

```bash
npx explorbot add-rule                                  # interactive
npx explorbot add-rule tester wait-for-toasts
npx explorbot add-rule tester admin-creds --url "/admin/*"
```

| Option | Description |
|--------|-------------|
| `--url <pattern>` | URL pattern for this rule |

## Direct Browser Control (TUI)

Besides slash commands, you can run CodeceptJS commands directly in the TUI:

```
I.amOnPage('/login')
I.click('Submit')
I.fillField('email', 'test@example.com')
I.see('Welcome')
I.waitForElement('.modal', 5)
```

All [CodeceptJS Playwright helpers](https://codecept.io/helpers/Playwright/) are available. For a one-shot equivalent from the shell, use `npx explorbot shell <url> <command>`.

## Keyboard Shortcuts (TUI)

| Key | Action |
|-----|--------|
| `ESC` | Enable input / cancel current action |
| `Ctrl+T` | Toggle session timer display |
| `Ctrl+C` | Exit application |
