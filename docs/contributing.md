# Contributing to Explorbot

## Project Philosophy

Explorbot is designed to be **general-purpose** — it should work with any web application without site-specific customizations. When contributing, keep this in mind:

- Solutions must work across different websites
- Avoid hardcoding locators or site-specific selectors
- Prefer universal patterns (ARIA, semantic HTML, common UI conventions)
- If a fix only helps one specific site, it's probably not the right approach

## Pull Requests

We accept PRs that benefit a **variety of users**. Before submitting:

- Ensure your change is general-purpose, not site-specific
- Test with multiple web applications if possible
- Keep changes focused and minimal

### AI-Generated PRs

We welcome AI-assisted contributions but prefer:

- **Small, focused changes** — easier to review and verify
- **Clear explanations** — describe what the AI was asked to do
- **Human review** — verify the AI output makes sense

Large AI-generated PRs with many files are harder to review and more likely to introduce subtle issues.

## Development Setup

```bash
bun install
bunx playwright install
```

Run formatting after changes:

```bash
bun run format
```

## Using Claude Code

This project includes Claude Code skills to help with development.

### Available Skills

Invoke skills with `/<skill-name>` in Claude Code:

#### `/prompt-audit`

Audits AI prompts and rules for contradictions, ambiguity, and issues.

```
/prompt-audit
```

Analyzes:
- `src/ai/rules.ts` — Core rules and guidelines
- `src/ai/navigator.ts` — Navigation prompts
- `src/ai/tools.ts` — Tool definitions

Reports issues by severity (Critical, High, Medium, Minor).

#### `/image-processing`

Commands for processing images for documentation.

```
/image-processing
```

Provides:
- Add borders/shadows to screenshots (ImageMagick)
- Create GIFs from videos (ffmpeg)
- Resize and optimize images

### Project Instructions

Claude Code reads `CLAUDE.md` for project-specific guidance including:

- Code style (early returns, no comments unless specified)
- Architecture overview
- Separation of concerns
- Available agents and their purposes

## Code Style

- **No comments** unless explicitly needed
- **Early returns** instead of nested if/else
- **KISS/YAGNI** — smallest change possible
- **No code duplication** — check if it already exists
- **Use dedent** for formatting prompts
- **Avoid ternary operators**

See `CLAUDE.md` for full guidelines.

## Testing

```bash
bun run test:unit      # Unit tests
bun run test:ui        # UI tests
bun run lint:fix       # Fix linting issues
```

## Questions?

Open an issue on GitHub for questions or discussion.
