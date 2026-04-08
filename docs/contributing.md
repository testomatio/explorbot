# Contributing to Explorbot

## Project Philosophy

Explorbot is designed to be **general-purpose** — it should work with any web application without site-specific customizations. When contributing, keep this in mind:

- Solutions must work across different websites
- Avoid hardcoding locators or site-specific selectors
- Prefer universal patterns (ARIA, semantic HTML, common UI conventions)
- If a fix only helps one specific site, it's probably not the right approach

## Before You Start

**Discuss first, code second.** Open an issue to propose your idea before sending a PR. This avoids wasted effort and helps align on the approach.

If Explorbot doesn't work well on your site, try the built-in extension points first:
- **Knowledge files** — teach Explorbot about your pages (credentials, wait conditions, hints)
- **Rules** — add agent-specific rules for navigation, research, planning
- **Hooks** — run custom logic before/after actions
- **Configuration** — adjust models, timeouts, browser settings

See the [knowledge](knowledge.md), [hooks](hooks.md), and [configuration](configuration.md) docs.

## Pull Requests

We accept PRs that benefit a **variety of users**. Here's what gets merged:

### Tiny PRs get merged first

Small, focused changes are reviewed and merged quickly. Examples:
- Fix a typo in a prompt
- Add a missing ARIA selector pattern
- Improve an error message
- Fix a bug with a clear reproduction

### PRs that change agent logic require manual testing

Changes to agents (tester, navigator, researcher, pilot, etc.) affect how Explorbot interacts with every website. These PRs must be:
- Carefully polished — clean code, no leftover debug artifacts
- Tested by a person on real websites
- Accompanied by a clear description of what changed and why

### PRs that change prompts require execution traces

If you modify internal AI prompts or rules, you **must** provide a [Langfuse](https://langfuse.com) execution trace showing that the change actually improved behavior. "It should work better" is not evidence — show the before/after.

### We accept agentic PRs

AI-generated contributions are welcome as long as they follow the rules above. Small, focused, tested, with clear explanations.

### What NOT to send

- PRs that reformat code differently — we use [Biome](https://biomejs.dev/) for formatting, run `bun run format` before submitting
- Large refactoring PRs without prior discussion
- Site-specific fixes that only help one website
- Changes that break existing tests

## Development Setup

```bash
bun install
bunx playwright install
```

## Code Style

- **Biome** for formatting and linting — run `bun run format` after every change
- **No comments** unless explicitly needed
- **Early returns** instead of nested if/else
- **KISS/YAGNI** — smallest change possible
- **No code duplication** — check if it already exists
- **Use dedent** for formatting prompts
- **Avoid ternary operators**

See `CLAUDE.md` for full guidelines.

## Testing

```bash
bun run format       # Format code
bun run lint         # Check linting
bun run test:unit    # Run unit tests (Bun)
bun run test:node    # Run Node.js build tests
```

All checks must pass before submitting a PR.

## Using Claude Code

This project includes Claude Code skills to help with development. See `CLAUDE.md` for the full list.

## Questions?

Open an issue on GitHub for questions or discussion.
