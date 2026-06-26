# Rerunning Tests

Explorbot generates CodeceptJS test files in `output/tests/` after an exploration session. Use the `runs` and `rerun` commands to list, inspect, and re-execute these tests with AI healing.

## Workflow

```
npx explorbot explore /dashboard          # generates output/tests/dashboard.js
npx explorbot runs                        # list all generated tests with indices
npx explorbot runs output/tests/dashboard.js   # preview steps (dry-run)
npx explorbot rerun output/tests/dashboard.js --session   # run with healing
npx explorbot rerun output/tests/dashboard.js 3 --session # run test #3 only
```

## Listing tests

```bash
npx explorbot runs
```

Lists all generated test files with numbered scenarios:

```
Dashboard Testing
output/tests/dashboard_testing.js
  1. ❯ Create a new item
  2. ─ Delete an item (skipped)
  3. ❯ Edit item title
```

Active tests show `❯`, skipped tests show `─`.

### Dry-run a file

```bash
npx explorbot runs output/tests/dashboard_testing.js
```

Prints the CodeceptJS steps each test runs, including `Before` hooks, without launching a browser. Use it to check what a test does before running it.

## Re-running tests

```bash
npx explorbot rerun <file> [index] [--session]
```

Runs tests through CodeceptJS. The Rerunner agent heals steps that fail.

### Index selection

| Syntax | Meaning |
|--------|---------|
| _(no index)_ | Run all tests in the file |
| `3` | Run test #3 only |
| `1-5` | Run tests 1 through 5 |
| `1,3,7` | Run specific tests |

Indices match the numbers shown by `npx explorbot runs`.

### What gets skipped

- **Scenario.skip / Scenario.todo** — already marked as skipped in the test file.
- **Tests without assertions** — tests with no `I.see`, `I.seeElement`, `I.dontSee`, or similar are skipped, because their results can't be verified.

## AI healing

When a step fails, the Rerunner agent diagnoses the problem and tries to fix it. It uses the same tools as the Tester agent: click, form, pressKey, xpathCheck, see, research, and bash.

### How it works

1. A step like `I.click("Save", ".modal")` fails.
2. The healer receives the current page state (URL, ARIA tree) and trace data.
3. It diagnoses the cause: wrong page, loading, broken locator, or missing data.
4. It runs a replacement action, for example waiting for the page to load and then clicking with a corrected locator.
5. On success, the test continues. On failure, it moves to the next test.

### Healing output

During healing, the agent's actions show as substeps:

```
  ❯ Create a new test
    I.amOnPage("/projects/testcaselabs/")
    I.click("Test", ".sticky-header .first")
    → Healing: I.click("Test", ".sticky-header .first")
   > ✔ Detected loading spinner, waiting
   > ✔ Click Test button in toolbar
    ✔ Healed: I.click({"role":"button","text":"Test"})
```

### Healing configuration

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

### Custom rules

Healing prompt rules live in `rules/rerunner/` as markdown files:

| File | Purpose |
|------|---------|
| `healing-role.md` | Agent role description |
| `healing-approach.md` | Step-by-step diagnosis strategy |
| `healing-tools.md` | Available tools and when to use each |

To override a rule, place a file with the same name in your project's `rules/rerunner/` directory.

## Trace output

Each rerun creates a trace directory under `output/states/rerun_<timestamp>/` with per-test artifacts:

- `trace.md` — execution timeline with links to all artifacts
- `*_aria.txt` — ARIA snapshot per step
- `*_page.html` — full HTML per step
- `*_screenshot.png` — screenshot per step
- `*_console.json` — browser console logs per step

The healer reads these files to diagnose failures.

## After exploration

After `/explore` or `npx explorbot explore`, Explorbot shows the generated test files with rerun suggestions:

```
Generated: test_management.js
List tests: npx explorbot runs
Re-run with healing: npx explorbot rerun <filename> [index]
```
