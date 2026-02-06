# Page Interaction Model

Explorbot agents interact with web pages using a multi-layered approach that combines accessibility data, HTML structure, visual analysis, and CodeceptJS commands.

## The Three-Layer Context

Agents receive page context through three complementary sources:

```
┌─────────────────────────────────────────────────────────────┐
│                     Page Understanding                       │
├─────────────────┬─────────────────┬─────────────────────────┤
│   ARIA Snapshot │   HTML Content  │      Screenshot         │
│   (Structure)   │    (Details)    │      (Visual)           │
├─────────────────┼─────────────────┼─────────────────────────┤
│ • Roles         │ • Attributes    │ • Layout                │
│ • Labels        │ • Classes       │ • Colors                │
│ • States        │ • Data attrs    │ • Icons                 │
│ • Hierarchy     │ • Form fields   │ • Coordinates           │
└─────────────────┴─────────────────┴─────────────────────────┘
```

### ARIA Snapshot

The accessibility tree provides semantic structure:
- Element roles (button, textbox, link, etc.)
- Accessible names and labels
- States (expanded, checked, disabled)
- Hierarchical relationships

Used for: Locator generation, understanding page structure, identifying interactive elements.

### HTML Content

Processed HTML provides detailed attributes:
- CSS classes and IDs
- Data attributes
- Form field names and values
- Custom components

Used for: Precise locator construction, form field identification, state verification.

#### HTML Filtering

Agents primarily use the `combined` HTML snapshot, which can be configured to exclude noisy elements:

```javascript
// explorbot.config.js
html: {
  combined: {
    include: ['*'],
    exclude: ['script', 'style', 'svg', '.cookie-banner', '.analytics-tracker']
  }
}
```

| Snapshot Type | Purpose | Config Key |
|---------------|---------|------------|
| `combined` | Main HTML for agents (interactive + semantic elements) | `html.combined` |
| `minimal` | Focused on interactive elements only | `html.minimal` |
| `text` | Text content extraction | `html.text` |

> [!TIP]
> Filter out noisy elements like cookie banners, analytics widgets, and ads to reduce token usage and improve agent focus.

**Common exclusions:**

```javascript
html: {
  combined: {
    exclude: [
      'script', 'style', 'svg', 'noscript',
      '.cookie-consent', '.cookie-banner',
      '.chat-widget', '.intercom-*',
      '.analytics-*', '.tracking-*',
      '[data-testid="ads"]'
    ]
  }
}
```

### Screenshots (Vision Model)

Visual analysis adds spatial awareness:
- Element coordinates for click fallbacks
- Icon and image recognition
- Layout understanding
- Visual state verification

Used for: Fallback interactions, visual verification, understanding custom components.

## Research & UI Maps

Before testing, the **Researcher agent** analyzes pages and produces UI Maps — structured reports of all interactive elements organized by sections.

### Section Types

Pages are broken down into semantic sections:

| Section | Description |
|---------|-------------|
| `focus` | Active overlays — modals, drawers, popups |
| `list` | Item collections — tables, cards, lists |
| `detail` | Selected item preview or details |
| `panes` | Split-screen layouts |
| `content` | Main page content |
| `menu` | Navigation areas |

### UI Map Format

Each section includes a container locator and element table:

```markdown
## Focus Section

Login modal dialog for user authentication.

Section Container CSS Locator: '[role="dialog"]'

Elements:

| Element | ARIA | CSS | XPath | Coordinates |
|---------|------|-----|-------|-------------|
| 'Email' | { role: 'textbox', text: 'Email' } | '[role="dialog"] input[name="email"]' | //div[@role="dialog"]//input[@name="email"] | (400, 280) |
| 'Password' | { role: 'textbox', text: 'Password' } | '[role="dialog"] input[name="password"]' | //div[@role="dialog"]//input[@name="password"] | (400, 340) |
| 'Sign In' | { role: 'button', text: 'Sign In' } | '[role="dialog"] button[type="submit"]' | //div[@role="dialog"]//button[@type="submit"] | (400, 400) |
```

Agents use UI Maps to:
- Understand page purpose and structure
- Select appropriate locators for elements
- Scope interactions to specific sections
- Navigate complex layouts

## CodeceptJS Integration

All browser interactions execute through CodeceptJS 4.0 with Playwright backend.

### Available Commands

**Click interactions:**
```javascript
I.click('Submit')                           // By text
I.click({ role: 'button', text: 'Save' })   // By ARIA
I.click('#submit-btn')                       // By CSS
I.click('//button[@type="submit"]')          // By XPath
I.click('Delete', '.row-1')                  // With container
I.clickXY(400, 300)                          // By coordinates
```

**Form interactions:**
```javascript
I.fillField('Email', 'user@example.com')    // Fill input
I.type('Hello world')                        // Type into focused element
I.selectOption('Country', 'USA')             // Select dropdown
I.pressKey('Enter')                          // Press key
I.pressKey(['Control', 'a'])                 // Key combination
```

**Assertions:**
```javascript
I.see('Welcome')                             // Text visible
I.seeElement('.success-message')             // Element exists
I.seeInField('Email', 'user@example.com')    // Field value
I.seeInCurrentUrl('/dashboard')              // URL check
```

**Navigation:**
```javascript
I.amOnPage('/login')                         // Navigate to URL
I.switchTo('#iframe')                        // Enter iframe
I.switchTo()                                 // Exit iframe
```

### Tool Execution Flow

When an agent calls a tool like `click()`:

```
Agent Decision
     │
     ▼
┌─────────────────┐
│   Tool Call     │  click({ commands: [...], explanation: "..." })
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Try Commands   │  I.click({role:'button',text:'Save'})
│  In Order       │  I.click('Save', '.modal')
│                 │  I.click('#save-btn')
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Capture State   │  New ARIA + HTML + Screenshot
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Compute Diff   │  Compare before/after states
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Return Result   │  { success, pageDiff, code, ... }
└─────────────────┘
```

## State Tracking & Diffs

After every action, Explorbot captures the new page state and computes what changed.

### Page Diff

The `pageDiff` object tells agents what changed:

```javascript
{
  urlChanged: true,
  currentUrl: '/dashboard',
  ariaChanges: 'Modal closed, dashboard content now visible',
  htmlChanges: 'New elements: .welcome-banner, .user-stats'
}
```

Agents use diffs to:
- Verify actions had expected effect
- Detect unexpected navigation
- Understand page state changes
- Decide next steps

### State Hash

Each unique page state gets a hash based on URL + content. This enables:
- Caching research results
- Detecting loops (same state visited repeatedly)
- Tracking navigation history

### Dead Loop Detection

If the agent keeps returning to the same state without progress:

```
State A → Action → State A → Action → State A
                   ↑
            Dead loop detected!
```

The system detects this and prompts the agent to try a different approach or stop.

## Locator Priority

Agents follow a strict priority when selecting locators:

1. **ARIA with container** — Most reliable, scoped to section
   ```javascript
   I.click({ role: 'button', text: 'Save' }, '.modal')
   ```

2. **Text with container** — Human-readable, scoped
   ```javascript
   I.click('Save', '.modal')
   ```

3. **ARIA alone** — Semantic, accessible
   ```javascript
   I.click({ role: 'button', text: 'Save' })
   ```

4. **CSS/XPath** — Precise but brittle
   ```javascript
   I.click('#save-btn')
   ```

5. **Coordinates** — Last resort fallback
   ```javascript
   I.clickXY(400, 300)
   ```

## Tool Categories

### Action Tools

Modify page state:
- `click()` — Click elements with multiple locator strategies
- `type()` — Type text into inputs
- `select()` — Select dropdown options
- `pressKey()` — Press keyboard keys
- `form()` — Execute multiple commands in sequence

### Observation Tools

Read page state:
- `see()` — Visual analysis of screenshot
- `context()` — Get fresh ARIA + HTML
- `research()` — Full UI map analysis
- `verify()` — Assert condition on page

### Flow Control Tools

Manage test execution:
- `record()` — Log notes and findings
- `finish()` — Complete test successfully
- `stop()` — Abort incompatible test
- `reset()` — Return to initial page

## Error Recovery

When actions fail, agents automatically:

1. **Try alternative locators** — Each tool accepts multiple commands
2. **Analyze the error** — Understand why it failed
3. **Use fallbacks** — Visual click, different strategies
4. **Ask for help** — In interactive mode, prompt user

Example recovery flow:
```
click({ role: 'button', text: 'Submit' })  → Failed: element not found
click('Submit', '.form-footer')            → Failed: container not found
click('#submit-btn')                       → Failed: element not visible
visualClick('Submit button in form')       → Success at (450, 380)
```

## Integration with Experience

Successful interactions are saved to experience files:
- Which locators worked
- What state changes occurred
- Recovery strategies that succeeded

On subsequent runs, agents load relevant experience to:
- Prefer known-working locators
- Anticipate state changes
- Apply learned recovery strategies

## See Also

- [Knowledge Files](knowledge.md) - Teach Explorbot about your app
- [Agent Hooks](hooks.md) - Custom code before/after agent execution
- [Configuration](configuration.md) - Full configuration reference
