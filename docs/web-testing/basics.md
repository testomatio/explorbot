# Web Testing Basics

Explorbot tests a web app the way a curious QA engineer would: open a page, figure out what it does, invent test scenarios, run them, and remember what happened. You write no test scripts up front — the tests come from the app itself.

This page explains the concepts behind that loop and the minimum configuration to start. If you haven't installed Explorbot yet, do [Getting Started](../setup/getting-started.md) first.

## What it does

One exploration cycle has four parts:

1. **Research.** The Researcher agent reads the current page — HTML, ARIA snapshot, and optionally a screenshot — and builds a map of what's on it: forms, buttons, tables, navigation.
2. **Plan.** The Planner turns that map into test scenarios with priorities and expected outcomes, cycling through planning styles to broaden coverage.
3. **Test.** The Tester runs each scenario step by step in a real browser, adapting when a click misses or a modal appears. The Pilot supervises from above and steps in when the test gets stuck.
4. **Learn.** Outcomes are recorded — what worked, what failed, how failures were resolved — so the next run starts smarter.

When you run `/explore`, this cycle repeats. After the start page is covered, Explorbot picks promising sub-pages linked from it and continues there, until it runs out of pages or hits your test limit.

Two ideas hold this loop together, and you will meet them everywhere in these docs: states and learning.

### States

A page state is the URL plus the page's main headings (`h1` and `h2`). That's how Explorbot knows where it is. A URL alone isn't enough — a single-page app can show a list, an edit form, and a confirmation dialog all on one URL — so headings are part of the identity.

States are the anchor points for everything else. Navigation history is a chain of state transitions, knowledge and experience are matched to the current state, and loop detection compares recent state hashes: if the bot keeps cycling through the same one or two states, it knows it's stuck and changes strategy instead of burning iterations.

### Learning

Explorbot keeps two directories of markdown files next to your config:

- `knowledge/` — facts **you** teach it: credentials, quirks, hints, small automations. Each file targets pages by URL pattern, so knowledge for `/login` loads only on the login page and knowledge for `*` loads everywhere.
- `experience/` — what it **learned by doing**: failed attempts, working resolutions, session notes. Files are named after state hashes, so lessons from a page are re-read the next time that page appears.

Knowledge is the input you control; experience accumulates on its own. Both are plain markdown you can read and edit. See [Knowledge](../workflow/knowledge.md).

## Configure

Web testing needs one thing beyond the AI setup from Getting Started — the base URL of your app:

```javascript
export default {
  web: {
    url: 'http://localhost:3000',
  },
  ai: {
    model: openrouter('openai/gpt-oss-20b:nitro'),
    visionModel: openrouter('google/gemma-4-31b-it'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
};
```

The three models split the work by cost: `model` does the heavy page reading on every step, `visionModel` analyzes screenshots, and `agenticModel` makes the high-level decisions on short inputs, so it can be smarter without costing much. The full breakdown is in [Getting Started](../setup/getting-started.md); provider setup is in [Providers](../setup/providers.md). Every other option — browser settings, directories, per-agent tuning — lives in the [Configuration reference](../reference/configuration.md).

## First run

One tip from Getting Started is worth repeating: don't start on your homepage. Point Explorbot at one focused page with a clear CRUD interface — a list-and-edit screen, a settings page. It gives the bot an obvious job and you an obvious way to judge the result.

The interactive route opens the TUI, where you watch the run and can step in:

```bash
npx explorbot start /admin/projects
```

Then type `/explore` to run the full loop, or go one step at a time with `/research` (analyze the page), `/plan` (propose scenarios), and `/test` (run the next one).

The headless route runs the same loop without the TUI and exits when done — good for CI or overnight runs:

```bash
npx explorbot explore /admin/projects --max-tests 10 --focus "project management"
```

`--max-tests` caps how many tests run; `--focus` narrows planning to one feature. Both are optional.

## What you get

Every run leaves artifacts behind:

- **Test plans** in `output/plans/` — the scenarios as markdown, with priorities and results. You can re-run, edit, or extend them. See [Test Plans](../workflow/test-plans.md).
- **Runnable tests** in `output/tests/` — CodeceptJS/Playwright code generated from successful runs, ready to commit and run in CI. See [Automated Tests](./automated-tests.md).
- **A session report** in `output/reports/` — a human-readable summary that clusters defects, UX issues, and execution problems by root cause. See [Reporting](../workflow/reporting.md).
- **Experience files** in `experience/` — the lessons that make the next run faster and less error-prone.

## Where to go next

- [Customization](./customization.md) — make it work on *your* app: login, cookie banners, modals, test data.
- [Planner](./planner.md) — tune what gets tested: styles, priorities, custom rules.
- [Researcher](./researcher.md) — how pages are analyzed and what the UI map contains.
- [Page Interaction](./page-interaction.md) — how Explorbot reads pages and picks locators.
- [Automated Tests](./automated-tests.md) and [Rerun](./rerun.md) — the tests you keep, and re-running them with AI healing.
- [Agents](./agents.md) — the agents behind the loop, and per-agent model configuration.
- [Hooks](./hooks.md) — run your own code before and after agents.
