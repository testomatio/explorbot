# Rerunning Tests

After exploration sessions, Explorbot generates CodeceptJS test files in `output/tests/`. The `runs` and `rerun` commands let you list, inspect, and re-execute these tests with AI-powered healing.

## Workflow

```
explorbot explore /dashboard          # generates output/tests/dashboard.js
explorbot runs                        # list all generated tests with indices
explorbot runs output/tests/dashboard.js   # preview steps (dry-run)
explorbot rerun output/tests/dashboard.js --session   # run with healing
explorbot rerun output/tests/dashboard.js 3 --session # run test #3 only
```

## Listing Tests

```bash
explorbot runs
```

Shows all generated test files with numbered scenarios:

```
Dashboard Testing
output/tests/dashboard_testing.js
  1. ❯ Create a new item
  2. ─ Delete an item (skipped)
  3. ❯ Edit item title
```

Active tests show `❯`, skipped tests show `─`.

### Dry-Run a File

```bash
explorbot runs output/tests/dashboard_testing.js
```

Shows the actual CodeceptJS steps each test executes (including `Before` hooks) without launching a browser. Useful for understanding what a test does before running it.

## Re-running Tests

```bash
explorbot rerun <file> [index] [--session]
```

Executes tests through CodeceptJS with the Rerunner agent providing AI-powered healing when steps fail.

### Index Selection

| Syntax | Meaning |
|--------|---------|
| _(no index)_ | Run all tests in the file |
| `3` | Run test #3 only |
| `1-5` | Run tests 1 through 5 |
| `1,3,7` | Run specific tests |

Indices match the numbers shown by `explorbot runs`.

### What Gets Skipped

- **Scenario.skip / Scenario.todo** — already marked as skipped in the test file
- **Tests without assertions** — tests that don't contain `I.see`, `I.seeElement`, `I.dontSee`, etc. are automatically skipped since their results can't be verified

## AI Healing

When a test step fails, the Rerunner agent diagnoses the issue and attempts to fix it using the same tools as the Tester agent (click, form, pressKey, xpathCheck, see, research, bash).

### How It Works

1. A step like `I.click("Save", ".modal")` fails
2. The healer receives the current page state (URL, ARIA tree) and trace data
3. It diagnoses: wrong page? loading? broken locator? missing data?
4. It executes a replacement action (e.g., waits for page to load, then clicks with a corrected locator)
5. If successful, the test continues; if not, it fails and moves to the next test

### Healing Output

During healing, you see the agent's actions as substeps:

```
  ❯ Create a new test
    I.amOnPage("/projects/testcaselabs/")
    I.click("Test", ".sticky-header .first")
    → Healing: I.click("Test", ".sticky-header .first")
   > ✔ Detected loading spinner, waiting
   > ✔ Click Test button in toolbar
    ✔ Healed: I.click({"role":"button","text":"Test"})
```

### Healing Configuration

Configure the Rerunner agent in `explorbot.config.js`:

```javascript
export default {
  ai: {
    agents: {
      rerunner: {
        healLimit: 3,           // max heals per test (default: 3)
        healMaxIterations: 10,  // max AI loop iterations per heal (default: 10)
        recipes: {
          // Custom healing recipes (CodeceptJS heal API)
          waitForLoader: {
            steps: ['amOnPage'],
            fn: async () => {
              return async ({ I }) => {
                await I.waitForInvisible('.loader', 20);
              };
            },
          },
        },
      },
    },
  },
};
```

### Custom Rules

Healing prompt rules live in `rules/rerunner/` as markdown files:

| File | Purpose |
|------|---------|
| `healing-role.md` | Agent role description |
| `healing-approach.md` | Step-by-step diagnosis strategy |
| `healing-tools.md` | Available tools and when to use each |

Override any rule by placing a same-named `.md` file in your project's `rules/rerunner/` directory.

## Trace Output

Each rerun creates a trace directory under `output/states/rerun_<timestamp>/` containing per-test artifacts:

- `trace.md` — test execution timeline with links to all artifacts
- `*_aria.txt` — ARIA accessibility snapshot per step
- `*_page.html` — full HTML per step
- `*_screenshot.png` — screenshot per step
- `*_console.json` — browser console logs per step

The healer reads these files to diagnose failures.

## After Exploration

After running `/explore` or `explorbot explore`, Explorbot shows generated test files with rerun suggestions:

```
Generated: test_management.js
List tests: explorbot runs
Re-run with healing: explorbot rerun <filename> [index]
```
