---
name: prompt-audit
description: Audit AI prompts and rules for web navigation/testing. Use when checking for contradictions, ambiguity, or issues in src/ai/rules.ts, navigator.ts, and tools.ts
---

# Prompt Audit

Audit prompts and rules used for web navigation and testing in this codebase.

## Files to Read

Read these files to perform the audit:
- `src/ai/rules.ts` - Core rules and guidelines
- `src/ai/navigator.ts` - Navigation prompts
- `src/ai/tools.ts` - Tool definitions

## Audit Checklist

### Rules Analysis (`rules.ts`)

Look for:
- **Contradictions**: Rules that conflict (e.g., "prefer ARIA" vs "use text first")
- **Ambiguity**: Vague guidance interpreted multiple ways
- **Incomplete guidance**: Missing priority order, edge cases
- **Locator priority**: Is ARIA → Text → CSS → XPath clearly defined?
- **Unused rules**: Exported but never imported

### Rule Usage (`navigator.ts`)

Check:
- **Imported but unused**: Rules imported but not in prompts
- **Missing rules**: Prompts missing locatorRule or actionRule
- **Duplication**: Inline rules duplicating rules.ts
- **HTML tags**: Content wrapped in `<page_html>` tags?

### Tools Analysis (`tools.ts`)

Verify:
- **locatorRule usage**: Tools accepting locators include locatorRule?
- **Suggestions on failure**: Failed results provide helpful hints?
- **Tool differentiation**: Clear when to use each tool?

## Severity Levels

| Severity | Description |
|----------|-------------|
| 🔴 Critical | Breaks functionality, contradictory rules |
| 🟠 High | Significant confusion, misleading examples |
| 🟡 Medium | Suboptimal but functional |
| 🟢 Minor | Typos, formatting |

## Output Format

```markdown
## Audit Results

### Critical Issues 🔴
1. **[File:Line]** Issue
   - Impact: What goes wrong
   - Fix: Suggested resolution

### High Priority Issues 🟠
...

### Medium Priority Issues 🟡
...

### Minor Issues 🟢
...

### Observations
- Patterns noticed
- Recommendations
```
