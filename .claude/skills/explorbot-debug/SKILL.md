---
name: explorbot-debug
description: Debug failed Explorbot interactions. Analyzes Langfuse exports or log files to find why tests failed and suggests Knowledge fixes.
---

# Explorbot Debug

Debug failed Explorbot test sessions by analyzing execution traces.

## Step 1: Get Session Data

Ask the user:

> Please provide ONE of:
> 1. **Langfuse JSON export** — Path to exported `tester.loop` trace from Langfuse
> 2. **Nothing** — I'll analyze `output/explorbot.log` for the latest session

### If JSON file provided:

Use jq to extract key information:

```bash
# Get all tool calls and their results
jq '[.spans[] | select(.name | startswith("ai.toolCall")) | {tool: .name, input: .input, output: .output}]' <file>

# Get prompts sent to AI
jq '[.spans[] | select(.name == "ai.generateText") | .input.messages[-1].content]' <file>

# Find failed tool calls
jq '[.spans[] | select(.output.success == false)]' <file>

# Get page URLs visited
jq '[.spans[] | select(.input.url) | .input.url] | unique' <file>
```

### If no file provided:

Read `output/explorbot.log` and find the latest session by looking for:
- `Testing scenario:` — session start
- `Test finished` or `Test stopped` — session end
- Tool calls and their results
- Error messages

## Step 2: Identify Issues

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
