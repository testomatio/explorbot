# Terminal Commands Reference

## TUI and CLI Commands

Explorbot has two types of commands:

- **TUI commands** — slash commands available inside the terminal UI launched by `explorbot start`
- **CLI commands** — run directly from your shell without launching TUI

Some commands work in both modes. Where a CLI equivalent exists, it is noted below.

| TUI Command        | CLI Equivalent                            |
| ------------------ | ----------------------------------------- |
| `/explore [url]`   | `explorbot explore [path]`                |
| `/research [url]`  | `explorbot research <url>`                |
| `/plan [feature]`  | `explorbot plan <path> [feature]`         |
| `/drill`           | `explorbot drill <url>`                   |
| `/know [note]`     | `explorbot knows:add [url] [description]` |
| `/test [scenario]` | `explorbot test <planfile> [index]`       |
| `/freesail`        | `explorbot freesail [startUrl]`           |
| `/rules:add`       | `explorbot add-rule [agent] [name]`       |

CLI commands run headless by default, execute the task, and exit. TUI commands run inside an interactive session where you can chain multiple actions.

## Common Options

These options are available on all CLI commands (`start`, `explore`, `plan`, `drill`, `research`, `context`):

| Option                | Description                                                    |
| --------------------- | -------------------------------------------------------------- |
| `-v, --verbose`       | Enable verbose logging                                         |
| `--debug`             | Enable debug logging (same as `--verbose`)                     |
| `-c, --config <path>` | Path to configuration file                                     |
| `-p, --path <path>`   | Working directory path                                         |
| `-s, --show`          | Show browser window                                            |
| `--headless`          | Run browser in headless mode                                   |
| `--incognito`         | Run without recording experiences                              |
| `--session [file]`    | Save/restore browser session (cookies, localStorage) from file |

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
explorbot plan /login authentication
explorbot start /dashboard

# Each command connects to the running browser instead of launching a new one.
# When explorbot exits, the browser stays open for the next run.

# When done, stop the browser
explorbot browser stop
```

| Option                | Description                                    |
| --------------------- | ---------------------------------------------- |
| `-s, --show`          | Launch browser in headed mode (visible window) |
| `--headless`          | Launch browser in headless mode                |
| `-c, --config <path>` | Path to configuration file                     |
| `-p, --path <path>`   | Working directory path                         |

## Test Execution

### `explorbot test <planfile> [index]`

Run tests from a saved plan file without launching TUI.

```bash
explorbot test plan.md 1           # run first test
explorbot test plan.md 1-3         # run tests 1 to 3
explorbot test plan.md 1,3,5       # run specific tests
explorbot test plan.md *           # run all pending tests
explorbot test plan.md all         # same as *
```

| Option             | Description                |
| ------------------ | -------------------------- |
| `--grep <pattern>` | Run tests matching pattern |

### `explorbot shell <url> <command>`

Navigate to a URL, execute a single CodeceptJS command, and exit. Useful for quick one-off browser interactions.

```bash
explorbot shell /login "I.see('Welcome')"
explorbot shell /dashboard "I.click('Settings')"
```

## Autonomous Exploration

### `explorbot freesail [startUrl]`

Continuously explore and test pages autonomously. Explorbot navigates to new pages, researches them, runs tests, then moves on — indefinitely.

```bash
explorbot freesail /admin                   # start exploring from /admin
explorbot freesail /dashboard --deep        # depth-first: explore nearby pages first
explorbot freesail /app --shallow           # breadth-first: spread across many pages
explorbot freesail /app --scope /admin      # only explore pages under /admin
explorbot freesail /app --max-tests 20      # stop after 20 tests
```

| Option                | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `--deep`              | Depth-first: prioritize newly discovered pages close to the current URL |
| `--shallow`           | Breadth-first: pick the globally least-visited page next                |
| `--scope <prefix>`    | Restrict to URLs starting with the given prefix                         |
| `--max-tests <count>` | Stop after the specified number of tests                                |

## API Testing

### `explorbot api`

AI-powered API testing. Generate and run test plans for API endpoints.

```bash
explorbot api init                          # initialize API testing project
explorbot api plan /users                   # generate test plan for endpoint
explorbot api plan /users --style curious   # use a specific planning style
explorbot api test plan.md                  # run tests from plan
explorbot api test plan.md 1-3             # run specific tests
explorbot api know /users "CRUD endpoint"  # add API knowledge
```

## Rules Management

### `explorbot add-rule [agent] [name]`

Create a rule file for an agent. Opens an interactive TUI form when called without arguments.

```bash
explorbot add-rule researcher check-tooltips
explorbot add-rule tester wait-for-toasts --url '/admin/*'
explorbot add-rule                              # interactive mode
```

## Exploration Commands

### `/explore [url]`

Start full exploration cycle: research → plan → test.

```
/explore
/explore /dashboard
/explore --max-tests 5
```

If a URL is provided, navigates there first. After completion, use `/navigate` or `/explore` again to continue.

**CLI equivalent:** `explorbot explore [path]` — runs the full cycle and exits.

| Option                | Description                              |
| --------------------- | ---------------------------------------- |
| `--max-tests <count>` | Stop after the specified number of tests |

### `/research [url] [--data]`

Analyze the current page using the Researcher agent.

```
/research
/research /settings
/research --data
/research --no-fix        # skip locator validation/fix cycle
```

- If URL provided, navigates there first
- `--data` flag extracts structured data from the page
- `--no-fix` skips the locator validation and fix cycle

**CLI equivalent:** `explorbot research <url>` — researches the page and exits.

```bash
explorbot research /dashboard --no-fix    # skip locator fix
explorbot research /dashboard --incognito # without experience files
```

### `/plan [feature]`

Generate test scenarios for the current page using the Planner agent.

```
/plan
/plan login
/plan checkout flow
/plan --style curious           # use a specific planning style
/plan --clear                  # clear current plan and create new one
/plan --fresh                  # re-plan from scratch, discarding existing plan
```

Optional feature focus narrows the scope of generated tests.

**CLI equivalent:** `explorbot plan <path> [feature]` — generates a plan and exits.

Options:

| Option            | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `--style <style>` | Set planning style (`normal`, `curious`, `psycho`, or custom) |
| `-a, --append`    | Add tests to existing plan instead of replacing it            |
| `--clear`         | Clear the current plan and immediately create a new one       |
| `--fresh`         | Re-plan from scratch, discarding the existing plan            |
| `--max-tests <n>` | Limit the number of tests generated                           |

### `/context [url]`

Analyze the current page using the Context agent.

```
/context
/context /settings
/context --visual
```

- If URL provided, navigates there first
- `--visual` flag extracts visual information from the page

### `/test [scenario|number|*]`

Execute test scenarios using the Tester agent.

```
/test              # Run next pending test
/test *            # Run all pending tests
/test 2            # Run test #2 from plan (visible/enabled tests)
/test login        # Run tests matching "login"
/test User can logout successfully   # Create and run ad-hoc test
```

### `/freesail`

Start autonomous exploration from the current page inside TUI (alias: `/freeride`).

```
/freesail
/freesail --deep
/freesail --shallow
/freesail --scope /admin
/freesail --max-tests 10
/freesail --deep --max-tests 20
```

### `/debug`

Toggle debug output on/off during a session.

```
/debug
```

### `/navigate <target>`

Navigate to a URI or state using AI assistance.

```
/navigate /settings
/navigate login page
/navigate back to dashboard
```

The Navigator agent figures out how to reach the destination.

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

**CLI equivalent:** `explorbot plan:load <planfile> [index]` — display plan as table, or view test details by index.

```bash
explorbot plan:load plan.md            # show all tests in table
explorbot plan:load plan.md 3          # show details for test #3
```

### `/plan-edit`

Edit the test plan interactively in TUI — enable/disable tests, reorder.

```
/plan-edit
```

### Plan Editor

When in the plan editor (opened via `/plan-edit` or `Ctrl+E`):

| Key   | Action                                 |
| ----- | -------------------------------------- |
| `Del` | Remove the selected test from the plan |

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

### `/know [note]`

Store knowledge about the current page for future reference.

```
/know
/know Test user credentials: test@example.com / test123
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

### `/rules:add`

Create a rule file for an agent interactively from TUI (alias: `/add-rule`).

```
/add-rule researcher check-tooltips
/rules:add tester slow-forms
/rules:add                              # interactive mode
```

### `explorbot extract-styles <agent>`

Extract built-in planning styles to your `rules/` directory for customization.

```bash
explorbot extract-styles planner        # extracts to rules/planner/styles/
explorbot extract-styles chief          # extracts to rules/chief/styles/
explorbot extract-styles planner -d ./my-styles  # custom directory
```

After extraction, edit the markdown files to customize how the Planner or Chief generates test scenarios. See [Configuration: Rules](./configuration.md#rules) for details.

## Direct Browser Control

In addition to slash commands, you can execute CodeceptJS `I.*` commands or raw Playwright `page.*` commands directly:

```
I.amOnPage('/login')
I.click('Submit')
I.fillField('email', 'test@example.com')
I.see('Welcome')
I.waitForElement('.modal', 5)
```

```
page.click('.my-button')
page.fill('#email', 'test@example.com')
await page.locator('.item').count()
```

All [CodeceptJS Playwright helpers](https://codecept.io/helpers/Playwright/) are available, as well as the raw Playwright `page` object.

## Keyboard Shortcuts

| Key      | Action                               |
| -------- | ------------------------------------ |
| `ESC`    | Enable input / cancel current action |
| `Ctrl+T` | Toggle session timer display         |
| `Ctrl+C` | Exit application                     |
| `Ctrl+E` | Open plan editor                     |
