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

### Healing boundaries

AI healing repairs how an existing step reaches the same intended outcome. It is deliberately not a second exploratory test run.

| Healing can | Healing does not |
|-------------|------------------|
| Replace a stale or ambiguous locator | Change the scenario's business intent |
| Wait for loading or dismiss a blocking transient UI | Turn a failed assertion into a pass |
| Restore expected navigation or repeat an equivalent interaction | Invent missing credentials, permissions, or test data |
| Adapt to a small UI structure change | Work around a real product defect or unavailable service |

The healer only has `healLimit` attempts per test and `healMaxIterations` AI iterations per failed step. It should stop when the expected element or state no longer exists, required data is missing, access is denied, or the application behavior contradicts the assertion. In those cases the test remains failed and the trace preserves the evidence for review.

Successful healing updates the generated test file with the replacement step. Review that diff before committing it: healing shows that an equivalent interaction worked now, not that every UI change is safe or intentional.

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
        healMaxIterations: 3,   // max AI loop iterations per heal (default: 3)
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
| `healing-approach.md` | Step-by-step diagnosis strategy |

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
