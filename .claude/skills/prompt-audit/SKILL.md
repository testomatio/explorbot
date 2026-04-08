---
name: prompt-audit
description: Audit AI prompts and rules for web navigation and testing. Use when reviewing src/ai/rules.ts, navigator.ts, or tools.ts for contradictions, gaps, locator guidance, or tool/schema consistency.
---

# Prompt and rules audit (Explorbot)

Instructions for auditing navigation and testing prompts in this repository.

## When to apply

Use this workflow when asked to audit rules, navigation prompts, tool definitions, or when checking consistency across `rules.ts`, `navigator.ts`, and `tools.ts`.

## Files to read

| File | Role |
|------|------|
| `src/ai/rules.ts` | Locator, action, and verification rules |
| `src/ai/navigator.ts` | Prompts that consume those rules |
| `src/ai/tools.ts` | Tool schemas, locator guidance, failure messages |

## 1. Rules (`rules.ts`)

- **Contradictions**: Conflicting guidance (e.g. ARIA-first vs text-first without ordering).
- **Ambiguity**: Text that can be read multiple ways; missing definitions.
- **Gaps**: No explicit priority, disambiguation, or edge cases where the model needs them.
- **Locator priority**: ARIA → accessible name/text → CSS → XPath should be explicit if all are allowed.
- **Context parameter**: When it is required or optional; which tools or Codecept calls use it.
- **Short vs long locators**: What counts as "short" vs "long" and when each is appropriate.
- **Dead exports**: Rules exported but never imported.

## 2. Navigator (`navigator.ts`)

- **Unused imports**: Rule strings imported but not embedded in prompts.
- **Missing injections**: Prompts that need `locatorRule`, `actionRule`, or verification text but omit them.
- **Duplication**: Inline guidance that repeats or diverges from `rules.ts`.
- **Structure**: Comparable sections across similar prompts.
- **HTML wrapping**: Page HTML wrapped in `<page_html>` (or the project's agreed tag) where required.

## 3. Tools (`tools.ts`)

- **locatorRule**: Present on tools that take locators, aligned with `rules.ts`.
- **Schema copy**: Descriptions mention locator kinds the stack supports (e.g. ARIA, CSS, XPath) where relevant.
- **Failures**: Unsuccessful tool results include actionable `suggestion` (or equivalent) text.
- **Reachability**: No branches that cannot run (e.g. validation that makes a path impossible).
- **Consistency**: Error and success shapes follow one pattern across tools.
- **Differentiation**: Descriptions state when to prefer one tool over another (e.g. click vs text-based variants, type with vs without locator).

## Severity

| Level | Meaning | Examples |
|-------|---------|----------|
| Critical | Wrong or unsafe model behavior | Contradictory rules, unreachable logic, required rules missing from prompts |
| High | Major confusion or misleading examples | Ambiguous locator order, wrong formats, schema vs prompt mismatch |
| Medium | Works but weak | Redundant prose, weak failure hints, uneven structure |
| Minor | Polish | Typos, spacing, heading inconsistency |

## Output format

Use this structure in the audit reply:

```markdown
## Audit Results

### Critical issues
1. **[path:line]** Summary
   - Impact: …
   - Fix: …

### High priority issues
1. **[path:line]** Summary
   - Impact: …
   - Fix: …

### Medium priority issues
1. **[path:line]** Summary
   - Impact: …
   - Fix: …

### Minor issues
1. **[path:line]** Summary
   - Fix: …

### Observations
- Patterns and recommendations
- Open questions if anything is unclear
```

## Deep checklist

### Locator rules

- [ ] Priority order documented (ARIA → text → CSS → XPath as applicable)
- [ ] Context parameter explained (when and which tools)
- [ ] Disambiguation (forms, ARIA state, proximity, multiple matches)
- [ ] Short vs long locators defined
- [ ] Examples match live conventions (quotes, JSON shapes)

### Action rules

- [ ] Codecept-style calls referenced where relevant (`I.click`, `I.fillField`, `I.see`, …)
- [ ] Required parameters called out (including context for `I.see` if used)
- [ ] Forbidden or discouraged patterns named (e.g. waits, `amOnPage` in wrong layer)
- [ ] Examples match the documented format

### Verification rules

- [ ] `I.see` (or equivalents) and context requirements
- [ ] `I.seeElement` (or equivalents) and locator preferences
- [ ] Strictness to limit false positives
- [ ] Examples show correct usage

### Tool definitions

- [ ] Each locator-aware tool carries the right rule text
- [ ] Input schemas describe allowed locator types
- [ ] Failed paths give useful suggestions
- [ ] Descriptions distinguish alternatives clearly

## Execution

1. Read the three files above.
2. Walk sections 1–3 and the deep checklist.
3. Report findings in the output format, with file and line references.
