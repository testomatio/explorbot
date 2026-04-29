---
name: changelog
description: Generate a structured changelog entry from git changes
user_invocable: true
---

# Changelog Generation

Generate a structured changelog entry for Explorbot by analyzing git changes.

## Arguments

- `/changelog` — generate from all uncommitted changes (staged + unstaged + untracked)
- `/changelog HEAD~5` — generate from last N commits
- `/changelog v1.0..HEAD` — generate from a ref range

## Step 1: Gather Changes — DO THIS FIRST, NO EXCEPTIONS

> **STOP. Before writing a single line of changelog, you MUST run `git diff` over the full scope this skill requires. Do not infer changes from recent commits, from the conversation history, or from memory of what you just edited. The working tree is the source of truth. Skipping this step produces wrong, incomplete changelogs — every time.**

**This applies even if you just committed:** a fresh commit is a strict subset of the working tree when unstaged changes exist. Always run the full scope below.

### Commands to run (no argument — the default)

Run ALL of these, in parallel, every time:

1. `git status --short` — see what's modified, staged, and untracked
2. `git diff --stat HEAD` — combined stat for every tracked file vs HEAD (staged + unstaged)
3. `git diff HEAD <file> <file> …` — the actual diff for every file that appeared in step 2, batched across the key paths listed below
4. For each untracked file from step 1, `Read` its full contents (they have no diff)

### Commands to run (ref argument — `/changelog <ref>`)

1. `git diff <ref> --stat` — stat across the ref range
2. `git diff <ref> <file> <file> …` — the actual diffs

### Key paths you MUST cover

If any of these paths appears in the stat, you MUST read its diff before writing the entry:

- `bin/explorbot-cli.ts` — CLI entry point
- `src/commands/` — every file (new TUI commands, new flags)
- `src/config.ts` — config surface
- `src/ai/tools.ts` — tool descriptions the AI sees
- `src/ai/rules.ts` — rules injected into prompts
- `src/ai/*.ts` — agent behavior
- `src/explorer.ts`, `src/explorbot.ts` — container + orchestration
- `src/reporter.ts` — reporter output users see
- `src/state-manager.ts` — state + transitions
- `src/experience-tracker.ts` — experience file format
- `src/stats.ts` — user-visible stats
- `docs/` — docs changes

### Sanity check before proceeding

Before you start writing, answer (internally) these two questions:

1. Did I run `git status --short` AND `git diff --stat HEAD` in this turn?
2. Is the list of files I'm about to describe exactly the list from step 2 (minus skipped internal-only files from Step 3)?

If either answer is no, go back and run the commands. Do not continue.

## Step 2: Classify Changes Into Sections

Map changed files to changelog sections:

| Source | Section |
|--------|---------|
| `bin/explorbot-cli.ts` — new `.option()` calls, new commands | **New CLI Options** |
| `src/commands/` — new flags parsed from args | **New TUI Commands** |
| `src/config.ts` — new fields in config interfaces | **Configuration** |
| `src/ai/*.ts` — behavior changes in agent classes | Agent-related changes |

## Step 3: Filter for User-Facing Changes Only

**Include:**
- New or changed CLI flags and commands
- New or changed TUI commands and their flags
- New config options with defaults
- Agent behavior changes visible to users (new capabilities, changed output)
- New integrations or provider support

**Skip:**
- Internal refactors, moving code between files
- Type-only changes, interface renaming
- Code style fixes, formatting
- Test data or test file changes
- Comment additions or removals

## Step 4: Write Changelog Entry

Use today's date as the heading. Follow this format exactly:

```markdown
## YYYY-MM-DD

### New CLI Options
- **`--flag-name`** — Description of what it does.
  ```bash
  explorbot command --flag-name           # example usage
  explorbot command --flag-name value     # with value
  ```

### New TUI Commands
- **`/command --flag`** — Description. Document with TUI-specific syntax.
  ```
  /command --flag
  /command arg --flag
  ```

### Configuration
- **`config.key`** — What it controls. Default: `value`.
- **`nested.parent.key`** — Description. Default: `value`.

### Changes
- [Researcher] Now does X when Y happens
- [Planner] Added support for Z
- [Navigator] Improved error recovery for W
- State Manager: Change description
- Experience Tracker: Change description
```

**Rules:**
- Only include sections that have entries (omit empty sections)
- Every CLI/TUI option must have a usage example in a code block
- Every CLI/TUI option must explain what it does from the user's perspective — not just mention the flag name
- If a command gains new flags (e.g. via shared options helper), list each new flag separately with its description
- Configuration entries list the key path, description, and default value — no code blocks
- For agent-related changes, prefix with `[AgentName]` in square brackets
- For non-agent components (State Manager, Experience Tracker), use plain name prefix
- Only list changes with user-visible behavior impact
- NEVER use internal developer terminology — describe what the user sees or experiences, not implementation details
- Do not invent jargon like "gap-fill" or "annotation pipeline" — use plain language ("elements that AI missed are now detected")

## Step 5: Write to CHANGELOG.md

- If `CHANGELOG.md` doesn't exist, create it with a `# Changelog` header followed by a blank line, then the new entry
- If `CHANGELOG.md` exists, prepend the new entry after the `# Changelog` header line (newest first)
- Always leave a blank line between the header and the first entry, and between entries
