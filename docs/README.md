# Explorbot Documentation

Explorbot explores your web app, plans tests, and runs them — no scripts required.

New here? Read [Getting Started](./setup/getting-started.md) — it takes you from install to your first test.

## Setup

- [Getting started](./setup/getting-started.md) — install to first test in ten minutes
- [Prerequisites](./setup/prerequisites.md) — check that your app is a good fit
- [Providers](./setup/providers.md) — set up an AI provider and pick models

## Web testing

How it works:

- [Agents](./web-testing/agents.md) — what each agent does
- [Researcher](./web-testing/researcher.md) — how Explorbot analyzes a page
- [Page interaction](./web-testing/page-interaction.md) — how agents read and act on a page

Solve common problems:

- [Customization](./web-testing/customization.md) — login, cookie bars, modals, test data
- [Hooks](./web-testing/hooks.md) — run code before or after an agent
- [Planner](./web-testing/planner.md) — how test scenarios are invented
- [Automated tests](./web-testing/automated-tests.md) — the test files Explorbot writes
- [Rerun](./web-testing/rerun.md) — re-run generated tests with AI healing

## API testing

- [API testing](./api-testing/overview.md) — test REST APIs with AI agents

## Doc writing

- [Doc collector](./doc-writing/doc-collector.md) — generate page specs and docs from your app

## Common workflow

These pages apply to web and API testing alike:

- [Knowledge](./workflow/knowledge.md) — teach Explorbot about your app
- [Test plans](./workflow/test-plans.md) — the plan file format and how plans are reused
- [Planning styles](./workflow/planning-styles.md) — normal, curious, psycho, and your own
- [Reporting](./workflow/reporting.md) — local reports and Testomat.io

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
