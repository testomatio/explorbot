# Researcher Agent

The Researcher agent analyzes web pages to understand their structure, identify UI elements, and create detailed UI maps with locators.

## Overview

Research provides context for test planning and execution:

- **Planner** — calls Researcher before generating test scenarios
- **Tester** — uses research results to understand page context during execution

You can also run research manually to inspect pages or debug locator issues.

## Configuration

> [!IMPORTANT]
> The Researcher processes large amounts of HTML and ARIA tokens on every call. Use a **fast, cheap model with low reasoning effort** — it does not need deep thinking, just accurate element extraction. Models like `gpt-oss-20b` via Groq/Cerebras at 100+ TPS are ideal. Set `providerOptions` to reduce reasoning effort if your model supports it.

```javascript
ai: {
  agents: {
    researcher: {
      model: groq('gpt-oss-20b'),
      systemPrompt: 'Focus on form validation elements...',
      sections: ['focus', 'content', 'list'],
      excludeSelectors: ['.cookie-banner'],
      includeSelectors: ['.dropdown-menu'],
      stopWords: ['cookie', 'share'],
      maxElementsToExplore: 15,
      retries: 2,
      providerOptions: { groq: { reasoningEffort: 'low' } },
    },
  },
}
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | - | Override default model for Researcher |
| `systemPrompt` | `string` | - | Additional instructions appended to the research prompt |
| `sections` | `string[]` | all sections | Page sections to identify (order = priority) |
| `excludeSelectors` | `string[]` | `[]` | CSS selectors to exclude from deep exploration |
| `includeSelectors` | `string[]` | `[]` | CSS selectors to always explore (second pass) |
| `stopWords` | `string[]` | defaults | Words to filter during deep exploration (replaces defaults) |
| `maxElementsToExplore` | `number` | `10` | Max elements per deep exploration |
| `retries` | `number` | `2` | Retries when most locators are broken in Stage 2 |
| `providerOptions` | `object` | - | Provider-specific options (e.g. reasoning effort) |

See [Configuration Examples](#configuration-examples) at the end of this document for common setups.

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

| Stage | Name | What happens |
|-------|------|--------------|
| 1 | **Research** (AI) | AI analyzes HTML + ARIA, produces UI map with sections, containers, ARIA locators, CSS locators, eidx references |
| 2 | **Test** | Test containers first, then element locators. Capture exact counts (`0 elements`, `3 elements`, `dynamic ID`). If all containers broken or >80% locators broken — retry Stage 1 |
| 3 | **Fix** (AI, same conversation) | Continue Stage 1 conversation with Playwright test results. AI fixes broken locators with full page context |
| 4 | **Visual** (optional) | Annotate screenshot with eidx labels. AI extracts coordinates, colors, icons. Merge into research by eidx |
| 5 | **Backfill** | Re-test all locators. For still-broken elements: look up eidx in DOM, generate XPath from attributes. Nullify containers that are still broken |

Stage 3 reuses the Stage 1 conversation — the AI already has full context about the page HTML, so it fixes locators more accurately without extra token cost.

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

Override the default section list via `ai.agents.researcher.sections` — see [Configuration](#configuration).

## Vision Model Support

### Without Vision

The researcher works with text-only models by analyzing HTML structure, ARIA tree, element roles and names. This is sufficient for most pages and is faster/cheaper.

### With Vision

When a vision model is configured, the researcher can analyze screenshots for visual elements, detect icons and visual indicators, provide element coordinates for visual clicking.

Enable vision in config:

```javascript
ai: {
  vision: true,
  visionModel: 'gpt-4o',
}
```

Use screenshot analysis:

```bash
explorbot research /products --screenshot
# or in TUI
/research --screenshot
```

Vision is particularly useful for pages with icon-only buttons, canvas-based UIs, and when HTML doesn't reflect visual layout.

## Deep Exploration

Deep exploration (`--deep` flag) discovers hidden UI by clicking through elements to find modals, dropdowns, tabs, and menus.

For each element, the researcher:
1. Captures state before click
2. Clicks the element
3. Detects what changed (navigation, modal, menu, UI change)
4. Restores original state (Escape key or navigate back)

### Filtering Elements

Not all elements should be explored. The researcher filters by:

#### 1. Role Filtering

Only clickable roles are explored: `button`, `link`, `menuitem`, `tab`, `option`, `combobox`, `switch`.

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

## See Also

- [Configuration](./configuration.md) - General configuration options
- [Agents](./agents.md) - All agent descriptions
- [Knowledge Files](./knowledge.md) - Domain-specific hints
