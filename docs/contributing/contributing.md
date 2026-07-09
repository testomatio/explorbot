# Contributing to Explorbot

## Project Philosophy

Explorbot is general-purpose. It works with any web application, with no site-specific code. Keep this in mind when you contribute:

- Solutions must work across different websites.
- Don't hardcode locators or site-specific selectors.
- Prefer universal patterns: ARIA, semantic HTML, common UI conventions.
- A fix that only helps one site is probably the wrong approach.

## Before You Start

Discuss first, code second. Open an issue to propose your idea before you send a PR. This saves wasted effort and aligns on the approach.

If Explorbot struggles on your site, try the built-in extension points first:

- Knowledge files teach Explorbot about your pages (credentials, wait conditions, hints).
- Rules add agent-specific guidance for navigation, research, and planning.
- Hooks run custom logic before and after actions.
- Configuration adjusts models, timeouts, and browser settings.

See the [knowledge](../workflow/knowledge.md), [hooks](../web-testing/hooks.md), and [configuration](../reference/configuration.md) docs.

## Pull Requests

We accept PRs that help a variety of users. Here is what gets merged.

### Tiny PRs get merged first

Small, focused changes are reviewed and merged quickly. Examples:

- Fix a typo in a prompt.
- Add a missing ARIA selector pattern.
- Improve an error message.
- Fix a bug with a clear reproduction.

### PRs that change agent logic require manual testing

Changes to agents (tester, navigator, researcher, pilot, and others) affect how Explorbot interacts with every website. These PRs must be:

- Polished — clean code, no leftover debug artifacts.
- Tested by a person on real websites.
- Described clearly: what changed and why.

### PRs that change prompts require execution traces

If you change internal AI prompts or rules, you must provide a [Langfuse](https://langfuse.com) execution trace that shows the change improved behavior. "It should work better" is not evidence. Show the before and after.

### We accept agentic PRs

AI-generated contributions are welcome if they follow the rules above: small, focused, tested, with clear explanations.

### What NOT to send

- PRs that reformat code differently. We use [Biome](https://biomejs.dev/) for formatting. Run `bun run format` before submitting.
- Large refactoring PRs without prior discussion.
- Site-specific fixes that only help one website.
- Changes that break existing tests.

## Development Setup

```bash
bun install
bunx playwright install
```

## Code Style

- Biome for formatting and linting. Run `bun run format` after every change.
- No comments unless explicitly needed.
- Early returns instead of nested if/else.
- KISS/YAGNI — make the smallest change possible.
- No code duplication. Check if it already exists.
- Use dedent for formatting prompts.
- No ternary operators.

See `CLAUDE.md` for the full guidelines.

## Testing

Run `bun run format`, `bun run lint`, `bun run test:unit`, and `bun run test:node` before you submit a PR — all checks must pass. See the [testing guide](testing.md) for details, [AI integration tests](ai-integration-tests.md) for mocked-LLM agent tests, and [regression tests](regression-tests.md) for the real-AI end-to-end harness.

## Using Claude Code

This project includes Claude Code skills to help with development. See the `.claude/skills/` directory: changelog, demo-video, explorbot-debug, explorbot-fix-session, image-processing, prompt-audit, xpath-testing.

## Questions?

Open an issue on GitHub for questions or discussion.
