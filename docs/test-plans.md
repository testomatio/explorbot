# Test Plans

A test plan is a markdown file containing a suite of scenarios for the Tester to execute. Explorbot generates plans via the [Planner](./planner.md), but the format is plain markdown — you can hand-write plans, edit generated ones, or check them into version control.

Plans are saved to `output/plans/` by default and loaded by the same parser whether they were generated or authored manually.

The format is a dialect of the [Testomat.io classical markdown format](https://docs.testomat.io/project/import-export/export-tests/classical-tests-markdown-format/), extended with a `### Prerequisite` block so Explorbot knows which page to open before executing each test.

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

A single file may contain multiple suites — each begins with its own `<!-- suite -->` marker and parses as an independent plan.

## Elements

### `<!-- suite -->`

Marks the start of a plan. The `#` heading on the following line becomes the plan's title. Follows the Testomat.io convention of HTML-comment metadata blocks.

### `### Prerequisite`

Holds the suite-level URL as a single bullet:

```
* URL: /relative-path
```

**The URL is required — without it, tests in the suite will not be executed.** It must be **relative** to the configured base URL (start with `/`), so the same plan runs against staging, production, or a local dev server without edits.

Every test in the suite inherits this URL as its start page. Explorbot navigates to it before running each scenario.

### `<!-- test priority: … -->`

Opens a test block. Valid priorities: `critical`, `important`, `high`, `normal`, `low`. Defaults to `normal` if omitted. See [Test Priorities](./planner.md#test-priorities) for what each level means.

### `#` Scenario heading

A single `#` heading inside a test block is the scenario description. Write it as a business outcome, not a click path.

### `## Steps`

Bulleted list (`* `) of planned actions in plain language. The Tester reads these as guidance, not a strict script — it may adapt them to what it actually sees on the page. A step may span multiple lines by indenting continuation lines with 2 spaces.

Unlike the Testomat.io classical format — which inlines `*Expected*:` inside each step — Explorbot separates actions and outcomes into distinct `## Steps` and `## Expected` sections.

### `## Expected`

Bulleted list (`* `) of expected outcomes. Each outcome should describe a **verifiable change** — a data change, state change, or a UI change with a side effect. See the Planner's [outcome-strength guidance](./planner.md#built-in-styles) for what counts.

The Tester marks a test as passing only when every expected outcome has been verified.

## Reusing saved plans

Saved plans aren't only artifacts — `explorbot explore --configure="new:25%"` will load the matching plan, re-run a subset of its tests, and let the planner generate a few new ones to fill the budget. Old picks can be filtered by priority/style and ordered by priority, file index, or random shuffle. See the [`--configure` reference in commands.md](./commands.md#explore-url) for the full key list and examples.

## See Also

- [Automated Tests](./automated-tests.md) — the runnable Playwright or CodeceptJS files Explorbot writes after executing a plan
- [Planner](./planner.md) — how plans are generated
- [Commands](./commands.md) — `/plan`, `/explore`, `explorbot plan`
- [Rerun](./rerun.md) — re-executing generated tests
