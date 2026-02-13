# Research Audit

Audit Explorbot research output against the actual ARIA tree to find missed interactive elements and classify root causes.

## When to Use

After running `/research` or `explorbot research <url>`, use this skill to understand:
- Which interactive elements the researcher missed
- Whether the cause is a code filter (PR material) or site-specific (knowledge file)

## Step 1: Acquire Data

### Option A: Use --verify flag (recommended)

Run research with the `--verify` flag to get an inline audit report:

```bash
# TUI
/research --deep --verify

# CLI
explorbot research <url> --deep --verify
```

This calls `Researcher.auditResearch()` which compares the research output against the ARIA tree automatically.

### Option B: Manual analysis of past sessions

Find the latest research output and ARIA snapshot:

```bash
ls -lt output/research/*.md | head -n 5
ls -lt output/*.aria.yaml | head -n 5
```

Match files by state hash (the hash prefix in filenames).

Read both files:
- Research file: `output/research/{hash}.md`
- ARIA snapshot: `output/{hash}*.aria.yaml`

## Step 2: Parse Both Sources

### Research output

Extract elements from the `| Element | ARIA | CSS | XPath |` tables:

```bash
rg '\|.*\|.*role.*\|' output/research/{hash}.md
```

### ARIA snapshot

The `.aria.yaml` file contains the raw Playwright ARIA tree. Interactive roles to look for:

```
button, link, textbox, searchbox, checkbox, radio, switch,
combobox, listbox, menuitem, tab, slider, spinbutton,
treeitem, gridcell, option
```

Count interactive elements:

```bash
rg '- (button|link|textbox|checkbox|radio|switch|combobox|menuitem|tab|slider|option|treeitem)' output/{hash}*.aria.yaml | wc -l
```

## Step 3: Classify Missed Elements

For each ARIA interactive element NOT found in the research output, check these code filters **in order**:

### Filter 1: Unnamed button/link

**Check**: Element has a role (button, link) but no name/text.

**Code location**: `src/utils/aria.ts:81` — `buildInteractiveEntry()` marks unnamed buttons with `unnamed: true` flag. Previously these were dropped entirely.

**Impact**: Icon buttons (ellipsis menus, plus buttons, filter icons, SVG-only buttons).

**Fix type**: CODE — PR to `src/utils/aria.ts`
- These are a universal web pattern, not site-specific
- Explorbot should handle unnamed buttons by falling back to CSS position
- The `performInteractiveExploration` method now handles unnamed elements

### Filter 2: Role not in CLICKABLE_ROLES

**Check**: Element's role is not in the set used by `performInteractiveExploration`.

**Code location**: `src/ai/researcher.ts:40`

```
CLICKABLE_ROLES: button, link, menuitem, tab, option, combobox, switch,
                 checkbox, radio, slider, textbox, treeitem
```

**Impact**: Any interactive element with a role not in this list is skipped during exploration.

**Fix type**: CODE — PR to `src/ai/researcher.ts`
- Add the missing role to `CLICKABLE_ROLES`
- Compare against `INTERACTIVE_ROLES` in `src/utils/aria.ts` (37 roles)

### Filter 3: Name matches stop word

**Check**: Element name matches one of `DEFAULT_STOP_WORDS`.

**Code location**: `src/ai/researcher.ts:38`

```
DEFAULT_STOP_WORDS: close, cancel, dismiss, exit, back, cookie, consent,
                    gdpr, privacy, accept all, decline all, reject all,
                    share, print, download
```

**Impact**: Legitimate buttons like "Close" in a modal workflow, "Back" navigation.

**Fix type**: CODE — PR to `src/ai/researcher.ts`
- Stop words should be context-aware (don't skip "Close" inside a modal)
- Or make stop words configurable per-project in `explorbot.config`

### Filter 4: Inside ignored navigation container

**Check**: Element is inside a `<nav>` or element with `role="navigation"`.

**Code location**: `src/utils/aria.ts:40` — `IGNORED_CONTAINER_ROLES`

**Impact**: Navigation buttons lose their container context (children are still visited but hierarchy is flattened).

**Fix type**: CODE — PR to `src/utils/aria.ts`

### Filter 5: AI prompt behavior (no code filter matched)

**Check**: Element passed all code filters but AI did not include it in the research output.

**Possible causes**:
- `src/ai/researcher.ts:459` — "Group similar interactive elements" instruction tells AI to collapse duplicates
- AI considered the element "decorative" or low-priority
- AI ran out of context or truncated output

**Fix type**: PROMPT — PR to `src/ai/researcher.ts`
- Remove or soften grouping instruction
- Add completeness constraint: "You MUST include all interactive elements from the ARIA tree"
- Inject the interactive nodes list as a checklist

### Filter 6: Site-specific (last resort)

**Check**: None of the above filters matched AND the element uses a non-standard role or custom widget.

**Fix type**: KNOWLEDGE FILE
- Only suggest a knowledge file if no code-level cause was found
- Document the custom widget and its interaction pattern

## Step 4: Generate Report

Structure the report in three sections:

### CODE FILTER ISSUES (PR material)

For each code filter that dropped elements:
- Which filter (file and line number)
- How many elements affected
- List of affected elements with role and name
- Suggested code change

### PROMPT ISSUES (PR material)

For elements the AI skipped:
- List of elements with role and name
- Whether they might have been grouped (multiple elements with same name)
- Reference to the prompt instruction causing it

### SITE-SPECIFIC (knowledge file)

Only for truly custom widgets:
- Element description
- Suggested knowledge file content
- URL pattern for the knowledge file

## Step 5: Suggest Next Action

Based on the report:

1. **Code filter fix** — Identify the most impactful filter (most elements affected). Suggest the exact file, line, and change. This is PR material for the Explorbot project.

2. **Prompt fix** — If AI is the main cause, suggest prompt modifications in `src/ai/researcher.ts` (the `buildResearchTaskPrompt()` or `buildResearchPrompt()` methods).

3. **Knowledge file** — Only as last resort. Generate the file content with proper URL pattern.

## Quick Reference: Code Locations

| Filter | File | Line | What to Change |
|--------|------|------|----------------|
| Unnamed buttons | `src/utils/aria.ts` | 81 | `buildInteractiveEntry()` |
| Clickable roles | `src/ai/researcher.ts` | 40 | `CLICKABLE_ROLES` set |
| Stop words | `src/ai/researcher.ts` | 38 | `DEFAULT_STOP_WORDS` array |
| Navigation ignore | `src/utils/aria.ts` | 40 | `IGNORED_CONTAINER_ROLES` set |
| Grouping prompt | `src/ai/researcher.ts` | 459 | "Group similar" instruction |
| Max elements | `src/ai/researcher.ts` | 963 | `maxElementsToExplore` default |
| Link name length | `src/utils/aria.ts` | 84 | Was 30 chars, now removed |

## Example Audit Output

```
# Research Audit Report

URL: /Commander/*/Settings/Cashiers/Dashboard
Total ARIA interactive elements: 47
Found in research output: 23
Missing: 24

## CODE FILTER ISSUES (PR material)

### [src/utils/aria.ts:81] 8x Unnamed button/link (icon-only element without aria-label)
  - button "unnamed button"
  - button "unnamed button"
  - button "unnamed button"
  ...

### [src/ai/researcher.ts:40] 5x Role "checkbox" not in CLICKABLE_ROLES
  - checkbox "Active"
  - checkbox "Visible"
  ...

### [src/ai/researcher.ts:38] 2x Name matches DEFAULT_STOP_WORDS
  - button "Close"
  - link "Back"

## PROMPT ISSUES (PR material)

Elements passed all code filters but AI did not include them:
  - button "Refresh"
  - link "Help"
  - button "Export"
```
