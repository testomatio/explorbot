---
name: prompt-audit
description: Audit Explorbot's AI prompts, rules and tool descriptions for contradictions, gaps, example-driven rules and tool/schema mismatches. Use when reviewing system prompts in agent files, src/ai/rules.ts, rules/**/*.md or tool descriptions, or as the periodic prompt half of maintenance (code-audit covers the code half). Report-only.
user_invocable: true
---

# Prompt audit (Explorbot)

Read every prompt an agent actually receives and find where it contradicts itself, another agent or the project's prompt principles.

**Report-only.** Never edit prompt text, rules or tool descriptions during the audit. Propose exact replacement wording in the report; the user approves wording before anything is written.

## Arguments

- `/prompt-audit` — all agents
- `/prompt-audit navigator` — one agent (and the rules/tools it receives)

## Prompt sources

| Source | What it holds |
|---|---|
| `src/ai/<agent>.ts`, `src/ai/<agent>/*.ts` | System prompts, per-step instructions (`dedent` blocks) |
| `src/ai/rules.ts` | Shared locator, action, verification rules |
| `rules/<agent>/*.md`, `rules/*/styles/*.md` | File-based rules and planning styles |
| `src/ai/tools.ts`, `src/ai/*-tools.ts`, `tool({ ... })` in agent files | Tool `description` and `inputSchema` `.describe()` text, failure `suggestion` text |
| `boat/*/src/ai/` | Boat agents' prompts and tools |

## Step 1: Assemble per agent

For each agent in scope, collect what the model sees in one call: system prompt, injected rules (follow the imports from `rules.ts` and the `rules/` loader), per-step instructions, and descriptions of every tool it is given. Audit that assembled set, not files in isolation — most contradictions sit between a system prompt and a tool description, or between a shared rule and an agent's own wording.

## Step 2: Check

### Contradictions (highest value)
- Two instructions that cannot both be followed (e.g. "always X" in the system prompt, "never X unless Y" in a tool description).
- Priority conflicts: two orderings of the same choice (locator kinds, which tool first, when to stop).
- The same term defined differently across sources.
- Cross-agent: a supervisor and the agent it supervises (Pilot ↔ Tester, Captain ↔ Historian) disagree on when to stop, retry or finish.
- Tool description vs tool behavior: description promises a parameter, output or fallback the `execute` does not have.

### Project principles (CLAUDE.md)
- Example-driven rules: a rule that names one concrete site, label, class or past failure instead of stating a general principle.
- Hardcoded locators, CSS class names or framework names in prompt text.
- Form/field/submit vocabulary assumed where the rule should speak of controls and outcomes.
- Rules that teach the model to infer data a tool should report.
- Verbose rules: elaboration where 1–3 telegraph-style lines would do; repeated guidance across sources (one source should own it).

### Structure and gaps
- Rule exported from `rules.ts` or a file in `rules/` that no prompt includes.
- Prompt that needs a shared rule but restates it inline (divergence risk).
- Missing priority, disambiguation or edge case the model visibly needs.
- Page HTML not wrapped in `<page_html>` where injected; HTML given to an agent outside the HTML access table.

### Locators and tools
- Locator priority (ARIA → accessible name/text → CSS → XPath) explicit and identical everywhere.
- Context parameter: when required, which tools use it.
- Locator-aware tools carry the shared locator rule.
- Failed tool results give an actionable `suggestion`; success/error shapes consistent.
- Descriptions say when to prefer one tool over a similar one (click vs visualClick, type with vs without locator).
- Examples match live conventions (quotes, JSON shapes, CodeceptJS call forms).

## Severity

| Level | Meaning |
|---|---|
| Critical | Contradiction the model must resolve by guessing; required rule missing; tool description promising behavior that does not exist |
| High | Ambiguous priority; example-driven or site-specific rule; schema vs prompt mismatch |
| Medium | Duplicated or diverging guidance; weak failure hints; verbose rules |
| Minor | Typos, formatting, heading inconsistency |

## Output format

```markdown
## Prompt audit: <scope>

### Critical
1. **path:line ↔ path:line** — what conflicts
   - Model sees: "<quote A>" vs "<quote B>"
   - Proposed wording: "<exact replacement>" (in which source)

### High
...

### Medium / Minor
...

### Unused or duplicated rules
- `rules.ts: exportName` — not included anywhere / restated in `<file>`
```

Quote both sides of every contradiction. Proposed wording follows the principles above: general, short, no examples from the finding itself.
