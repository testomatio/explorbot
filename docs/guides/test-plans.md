# Test Plans

A test plan is a markdown file with a suite of scenarios for the Tester to run. The [Planner](./planner.md) generates plans, but the format is plain markdown. You can write plans by hand, edit generated ones, or check them into version control.

Explorbot saves plans to `output/plans/` by default. The same parser loads them whether they were generated or written by hand.

The format is a dialect of the [Testomat.io classical markdown format](https://docs.testomat.io/project/import-export/export-tests/classical-tests-markdown-format/). It adds a `### Prerequisite` block that tells Explorbot which page to open before each test.

## Format

```markdown
<!-- suite -->
# Plan Title

### Prerequisite

* URL: /relative-path

<!-- test
priority: critical
-->
# Scenario written as a user-facing sentence

## Steps
* First step in plain language
* Second step

## Expected
* First expected outcome
* Second expected outcome
```

One file can hold several suites. Each begins with its own `<!-- suite -->` marker and parses as an independent plan.

## Elements

### `<!-- suite -->`

Marks the start of a plan. The `#` heading on the next line becomes the plan's title. This follows the Testomat.io convention of HTML-comment metadata blocks.

### `### Prerequisite`

Holds the suite-level URL as a single bullet:

```
* URL: /relative-path
```

The URL is required. Without it, the suite's tests do not run. Make it relative to the configured base URL (start with `/`), so the same plan runs against staging, production, or a local dev server without edits.

Every test in the suite uses this URL as its start page. Explorbot navigates to it before each scenario.

### `<!-- test priority: … -->`

Opens a test block. Valid priorities: `critical`, `important`, `high`, `normal`, `low`. Omit it and the priority defaults to `normal`. See [Test Priorities](./planner.md#test-priorities) for what each level means.

### `#` Scenario heading

A single `#` heading inside a test block is the scenario description. Write it as a business outcome, not a click path.

### `## Steps`

A bulleted list (`* `) of planned actions in plain language. The Tester treats these as guidance, not a strict script, and may adapt them to what it sees on the page. To span a step across lines, indent continuation lines with 2 spaces.

The Testomat.io classical format inlines `*Expected*:` inside each step. Explorbot splits actions and outcomes into separate `## Steps` and `## Expected` sections.

### `## Expected`

A bulleted list (`* `) of expected outcomes. Each outcome should describe a verifiable change: a data change, a state change, or a UI change with a side effect. See the Planner's [outcome-strength guidance](./planner.md#built-in-styles) for what counts.

The Tester passes a test only when it has verified every expected outcome.

## Reusing saved plans

Saved plans are reusable. Run `npx explorbot explore --configure="new:25%"` to load the matching plan, re-run a subset of its tests, and let the planner generate a few new ones to fill the budget. Filter old picks by priority or style, and order them by priority, file index, or random shuffle. See the [`--configure` reference in commands.md](./commands.md#explore-url) for the full key list and examples.

## See Also

- [Automated Tests](./automated-tests.md) — the runnable Playwright or CodeceptJS files Explorbot writes after executing a plan
- [Planner](./planner.md) — how plans are generated
- [Commands](./commands.md) — `/plan`, `/explore`, `npx explorbot plan`
- [Rerun](./rerun.md) — re-executing generated tests
