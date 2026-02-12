---
name: xpath-testing
description: Interactive XPath testing against HTML files in test-data/. Find elements by iteratively querying XPath expressions.
---

# XPath Testing Skill

Test XPath expressions against HTML files in `test-data/` to find specific elements. You play a "game" — given a user's request, iteratively query XPath until you find the right element and a unique XPath for it.

## Rules

- **NEVER read HTML files directly** — only use the CLI tool to query them
- You may list files in `test-data/` to see what's available
- Work iteratively: start broad, then narrow down

## Workflow

### 1. Identify Target

Ask the user:
- Which HTML file in `test-data/`? (list files if needed)
- What element are they looking for?

### 2. Explore with Broad Queries

Start with broad XPath patterns to understand the page:

```bash
bun .claude/skills/xpath-testing/xpath-query.ts test-data/<file> "//button"
bun .claude/skills/xpath-testing/xpath-query.ts test-data/<file> "//a[@href]"
bun .claude/skills/xpath-testing/xpath-query.ts test-data/<file> "//*[@role]"
```

### 3. Narrow Down

Use the tool output to refine your XPath until you find the target element. Run as many queries as needed.

### 4. Present Result

Once you find the element, present:

1. **Brief explanation** of what the element is
2. **Element outer HTML** from the tool output
3. **Unique XPath** that matches exactly 1 element

### 5. Verify Uniqueness

**MANDATORY**: Run the tool one final time with your unique XPath to confirm it returns exactly 1 result. If it returns more than 1, refine further.

## CLI Tool Reference

```bash
bun .claude/skills/xpath-testing/xpath-query.ts <html-file> <xpath-expression>
```

Exit codes:
- `0` — elements found
- `1` — no matches
- `2` — invalid XPath or error

## XPath Cheat Sheet

### Basic Element Selectors
```
//button                          All buttons
//a[@href]                        All links with href
//input                           All inputs
//select                          All select dropdowns
//form                            All forms
```

### ARIA and Accessibility
```
//*[@role='button']               Elements with button role
//*[@role='link']                 Elements with link role
//*[@role='navigation']           Navigation landmarks
//*[@aria-label]                  Elements with aria-label
//*[@aria-label='Close']          Specific aria-label
//*[@aria-expanded='true']        Expanded elements
```

### Attribute Matching
```
//input[@type='email']            Email inputs
//input[@name='username']         Input by name
//*[@id='main-content']           Element by ID
//*[contains(@class, 'btn')]      Class contains "btn"
//*[starts-with(@id, 'user-')]    ID starts with "user-"
```

### Text Content
```
//*[text()='Submit']              Exact text match
//*[contains(text(), 'Save')]     Text contains "Save"
//button[contains(., 'Delete')]   Button containing "Delete" (includes descendants)
//a[normalize-space()='Login']    Link with normalized text "Login"
```

### Structural / Combined
```
//form//input[@type='email']      Email input inside a form
//nav//a[@href]                   Links inside nav
//table//tr                       Table rows
//*[@role='dialog']//button       Buttons inside dialogs
//ul/li                           Direct child list items
//div[@class='modal']//input      Inputs inside modal div
```

### Positional
```
(//button)[1]                     First button
(//button)[last()]                Last button
//ul/li[position()<=3]            First 3 list items
//table//tr[2]/td[3]              Cell at row 2, col 3
```

### Logical Operators
```
//input[@type='text' or @type='email']    Text or email inputs
//button[not(@disabled)]                   Non-disabled buttons
//*[@role='button' and @aria-label]        Buttons with aria-label
```
