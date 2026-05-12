# Terminal Commands Reference

## TUI and CLI Commands

Explorbot has two types of commands:

- **TUI commands** — slash commands available inside the terminal UI launched by `explorbot start`
- **CLI commands** — run directly from your shell without launching TUI

Some commands work in both modes. Where a CLI equivalent exists, it is noted below.

| TUI Command | CLI Equivalent |
|-------------|---------------|
| `/explore [url]` | `explorbot explore [path]` |
| `/research [url]` | `explorbot research <url>` |
| `/plan [--focus <feature>]` | `explorbot plan <path> [--focus <feature>]` |
| `/drill` | `explorbot drill <url>` |
| `/learn [note]` | `explorbot learn [url] [description]` |
| `/runs [file]` | `explorbot runs [file]` |
| `/rerun <file> [index]` | `explorbot rerun <file> [index]` |

CLI commands run headless by default, execute the task, and exit. TUI commands run inside an interactive session where you can chain multiple actions.

## Common Options

These options are available on all CLI commands (`start`, `explore`, `plan`, `drill`, `research`, `context`, `docs collect`):

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

Persists browser state (cookies, localStorage, sessionStorage) to a JSON file. On next run, the session is restored automatically, skipping login or setup steps.

```bash
explorbot start /login --session                # uses default output/session.json
explorbot start /dashboard --session auth.json  # custom session file
```

When the flag is provided without a file path, defaults to `output/session.json`.

## Persistent Browser

By default, every CLI command that needs a browser (`start`, `explore`, `plan`, `drill`, `research`, `context`) launches a fresh Chromium process and shuts it down when done. This is slow during development when you restart explorbot frequently.

The `explorbot browser` command lets you run a persistent browser server that survives across explorbot sessions. Any CLI command that launches a browser will automatically detect the running server and connect to it instead of starting a new one.

### `explorbot browser start`

Launch a persistent browser server. The process stays alive until you press Ctrl+C.

```bash
explorbot browser start            # headless (default)
explorbot browser start --show     # headed — see the browser window
explorbot browser start --headless # explicitly headless
```

The WebSocket endpoint is written to `output/.browser-endpoint` so other commands can find it.

### `explorbot browser stop`

Stop a running browser server and clean up the endpoint file.

```bash
explorbot browser stop
```

### `explorbot browser status`

Check whether a persistent browser server is currently running.

```bash
explorbot browser status
```

### Workflow

```bash
# Terminal 1: start persistent browser
explorbot browser start --show

# Terminal 2: run commands — they reuse the same browser
explorbot research /login
explorbot plan /login --focus authentication
explorbot start /dashboard

# Each command connects to the running browser instead of launching a new one.
# When explorbot exits, the browser stays open for the next run.

# When done, stop the browser
explorbot browser stop
```

| Option | Description |
|--------|-------------|
| `-s, --show` | Launch browser in headed mode (visible window) |
| `--headless` | Launch browser in headless mode |
| `-c, --config <path>` | Path to configuration file |
| `-p, --path <path>` | Working directory path |

## Exploration Commands

### `/explore [url]`

Start full exploration cycle: research → plan → test.

```
/explore
/explore /dashboard
```

If a URL is provided, navigates there first. After completion, use `/navigate` or `/explore` again to continue.

**CLI equivalent:** `explorbot explore [path]` — runs the full cycle and exits.

#### Options

| Option | Description |
|---|---|
| `--max-tests <n>` | Hard cap on tests executed in this run. Sub-page expansion stops once the cap is hit. |
| `--focus <feature>` | Narrow planning to a single feature area (e.g. `--focus checkout`). The focus also becomes part of the saved plan filename. |
| `--configure <spec>` | Reuse a saved plan, mix old + new tests, filter by style/priority, control sub-page behavior. See below. |
| `--dry-run` | Mark every picked test as `skipped` instead of executing. New-test planning still runs (so you can preview what would be picked) but no AI tester actions and no plan-file writes. |

#### `--configure <spec>` — reuse, ratio, filters

Single-string config; pairs separated by `;`, each pair as `key:value` or `key=value`. Whitespace tolerated.

| Key | Values | Default | Effect |
|---|---|---|---|
| `new` | `0%`–`100%` (or `0`–`1.0`) | `100%` | Share of `--max-tests` reserved for newly planned tests. The remainder is filled from old tests. **Setting `new` < 100% enables reuse.** |
| `from` | path to a plan `.md` file | auto-lookup | Explicit plan source. **Also enables reuse.** When omitted, looks for `output/plans/<auto-named>.md` matching the current URL + focus. |
| `style` | comma list (e.g. `normal,curious`) | all styles | Filters new generation to these planning styles AND filters old picks to tests tagged with one of these styles. (Old tests with no style metadata are kept either way.) |
| `priority` | comma list of `critical,important,high,normal,low` | all priorities | Filters BOTH old picks AND newly-planned tests to the listed priorities. Generated tests outside the list are dropped. |
| `pick_by` | `priority` \| `random` \| `index` | `priority` | Order in which old tests are picked (and executed). `priority`: critical → low. `random`: shuffled. `index`: file order. |
| `subpages` | `none` \| `same` \| `new` \| `both` | `both` | Sub-page behavior in reuse mode. `same`: re-plan only sub-pages already in the loaded plan. `new`: only discover sub-pages not in the plan. `both`: both. `none`: skip sub-page expansion. |

If `--configure` is omitted (or none of `new`/`from` is present), reuse is **off** and `explorbot explore` runs as before — fresh planning every time.

If reuse is requested but the lookup file doesn't exist, a warning is logged and the run falls back to fresh planning.

#### Examples

**Re-run a saved plan as-is** (no AI generation, just the saved scenarios):

```bash
explorbot explore /checkout --max-tests 10 --configure="new:0%"
```

**Mix 75% old + 25% new** — top-priority old tests fill 7 slots, planner fills the remaining 3 with fresh ideas (deduped against the loaded plan):

```bash
explorbot explore /checkout --max-tests 10 --configure="new:25%"
```

**Random sample of high-priority old tests + half new:**

```bash
explorbot explore /dashboard --max-tests 8 \
  --configure="new:50%;priority=critical,high;pick_by=random"
```

**Preview without spending tester time** — see exactly which old + new tests would run, all marked `skipped`:

```bash
explorbot explore /dashboard --max-tests 10 --configure="new:25%" --dry-run
```

**Use a specific plan file from a previous branch:**

```bash
explorbot explore /reports \
  --configure="from=output/plans/reports_v2.md;new:0%"
```

**Skip sub-page expansion** — only the main page is replanned:

```bash
explorbot explore /admin --max-tests 5 --configure="new:25%;subpages=none"
```

**Filter to one planning style only** (no reuse — just narrows generation):

```bash
explorbot explore /admin --configure="style=curious"
```

**Reuse + restrict to chaos-style tests in the plan + pick a random batch:**

```bash
explorbot explore /admin --max-tests 6 \
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

For new tests, the planner generates freely (the loaded plan is registered for scenario-level dedup, so it won't propose duplicates), then any test whose priority falls outside `priority=` is dropped before execution. Without `--max-tests`, both quotas are unbounded.

#### See also

- [Test Plans](./test-plans.md) — markdown format for saved plans
- [Planner](./planner.md) — how new test scenarios are generated

### `/research [url] [--data]`

Analyze the current page using the Researcher agent.

```
/research
/research /settings
/research --data
```

- If URL provided, navigates there first
- `--data` flag extracts structured data from the page

**CLI equivalent:** `explorbot research <url>` — researches the page and exits.

### `/plan [--focus <feature>]`

Generate test scenarios for the current page using the Planner agent.

```
/plan
/plan --focus login
/plan --focus "checkout flow"
```

The `--focus` flag narrows the scope of generated tests to a specific feature area.

**CLI equivalent:** `explorbot plan <path> [--focus <feature>]` — generates a plan and exits.

### `/test [scenario|number|*]`

Execute test scenarios using the Tester agent.

```
/test              # Run next pending test
/test *            # Run all pending tests
/test 2            # Run test #2 from plan
/test login        # Run tests matching "login"
/test User can logout successfully   # Create and run ad-hoc test
```

### `/navigate <target>`

Navigate to a URI or state using AI assistance.

```
/navigate /settings
/navigate login page
/navigate back to dashboard
```

The Navigator agent figures out how to reach the destination.

## Documentation Collection

### `explorbot docs collect <path-or-url>`

Crawl pages and generate a documentation spec with `Purpose`, `User Can`, and `User Might` sections for each documented page.

```bash
explorbot docs collect /users/sign_in
explorbot docs collect /docs/openapi#tag/project-analytics-tags --max-pages 20
explorbot docs collect https://teleportal.ua/ua/serials/stb/kod --path explorbot-testing --show --session --max-pages 20
```

Output is written to:

- `output/docs/spec.md`
- `output/docs/pages/*.md`

Use `docbot.config.*` to control crawl scope, path filters, dynamic-page collapsing, and low-signal page skipping.

See [Documentation Collection](./doc-collector.md) for full configuration, crawl modes, and examples.

### `explorbot docs init`

Create a starter `docbot.config.ts` file.

```bash
explorbot docs init
explorbot docs init --path explorbot-testing
```

## Test Rerun

### `/runs [file]`

List generated test files or dry-run a specific file to preview steps.

```
/runs                                    # list all test files with indices
/runs output/tests/suite.js              # dry-run: show steps without executing
```

Each test is numbered so you can reference it with `/rerun`.

**CLI equivalent:** `explorbot runs [file]` — lists tests without starting a browser.

### `/rerun <file> [index]`

Re-run generated tests with AI-powered auto-healing. When a step fails, the Rerunner agent diagnoses the issue and executes a fix.

```
/rerun output/tests/suite.js             # run all tests in file
/rerun output/tests/suite.js 3           # run test #3 only
/rerun output/tests/suite.js 1-5         # run tests 1 through 5
/rerun output/tests/suite.js 1,3,7       # run specific tests
```

Tests without assertions (`I.see`, `I.seeElement`, etc.) are automatically skipped.

**CLI equivalent:** `explorbot rerun <file> [index]` — runs with healing and exits.

See [Rerunning Tests](./rerun.md) for the full workflow and healing configuration.

## Plan Management

### `/plan:save [filename]`

Save the current plan to a file.

```
/plan:save
/plan:save my-checkout-tests
```

Plans are saved to `output/plans/` directory.

### `/plan:load <filename>`

Load a previously saved plan.

```
/plan:load output/plans/checkout-plan.md
```

## Page Inspection

### `/aria [--short]`

Print the ARIA accessibility snapshot of the current page.

```
/aria
/aria --short
```

Useful for debugging element selectors and understanding page structure.

### `/html [--full]`

Print HTML snapshot of the current page.

```
/html
/html --full
```

- Default shows processed HTML
- `--full` shows complete text content

### `/data`

Extract structured data (tables, lists) from the current page.

```
/data
```

Uses AI to identify and format data on the page.

## Knowledge Management

### `/knows [url]`

List all knowledge or show matching knowledge for a URL.

```
/knows
/knows /login
```

### `/learn [note]`

Store knowledge about the current page for future reference.

```
/learn
/learn Test user credentials: test@example.com / test123
```

Without arguments, opens an interactive editor. Knowledge is saved to `./knowledge/` and used by agents during exploration.

## Session Commands

### `/clean`

Clear the Captain agent's conversation history.

```
/clean
```

Useful when the agent context becomes too large or confused.

### `/exit`

Exit the application gracefully.

```
/exit
/quit
```

## Rules & Styles

### `explorbot extract-rules <agent>`

Extract built-in rules (including planning styles) for an agent to your `rules/` directory for customization. Planning styles live under the `styles/` subdirectory and are extracted together with the rest of the agent's rules.

```bash
explorbot extract-rules planner        # extracts to rules/planner/ (incl. styles/)
explorbot extract-rules chief          # extracts to rules/chief/
explorbot extract-rules planner -d ./my-rules  # custom directory
```

After extraction, edit the markdown files to customize how the agent behaves. See [Configuration: Rules](./configuration.md#rules) for details.

## Direct Browser Control

In addition to slash commands, you can execute CodeceptJS commands directly:

```
I.amOnPage('/login')
I.click('Submit')
I.fillField('email', 'test@example.com')
I.see('Welcome')
I.waitForElement('.modal', 5)
```

All [CodeceptJS Playwright helpers](https://codecept.io/helpers/Playwright/) are available.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `ESC` | Enable input / cancel current action |
| `Ctrl+T` | Toggle session timer display |
| `Ctrl+C` | Exit application |
