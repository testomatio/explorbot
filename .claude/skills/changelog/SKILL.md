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

## Step 1: Gather Changes

Determine the diff source from arguments:

- **No arguments**: Run `git diff` (unstaged) and `git diff --cached` (staged), plus `git status` for untracked files
- **With ref argument**: Run `git diff <ref>` using the provided reference

Run `git diff --stat` (or `git diff <ref> --stat`) to see which files changed.

Then read the actual diffs for these key paths:
- `bin/explorbot-cli.ts`
- `src/commands/`
- `src/config.ts`
- `src/ai/tools.ts`
- `src/ai/rules.ts`
- `src/ai/*.ts` (agent files)
- `src/explorer.ts`
- `src/explorbot.ts`
- `src/state-manager.ts`
- `src/experience-tracker.ts`
- `docs/`

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
- Configuration entries list the key path, description, and default value — no code blocks
- For agent-related changes, prefix with `[AgentName]` in square brackets
- For non-agent components (State Manager, Experience Tracker), use plain name prefix
- Only list changes with user-visible behavior impact

## Step 5: Write to CHANGELOG.md

- If `CHANGELOG.md` doesn't exist, create it with a `# Changelog` header followed by a blank line, then the new entry
- If `CHANGELOG.md` exists, prepend the new entry after the `# Changelog` header line (newest first)
- Always leave a blank line between the header and the first entry, and between entries
