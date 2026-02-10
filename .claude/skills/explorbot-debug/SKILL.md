---
name: explorbot-debug
description: Debug failed Explorbot interactions. Analyzes Langfuse traces or log files to find why tests failed and suggests Knowledge fixes.
---

# Explorbot Debug

Debug failed Explorbot test sessions by analyzing execution traces.

## Step 1: Acquire Session Data

**Goal:** Get the `explorbot.log` and the corresponding Langfuse trace JSON.

### 1. Analyze Log Timeline

First, read the end of `output/explorbot.log` to determine the time range of the last session.

```bash
tail -n 1000 output/explorbot.log
```

Identify:
- The last `=== ExplorBot Session Started` timestamp.
- The final log entry timestamp.
- Calculate the duration/range (e.g., "30m", "1h").

Key log patterns to look for:
- `=== ExplorBot Session Started` -- session start
- `[STEP] I.amOnPage(...)` -- navigation
- `AI Navigator resolving state` -- navigator AI triggered
- `[ERROR] Attempt failed` -- failed browser actions
- `Testing scenario:` -- test start

### 2. Locate or Export Langfuse Traces

Check if a recent Langfuse export already exists and covers the session time:

```bash
ls -lt output/langfuse-export-*.json | head -n 1
```

**If a recent JSON file exists** (created after the session start):
- Use this file for analysis.

**If NO recent JSON file exists**:

1. Try to run the export script using the duration calculated from the logs:
   ```bash
   # <range> can be 30m, 1h, etc.
   bun .claude/skills/explorbot-debug/langfuse-export.ts <range>
   ```
   *Note: If the script fails (e.g., due to missing credentials or network issues), proceed with **Log Analysis Only**.*

### 3. Load and Correlate

You should now have:
1. `output/explorbot.log` (Browser/System events)
2. `output/langfuse-export-....json` (AI reasoning/Prompts) - *Optional but recommended*

**Crucial Step:** Correlate the logs with the JSON.

| Source | Contains |
|--------|----------|
| **Langfuse JSON** | AI prompts, AI responses, tool call inputs/outputs, token usage |
| **`output/explorbot.log`** | Browser startup, navigation steps, errors, state transitions |

Match events by timestamp:
1. Find `=== ExplorBot Session Started` in log.
2. Match `navigator.loop` traces in JSON with log `AI Navigator resolving state`.
3. Match `tester.loop` traces in JSON with log `Testing scenario:`.

#### Analyzing the JSON (Optional)

Useful `jq` commands:
```bash
jq '.[].name' <file>                                      # list trace names
jq '[.[] | select(.tags | index("researcher"))]' <file>    # filter by tag
jq '.[0].observations[] | {name, startTime, level}' <file> # observation summary
jq '[.[].observations[] | select(.type == "GENERATION") | {name, model, input: (.input | length), output: (.output | length)}]' <file>
```

### Log file only (fallback)

If Langfuse is not configured or no JSON available, read `output/explorbot.log` only.
This gives browser-level detail but no AI prompts/responses.

## Step 2: Identify Issues

Analyze using **both sources** when available:
- **From JSON**: What did the AI see? What prompt did it receive? What did it respond? Did it pick the right tool?
- **From logs**: What actually happened in the browser? Did navigation fail? Were there errors? Did setup scripts run?

Look for **mismatches** between what the AI decided (JSON) and what actually happened (logs).
For example: AI says "click succeeded" in its response, but log shows an error after the click.

Analyze the session for these failure patterns:

### Missing Context 🔍

AI made wrong decisions because it lacked information about the page.

**Symptoms:**
- Clicked wrong element (multiple similar elements)
- Didn't know about hidden content (modals, dropdowns)
- Wrong assumptions about form behavior
- Didn't understand special controls (editors, custom widgets)

**Example:** AI clicked "Delete" in wrong table row because it didn't know about container context.

### Wrong Prompts 📝

AI made incorrect assumptions based on how prompts were structured.

**Symptoms:**
- Misunderstood the scenario goal
- Tried impossible actions
- Wrong priority of elements to interact with
- Didn't follow expected user flow

**Example:** AI tried to create user before logging in because prompt didn't mention auth requirement.

### Wrong Tool Choice 🔧

AI picked incorrect tool for the situation.

**Symptoms:**
- Used `click()` when `form()` was needed
- Used `type()` without focusing element first
- Used `pressKey()` for multi-character input
- Didn't use container context when multiple elements matched

**Example:** AI used standard `type()` on a rich text editor that needed special handling.

## Step 3: Suggest Knowledge Fix

Based on the identified issues, suggest creating a **Knowledge file**.

### Knowledge File Structure

```markdown
---
url: /path/pattern/*
wait: 1  # optional: seconds to wait after page load
---

[Instructions for AI when visiting this page]
```

### URL Patterns

Recommend **general patterns** over specific URLs:

| Instead of | Use |
|------------|-----|
| `/users/123` | `/users/*` |
| `/projects/my-proj/settings` | `/projects/*/settings` |
| `/admin/users/edit/5` | `/admin/users/*` |

This way knowledge applies to all similar pages.

### What to Include in Knowledge

**1. Credentials (if auth needed):**
```markdown
Login credentials:
- email: admin@example.com
- password: secret123
```

**2. Framework quirks:**
```markdown
## Framework Notes
App uses [Framework]. Avoid auto-generated IDs.
Prefer ARIA selectors or data-test attributes.
```

**3. Rich Text Editors:**

Editors like Monaco, TinyMCE, CKEditor, Quill, ProseMirror, or Block Editors often need special handling:

```markdown
## Text Editor

The content editor requires special interaction:

\`\`\`
[Provide CodeceptJS code for this specific editor]
[May need: iframe switching, click to focus, clear content, etc.]
\`\`\`
```

Analyze the editor type and provide appropriate instructions. Common patterns:
- **Iframe-based:** Need `I.switchTo()` before interaction
- **ContentEditable:** May need click + select all + type
- **Block editors:** May need clicking specific blocks first

**4. Custom Controls:**

Dropdowns, sliders, date pickers, and custom widgets often need guidance:

```markdown
## Custom Dropdown
This dropdown doesn't use standard <select>.
Click to open, then click option by text:

\`\`\`
I.click('.dropdown-trigger')
I.click('Option Text', '.dropdown-menu')
\`\`\`

## Slider Control
Slider requires drag or keyboard:

\`\`\`
I.click('.slider-handle')
I.pressKey('ArrowRight')  // Increase value
\`\`\`

## Date Picker
Calendar popup needs specific interaction:

\`\`\`
I.click('.date-input')
I.click('15', '.calendar-popup')  // Select day
\`\`\`
```

**5. UI explanations:**
```markdown
## Form Behavior
Submit button is disabled until all required fields valid.
Error messages appear below each field.
```

**6. Business context:**
```markdown
## User Roles
- Admin: can create/delete users
- Editor: can only edit content
- Viewer: read-only access

Test scenarios should respect these permissions.
```

**7. Container disambiguation:**
```markdown
## Table Actions
Each row has Edit/Delete buttons. Always use container:
I.click('Delete', '.user-row-{id}')
```

## Step 4: Create the Knowledge File

Generate the knowledge file content and ask user to save it:

```bash
# Save to knowledge directory
cat > knowledge/<page_name>.md << 'EOF'
---
url: /your/pattern/*
---

[Generated content]
EOF
```

Or use Explorbot's CLI:
```bash
explorbot know "/url/pattern/*" "Your knowledge description"
```

## Step 5: Verify Fix

After knowledge is added, suggest:

1. Run the same scenario again
2. Check if AI now makes correct decisions
3. If still failing, add more specific knowledge

## Common Controls Needing Knowledge

When these are detected in failed sessions, suggest adding knowledge:

| Control Type | Common Issues | Knowledge Needed |
|-------------|---------------|------------------|
| Rich text editors | Can't type, wrong focus | Editor-specific interaction code |
| Custom dropdowns | Can't select, element not found | Open/select sequence |
| Date/time pickers | Can't set value | Calendar interaction steps |
| Sliders/ranges | Can't change value | Drag or keyboard approach |
| File uploads | Can't attach | Input selector or drop zone |
| Autocomplete | Suggestions not selected | Type + wait + select pattern |
| Modals/dialogs | Actions outside blocked | Wait for modal, close sequence |
| Tabs/accordions | Content hidden | Click to expand first |
| Drag & drop | Can't reorder | Specific drag approach |
| Canvas elements | Can't interact | Coordinate-based clicks |

## Step 6: Try It Yourself (Optional)

If you have **browser tools available** (Playwright MCP, browser agent, or similar), you can:

1. Open the page where the issue occurred
2. Try different interaction approaches
3. **If successful, document as CodeceptJS code**

### Writing CodeceptJS Solutions

When you find a working approach, write it as CodeceptJS code for the knowledge file.

**Available Commands:**

```javascript
// Clicking
I.click('Button Text');                              // By text
I.click({ role: 'button', text: 'Submit' });         // By ARIA (preferred)
I.click('Submit', '.modal-content');                 // With container context
I.click('#submit-btn');                              // By CSS
I.click('//form//button[@type="submit"]');           // By XPath

// Filling fields
I.fillField('Username', 'john');                     // By label/name/placeholder
I.fillField({ role: 'textbox', text: 'Email' }, 'test@example.com');

// Typing (into focused element)
I.type('text to enter');                             // Types into active element

// Key presses
I.pressKey('Enter');
I.pressKey('Escape');
I.pressKey(['Control', 'a']);                        // Select all
I.pressKey(['Meta', 'a']);                           // Cmd+A on Mac

// Dropdowns
I.selectOption('Country', 'United States');
I.selectOption({ role: 'combobox', text: 'Select' }, 'Option');

// Iframes
I.switchTo('#editor-iframe');                        // Enter iframe
I.switchTo();                                        // Exit iframe
```

**Locator Priority:**

1. **ARIA** (most reliable): `{ role: 'button', text: 'Save' }`
2. **Text** (if unique): `'Login'`
3. **CSS** (with context): `I.click('Delete', '.user-row-123')`
4. **XPath** (last resort): `'//form[@id="login"]//button'`

**Avoid:**
- Auto-generated IDs (`#ember123`, `#react-select-2`)
- Positional XPath (`//div[2]/div[3]`)
- Framework-specific selectors
- CSS pseudo-classes (`:contains`, `:first`)

### Example: Figuring Out a Rich Text Editor

1. Open page with browser tools
2. Try: click editor → type text → observe what happens
3. If editor is in iframe:
   ```javascript
   I.switchTo('.editor-container iframe')
   I.click('//body')
   I.pressKey(['Control', 'a'])
   I.type('New content here')
   I.switchTo()
   ```
4. Add this to knowledge file for that URL pattern

### Example: Custom Dropdown

1. Open page, inspect dropdown behavior
2. Try: click trigger → wait for menu → click option
3. Document working approach:
   ```javascript
   I.click('.dropdown-trigger')
   I.click('Option Text', '.dropdown-menu')
   ```

## Quick Reference

| Issue Type | Knowledge Solution |
|------------|-------------------|
| Wrong element clicked | Add container/disambiguation rules |
| Form not submitted | Add CodeceptJS code block for flow |
| Auth required | Add credentials |
| Iframe content | Add switchTo() instructions |
| Dynamic IDs | Add "avoid these selectors" warning |
| Timing issues | Add `wait: N` to frontmatter |
| Business logic | Explain expected behavior |
| Custom control | Provide interaction code block |
