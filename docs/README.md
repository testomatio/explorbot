# Explorbot Documentation

Explorbot explores your web app, plans tests, and runs them — no scripts required.

New here? Read [Getting Started](./setup/getting-started.md) — it takes you from install to your first test.

## Setup

- [Getting started](./setup/getting-started.md) — install to first test in ten minutes
- [Running Explorbot](./setup/running.md) — interactive TUI vs headless CLI, and when to use each
- [Prerequisites](./setup/prerequisites.md) — check that your app is a good fit
- [Providers](./setup/providers.md) — set up an AI provider and pick models

## Web testing

- [Basics](./web-testing/basics.md) — the explore loop, states, and your first session
- [Customization](./web-testing/customization.md) — make it work on your app: login, cookie bars, modals, test data
- [Planner](./web-testing/planner.md) — tune what gets tested
- [Researcher](./web-testing/researcher.md) — how pages are analyzed, and how to tune it
- [Page interaction](./web-testing/page-interaction.md) — how agents read and act on a page
- [Automated tests](./web-testing/automated-tests.md) — the runnable test files you keep
- [Rerun](./web-testing/rerun.md) — re-run generated tests with AI healing
- [Agents](./web-testing/agents.md) — what each agent does under the hood
- [Hooks](./web-testing/hooks.md) — run your own code before or after an agent

## API testing

- [Basics](./api-testing/basics.md) — Chief and Curler, configuration, your first API test
- [Planning](./api-testing/planning.md) — specs, endpoint knowledge, and planning styles
- [Running tests](./api-testing/running-tests.md) — executing plans, request logs, autonomous explore

## Doc collection

- [Basics](./doc-collection/basics.md) — crawl your app and generate page docs
- [Crawling](./doc-collection/crawling.md) — choose what gets visited
- [Interactive mode](./doc-collection/interactive-mode.md) — document behavior, not just pages

## Common workflow

These pages apply to web and API testing alike:

- [Knowledge](./workflow/knowledge.md) — teach Explorbot about your app
- [Test plans](./workflow/test-plans.md) — the plan file format and how plans are reused
- [Planning styles](./workflow/planning-styles.md) — normal, curious, psycho, and your own
- [Reporting](./workflow/reporting.md) — local reports and Testomat.io
- [Continuous integration](./workflow/ci.md) — scheduled runs with cached experience on any CI

## Reference

- [Commands](./reference/commands.md) — every CLI and terminal command
- [Configuration](./reference/configuration.md) — the config file, top to bottom
- [Scripting](./reference/scripting.md) — the programmatic API

## Contributing

- [Contributing](./contributing/contributing.md) — how to contribute
- [Observability](./contributing/observability.md) — trace and debug AI calls
- [Testing](./contributing/testing.md) — run the test suite
- [AI integration tests](./contributing/ai-integration-tests.md) — how agent tests work
- [Regression tests](./contributing/regression-tests.md) — the real-AI e2e harness
- [Demo videos](./contributing/demo-videos.md) — turn recorded sessions into demo clips
- [npm package](./contributing/npm-package.md) — build and publish
