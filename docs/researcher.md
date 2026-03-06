# Researcher Agent

The Researcher agent analyzes web pages to understand their structure, identify UI elements, and create detailed UI maps with locators.

## Overview

Research provides context for test planning and execution:

- **Planner** — calls Researcher before generating test scenarios
- **Tester** — uses research results to understand page context during execution

You can also run research manually to inspect pages or debug locator issues.

## Usage

### CLI Mode

```bash
# Research a specific path (relative to url in config)
explorbot research /login
explorbot research /admin/users

# Research with options
explorbot research /dashboard --deep
explorbot research /products --screenshot
```

### TUI Mode (Interactive)

```bash
# Research current page
/research

# Research with deep expansion (clicks dropdowns, tabs, etc.)
/research --deep

# Research with data extraction
/research --data

# Research specific path
/research /login
/research /admin/pages

# Force fresh research (bypass cache)
/research --force

# Research with screenshot analysis (requires vision model)
/research --screenshot

# Skip locator validation and fixing
/research --no-fix
```

### Automatic Research

Research runs automatically as part of other commands:

```bash
# Planner researches page before planning
explorbot plan /dashboard

# Explorer researches each new page discovered
explorbot explore /admin
```

## How It Works

### Element Indexing (eidx)

Before research begins, Explorbot injects `data-explorbot-eidx` attributes into every interactive element on the page (buttons, links, inputs, tabs, etc.). Each element gets a unique numeric index — its **eidx**.

This eidx serves as a stable bridge between three different representations of the same element:

| Representation | What it provides | Where eidx appears |
|----------------|------------------|--------------------|
| **HTML** | Structure, attributes, CSS selectors | `<button eidx="5">Save</button>` |
| **ARIA tree** | Accessible roles, names | Mapped back via Playwright `getByRole` |
| **Screenshot** | Visual position, color, icon | Colored label `5` drawn above the element |

When AI produces a research table with `eidx=5`, that same index is used to:
- Test the element's CSS locator against the live DOM
- Look up its coordinates from the annotated screenshot
- Generate a fallback XPath if CSS is broken

Without eidx, there would be no reliable way to correlate "the third button in the HTML" with "the blue button at (400, 300) on the screenshot."

### The 5-Stage Pipeline

Research processes each page through 5 stages:

```
┌─────────────────────────────────────────────────────────────────┐
│  Stage 1: RESEARCH (AI)                                        │
│  AI analyzes HTML + ARIA → produces UI map with sections,      │
│  containers, ARIA locators, CSS locators, eidx references      │
├─────────────────────────────────────────────────────────────────┤
│  Stage 2: TEST                                                 │
│  Test containers first → test element locators →               │
│  capture exact counts (0 elements, 3 elements, dynamic ID)     │
│  If all containers broken → retry Stage 1                      │
│  If > 80% locators broken → retry Stage 1                      │
├─────────────────────────────────────────────────────────────────┤
│  Stage 3: FIX (AI, same conversation)                          │
│  Continue Stage 1 conversation with Playwright test results →  │
│  AI fixes broken locators with full page context               │
├─────────────────────────────────────────────────────────────────┤
│  Stage 4: VISUAL ANALYSIS (optional, requires vision model)    │
│  Annotate screenshot with eidx labels → AI extracts            │
│  coordinates, colors, icons → merge into research by eidx      │
├─────────────────────────────────────────────────────────────────┤
│  Stage 5: BACKFILL                                             │
│  Re-test all locators → for still-broken elements:             │
│  look up eidx in DOM → generate XPath from attributes          │
│  Nullify containers that are still broken                      │
└─────────────────────────────────────────────────────────────────┘
```

```mermaid
flowchart TD
    A[Annotate elements with eidx] --> B[Capture HTML + ARIA + Screenshot]

    subgraph S1 ["Stage 1: Research"]
        B --> C[AI analyzes page structure]
        C --> D[Produces UI map with sections<br/>containers, ARIA, CSS, eidx]
    end

    subgraph S2 ["Stage 2: Test"]
        D --> E[Test container locators]
        E --> F{All containers<br/>broken?}
        F -->|Yes, retries left| C
        F -->|No| G[Mark child locators of<br/>broken containers as broken]
        G --> H[Test remaining locators<br/>capture exact match counts]
        H --> I{> 80% broken?}
        I -->|Yes, retries left| C
    end

    subgraph S3 ["Stage 3: Fix"]
        I -->|No| J[Continue SAME AI conversation]
        J --> K[Send broken sections with<br/>Playwright test results]
        K --> L[AI fixes locators<br/>with full page context]
        L --> M[Re-test fixed locators]
    end

    subgraph S4 ["Stage 4: Visual Analysis"]
        M --> N{Vision model?}
        N -->|Yes| O[Draw eidx labels on screenshot]
        O --> P[AI extracts coordinates,<br/>colors, icons per eidx]
        P --> Q[Merge visual data<br/>into research by eidx]
    end

    subgraph S5 ["Stage 5: Backfill"]
        N -->|No| R
        Q --> R[Re-test all locators]
        R --> S[Look up broken elements<br/>by eidx in live DOM]
        S --> T[Generate XPath from<br/>element attributes]
        T --> U[Nullify still-broken containers]
    end

    U --> V{Deep mode?}
    V -->|Yes| W[Deep exploration]
    V -->|No| X[Cache result]
    W --> X
```

### Stage 1: Research

AI receives the page HTML (with eidx attributes) and ARIA tree. It identifies page sections (focus, content, list, menu, etc.), assigns a container CSS selector to each, and produces a UI map table listing every interactive element with ARIA and CSS locators.

The AI conversation is kept open — it will be reused in Stage 3.

### Stage 2: Test

Every locator from Stage 1 is validated against the live page using Playwright:

1. **Containers first** — each container CSS is tested via `page.locator(css).count()`. If ALL containers are broken, the entire research retries from Stage 1.
2. **Child locators of broken containers** — marked as broken immediately without testing (if the container doesn't exist, its scoped locators can't work).
3. **Remaining locators** — tested individually. Each test captures the exact element count:
   - `0 elements` — locator matches nothing
   - `3 elements` — locator is ambiguous (matches multiple)
   - `dynamic ID` — locator uses a forbidden pattern like `#ember123` or `#react-select-*`
4. **Broken ratio check** — if > 80% of locators are broken, research retries from Stage 1.

### Stage 3: Fix (Conversation Continuation)

Instead of starting a new AI call, the Researcher continues the **same conversation** from Stage 1. The AI already has full context about the page HTML and sections, so it can fix locators more accurately.

The fix prompt shows only broken sections with Playwright-style test results:

```
Some locators in your research are broken. Please fix the broken sections.

## Navigation

> Container: '.nav-bar'

Tested Elements:
- 'Home': page.locator('.nav-bar').locator('a.home') ← OK
- 'Settings': page.locator('.nav-bar').locator('a.settings-btn') ← BROKEN (0 elements)
- 'Profile': page.locator('.nav-bar').getByRole('link', { name: 'Profile' }) ← BROKEN (2 elements)

## Sidebar

> Container: '#sidebar'  ← BROKEN (container not found)

Tested Elements:
- 'Dashboard': locate('#sidebar').locator('a.dashboard') ← BROKEN (container broken)
- 'Users': locate('#sidebar').getByRole('link', { name: 'Users' }) ← BROKEN (container broken)
```

After AI returns corrected sections, they are merged back into the research and re-tested.

### Stage 4: Visual Analysis

When a vision model is configured and `--screenshot` is used:

1. **Annotate** — each eidx element gets a colored border and a numbered label on the screenshot. Section containers get dashed borders with a legend.
2. **AI vision** — the annotated screenshot is sent to the vision model, which reports coordinates, accent colors, and icon descriptions per eidx number.
3. **Merge** — visual data is matched back to research elements by eidx and added as Coordinates, Color, and Icon columns.

This is how Explorbot knows that `eidx=5` (a `<button>` in HTML) is visually a red trash icon at position (500, 300) — the eidx bridges HTML and screenshot.

### Stage 5: Backfill

All locators are re-tested one final time (catching any forbidden IDs that survived AI fixing). For elements that still have no working CSS or ARIA locator:

1. **Look up by eidx** — find the element in the live DOM using its `data-explorbot-eidx` attribute
2. **Generate XPath** — build an attribute-based XPath from the element's tag, classes, text, and other attributes
3. **Add to research** — the XPath column appears only for elements that needed this fallback

Finally, containers that are still broken after all stages are nullified — their locators are made page-global instead of container-scoped.

XPath backfill is a last resort. XPaths based on attributes are more fragile than CSS selectors but still more reliable than positional XPaths like `//body/div[2]/div[1]/button`.

### Research Modes

#### Standard Research (HTML + ARIA)

```bash
/research
```

Analyzes page using HTML and ARIA tree. Fast and works with any model.

#### Deep Research

```bash
/research --deep
```

Expands hidden elements (dropdowns, accordions, tabs) to discover more UI. Clicks through interactive elements and documents what appears.

#### Research with Data Extraction

```bash
/research --data
```

Extracts domain-specific content (articles, products, users) as structured data.

## Page Sections

The Researcher breaks pages into sections based on their UI purpose. Sections are identified in priority order:

| Section | Description |
|---------|-------------|
| `focus` | Focused overlay (modal, drawer, popup, active form) |
| `list` | List area (items collection, table, cards, or list view) |
| `detail` | Detail area (selected item preview or full details) |
| `panes` | Screen is split into equal panes |
| `content` | Main area of page |
| `menu` | Page menu (toolbar, context actions, filters, dropdowns) |
| `navigation` | Main navigation (top bar, sidebar, breadcrumbs) |

Each section includes:
- A **container CSS selector** scoping all elements within
- A **UI map table** listing interactive elements with ARIA and CSS locators

### Configuring Sections

Override the default section list via `ai.agents.researcher.sections`. This controls which sections the Researcher looks for and in what order. The Planner also uses this order when proposing tests.

```javascript
ai: {
  agents: {
    researcher: {
      // Only look for these sections, in this order
      sections: ['focus', 'content', 'list'],
    },
  },
}
```

When not set, all sections are used in the default order.

## Vision Model Support

### Without Vision

The researcher works with text-only models by analyzing:
- HTML structure and attributes
- ARIA accessibility tree
- Element roles and names

This is sufficient for most pages and is faster/cheaper.

### With Vision

When a vision model is configured, the researcher can:
- Analyze screenshots for visual elements
- Detect icons, images, and visual indicators
- Provide element coordinates for visual clicking
- Answer questions about what's displayed

Enable vision in config:

```javascript
ai: {
  vision: true,
  visionModel: 'gpt-4o',  // or any vision-capable model
}
```

Use screenshot analysis:

```bash
explorbot research /products --screenshot
# or in TUI
/research --screenshot
```

Vision is particularly useful for:
- Pages with icon-only buttons
- Canvas-based UIs
- When HTML doesn't reflect visual layout
- Debugging element location issues

## Deep Exploration

Deep exploration (`--deep` flag) discovers hidden UI by clicking through elements to find **modals, dropdowns, tabs, and menus**:

```
[1/10] Exploring: "Settings" (button) → opened modal
[2/10] Exploring: "Help" (link) → navigated to /help
[3/10] Exploring: "More" (menuitem) → opened menu
...
```

```mermaid
flowchart TD
    A[/"DEEP EXPLORATION --deep<br/>(modals, dropdowns, tabs, menus)"/] --> B
    B[Collect Elements from ARIA Tree<br/>buttons, links, tabs, menuitems] --> C
    C[Filter Elements<br/>stop words, excluded selectors<br/>limit to max 10] --> D

    subgraph LOOP ["Exploration Loop (up to 10 elements)"]
        D{More elements?} -->|Yes| E[Click Element]
        E --> F[Detect Change<br/>navigation / modal / menu / tab]
        F --> G[Record Result]
        G --> H[Restore State<br/>Escape or Navigate Back]
        H --> D
    end

    D -->|No| I[Explore Include Selectors<br/>second pass for .action-menu, #toolbar]
    I --> J[/"RESULTS TABLE<br/>Element | Role | Result"/]
```

For each element, the researcher:
1. Captures state before click
2. Clicks the element
3. Detects what changed (navigation, modal, menu, UI change)
4. Restores original state (Escape key or navigate back)

### Filtering Elements

Not all elements should be explored. The researcher filters by:

#### 1. Role Filtering

Only clickable roles are explored:
- `button`, `link`, `menuitem`, `tab`
- `option`, `combobox`, `switch`

#### 2. Stop Words

Elements matching these words are skipped (word-boundary matching):

**Default stop words:**
- `close`, `cancel`, `dismiss`, `exit`, `back`
- `cookie`, `consent`, `gdpr`, `privacy`
- `accept all`, `decline all`, `reject all`
- `share`, `print`, `download`


#### 3. CSS Selector Exclusion

Skip elements inside specific containers:

```javascript
researcher: {
  excludeSelectors: ['.cookie-banner', '#chat-widget', '[data-ad]'],
}
```

#### 4. CSS Selector Inclusion

Always explore elements inside specific containers (second pass):

```javascript
researcher: {
  includeSelectors: ['.action-menu', '#toolbar'],
}
```

## Configuration

```javascript
ai: {
  agents: {
    researcher: {
      // Standard agent options
      model: 'gpt-4o',
      systemPrompt: 'Focus on form validation elements...',

      // Page sections (order matters)
      sections: ['focus', 'content', 'list', 'menu', 'navigation'],

      // Exploration filtering
      excludeSelectors: ['.cookie-banner'],
      includeSelectors: ['.dropdown-menu'],
      stopWords: ['cookie', 'share'],
      maxElementsToExplore: 15,

      // Retry count when >80% locators are broken
      retries: 2,
    },
  },
}
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | - | Override default model |
| `systemPrompt` | `string` | - | Additional instructions |
| `sections` | `string[]` | all sections | Page sections to identify (order = priority) |
| `excludeSelectors` | `string[]` | `[]` | CSS selectors to exclude from deep exploration |
| `includeSelectors` | `string[]` | `[]` | CSS selectors to always explore |
| `stopWords` | `string[]` | defaults | Words to filter (replaces defaults) |
| `maxElementsToExplore` | `number` | `10` | Max elements per deep exploration |
| `retries` | `number` | `2` | Retries when most locators are broken |

## Configuration Examples

### Skip Cookie Banners and Ads

```javascript
ai: {
  agents: {
    researcher: {
      excludeSelectors: [
        '.cookie-banner',
        '.cookie-consent',
        '#gdpr-modal',
        '[data-ad]',
        '.advertisement',
      ],
    },
  },
}
```

### Focus on Specific Areas

```javascript
ai: {
  agents: {
    researcher: {
      includeSelectors: [
        '.main-content',
        '#app-toolbar',
        '[data-testid="action-menu"]',
      ],
      excludeSelectors: [
        'nav',
        'footer',
        '.sidebar',
      ],
    },
  },
}
```

### Limit Sections

```javascript
ai: {
  agents: {
    researcher: {
      // Only research these sections, skip navigation and menu
      sections: ['focus', 'content', 'list', 'detail'],
    },
  },
}
```

### Custom Stop Words

```javascript
ai: {
  agents: {
    researcher: {
      // Replace defaults entirely
      stopWords: ['cookie', 'newsletter', 'subscribe'],
    },
  },
}
```

### Disable Text Filtering

```javascript
ai: {
  agents: {
    researcher: {
      stopWords: [],  // Empty array disables filtering
    },
  },
}
```

### Explore More Elements

```javascript
ai: {
  agents: {
    researcher: {
      maxElementsToExplore: 25,
    },
  },
}
```

### Custom Component Guidance

```javascript
ai: {
  agents: {
    researcher: {
      systemPrompt: `
        This app uses custom components:
        - <DataGrid> renders as div with role="grid"
        - <Modal> uses [data-modal] attribute
        - Dropdowns have [data-dropdown] attribute

        Look for data-testid attributes for reliable selectors.
      `,
    },
  },
}
```

### Vision-Heavy Research

```javascript
ai: {
  vision: true,
  visionModel: 'gpt-4o',
  agents: {
    researcher: {
      systemPrompt: `
        Pay attention to:
        - Icon buttons without text labels
        - Color indicators (red = error, green = success)
        - Visual hierarchy and spacing
      `,
    },
  },
}
```

## Output Format

Research results are saved to `output/research/{hash}.md` and include:

```markdown
## Summary

Brief description of the page purpose.

## Focus Section

Modal dialog for user login...

> Container: '[role="dialog"]'

| Element | ARIA | CSS |
|---------|------|-----|
| 'Email' | { role: 'textbox', text: 'Email' } | 'input#email' |
| 'Password' | { role: 'textbox', text: 'Password' } | 'input[name="password"]' |
| 'Sign In' | { role: 'button', text: 'Sign In' } | 'button[type="submit"]' |

## Content Section

Main content area...

> Container: '.main-content'

| Element | ARIA | CSS | XPath | Coordinates |
|---------|------|-----|-------|-------------|
| 'Save' | { role: 'button', text: 'Save' } | 'button.save' | - | (400, 300) |
| 'Delete' | { role: 'button', text: 'Delete' } | - | '//button[@class="del"]' | (500, 300) |
```

Notes:
- XPath column only appears when CSS is broken and XPath was backfilled from the DOM
- Coordinates column only appears when vision model analyzed the screenshot
- Container is shown as a blockquote `> Container: '...'` before the table

## Caching

Research results are cached for 1 hour:
- In memory during session
- On disk in `output/research/`

Use `--force` to bypass cache:

```bash
/research --force
```

## See Also

- [Configuration](./configuration.md) - General configuration options
- [Agents](./agents.md) - All agent descriptions
- [Knowledge Files](./knowledge.md) - Domain-specific hints
