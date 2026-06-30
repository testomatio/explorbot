# Researcher Agent

The Researcher analyzes web pages to understand their structure, identify UI elements, and build UI maps with locators.

## Overview

Research gives other agents the context they need:

- **Planner** — calls the Researcher before generating test scenarios
- **Tester** — uses research results to understand page context during execution

You can also run research manually to inspect pages or debug locator issues.

## Configuration

> [!IMPORTANT]
> The Researcher processes large amounts of HTML and ARIA tokens on every call. Use a **fast, cheap model** — it does not need deep thinking, just accurate element extraction. Models like `gpt-oss-20b` via Groq or Cerebras at 100+ TPS work well. The Researcher runs with `reasoning: 'low'` by default so the output budget goes to the UI map, not the chain-of-thought.
>
> On reasoning models, reasoning tokens count against the output budget. If you hit `AI response empty: output truncated at maxTokens`, raise `maxOutputTokens`, lower `reasoning` further, or switch the Researcher to a non-reasoning model — see [Low Reasoning Effort](#low-reasoning-effort) below.

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
      reasoning: 'low', // default for the Researcher; lower to 'none' or raise as needed
    },
  },
}
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `model` | `string` | - | Override the default model for the Researcher |
| `systemPrompt` | `string` | - | Extra instructions appended to the research prompt |
| `sections` | `string[]` | all sections | Page sections to identify (order = priority) |
| `focusSections` | `string[]` | `[]` | CSS selectors that narrow research to a matching element when present (first match wins). Useful for apps that open a modal, drawer, or detail panel on top of the main layout — the Researcher maps only that element instead of the whole page. |
| `excludeSelectors` | `string[]` | `[]` | CSS selectors to exclude from deep exploration |
| `includeSelectors` | `string[]` | `[]` | CSS selectors to always explore (second pass) |
| `stopWords` | `string[]` | defaults | Words to filter during deep exploration (replaces defaults) |
| `maxElementsToExplore` | `number` | `10` | Max elements per deep exploration |
| `retries` | `number` | `2` | Retries when most locators are broken in Stage 2 |
| `reasoning` | `string` | `'low'` | Reasoning effort: `'none'`, `'minimal'`, `'low'`, `'medium'`, `'high'`, `'xhigh'`, or `'provider-default'`. Defaults to `'low'` for the Researcher. |
| `providerOptions` | `object` | - | Provider-specific options. Reasoning keys here take precedence over `reasoning`. |

See [Configuration Examples](#configuration-examples) at the end of this page for common setups.

## Usage

### CLI Mode

```bash
# Research a specific path (relative to url in config)
npx explorbot research /login
npx explorbot research /admin/users

# Research with options
npx explorbot research /dashboard --deep
npx explorbot research /products --screenshot
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

Research also runs as part of other commands:

```bash
# Planner researches the page before planning
npx explorbot plan /dashboard

# Explorer researches each new page it discovers
npx explorbot explore /admin
```

## How It Works

### Element Indexing (eidx)

Before research begins, Explorbot injects a `data-explorbot-eidx` attribute into every interactive element on the page (buttons, links, inputs, tabs, and so on). Each element gets a unique numeric index — its **eidx**.

The eidx is a stable bridge between three representations of the same element:

| Representation | What it provides | Where eidx appears |
|----------------|------------------|--------------------|
| **HTML** | Structure, attributes, CSS selectors | `<button eidx="5">Save</button>` |
| **ARIA tree** | Accessible roles, names | Mapped back via Playwright `getByRole` |
| **Screenshot** | Visual position, color, icon | Colored label `5` drawn above the element |

When the AI produces a research table with `eidx=5`, that index is used to:
- Test the element's CSS locator against the live DOM
- Look up its coordinates from the annotated screenshot
- Generate a fallback XPath if CSS is broken

Without eidx, there would be no reliable way to match "the third button in the HTML" with "the blue button at (400, 300) on the screenshot."

### The 5-Stage Pipeline

Research runs each page through five stages:

| Stage | Name | What happens |
|-------|------|--------------|
| 1 | **Research** (AI) | AI analyzes HTML and ARIA, produces a UI map with sections, containers, ARIA locators, CSS locators, and eidx references |
| 2 | **Test** | Test containers first, then element locators. Capture exact counts (`0 elements`, `3 elements`, `dynamic ID`). If all containers are broken or more than 80% of locators are broken, retry Stage 1 |
| 3 | **Fix** (AI, same conversation) | Continue the Stage 1 conversation with Playwright test results. AI fixes broken locators with full page context |
| 4 | **Visual** (optional) | Annotate the screenshot with eidx labels. AI extracts coordinates, colors, and icons. Merge into research by eidx |
| 5 | **Backfill** | Re-test all locators. For still-broken elements, look up the eidx in the DOM and generate an XPath from attributes. Nullify containers that are still broken |

Stage 3 reuses the Stage 1 conversation. The AI already has full context about the page HTML, so it fixes locators more accurately without extra token cost.

### Research Modes

#### Standard Research (HTML + ARIA)

```bash
/research
```

Analyzes the page using HTML and the ARIA tree. Fast, and works with any model.

#### Deep Research

```bash
/research --deep
```

Expands hidden elements (dropdowns, accordions, tabs) to discover more UI. Clicks through interactive elements and documents what appears. Deep research also reuses what it found on previous runs — see [Reusing Previous Results](#reusing-previous-results).

#### Research with Data Extraction

```bash
/research --data
```

Extracts domain-specific content (articles, products, users) as structured data.

## Page Sections

The Researcher breaks each page into sections by UI purpose. Sections are identified in priority order:

| Section | Description |
|---------|-------------|
| `focus` | Focused overlay (modal, drawer, popup, active form) |
| `list` | List area (items collection, table, cards, or list view) |
| `detail` | Detail area (selected item preview or full details) |
| `panes` | Screen is split into equal panes |
| `content` | Main area of the page |
| `menu` | Page menu (toolbar, context actions, filters, dropdowns) |
| `navigation` | Main navigation (top bar, sidebar, breadcrumbs) |

Each section includes:
- A **container CSS selector** that scopes all elements within it
- A **UI map table** listing interactive elements with ARIA and CSS locators

Override the default section list via `ai.agents.researcher.sections` — see [Configuration](#configuration).

## Vision Model Support

### Without Vision

The Researcher works with text-only models by analyzing HTML structure, the ARIA tree, and element roles and names. This is enough for most pages, and it is faster and cheaper.

### With Vision

With a vision model configured, the Researcher can analyze screenshots for visual elements, detect icons and visual indicators, and provide element coordinates for visual clicking.

Enable vision in config:

```javascript
ai: {
  vision: true,
  visionModel: 'gpt-4o',
}
```

Use screenshot analysis:

```bash
npx explorbot research /products --screenshot
# or in TUI
/research --screenshot
```

Vision helps most on pages with icon-only buttons, canvas-based UIs, and when the HTML doesn't reflect the visual layout.

## Deep Exploration

Deep exploration (the `--deep` flag) discovers hidden UI by clicking through elements to find modals, dropdowns, tabs, and menus.

For each element, the Researcher:
1. Captures state before the click
2. Clicks the element
3. Detects what changed (navigation, modal, menu, UI change)
4. Restores the original state (Escape key or navigate back)

### Reusing Previous Results

Hidden sections discovered by deep research are saved under an **Extended Research** block in the page's research file, together with the action that revealed each one. On the next deep run for the same page — even in a later session — the researcher builds on that instead of starting from scratch:

1. **Replay** — it re-runs the saved action for every previously found section to check it still opens.
2. **Reuse** — sections that still open are kept as-is and are not explored again, so the run spends its click budget on what is actually new.
3. **Re-discover** — if a section's trigger no longer works (the button moved or was renamed), it is flagged to the AI as "this section existed before, find it again", so a relocated control is recovered rather than lost.
4. **Skip** — when every known section still opens and the click budget is already covered, the slow click-through exploration is skipped because the page is effectively unchanged.

This makes repeated deep runs faster and stops the researcher from silently losing hidden UI it had already mapped. The reuse reads the last saved research file directly, so it works across sessions and is not limited by the in-memory [cache window](#caching).

### Filtering Elements

Not every element should be explored. The Researcher filters by:

#### 1. Role Filtering

Only clickable roles are explored: `button`, `link`, `menuitem`, `tab`, `option`, `combobox`, `switch`.

#### 2. Stop Words

Elements matching these words are skipped (word-boundary matching).

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

Research results are saved to `output/research/{hash}.md`:

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
- The XPath column appears only when CSS is broken and XPath was backfilled from the DOM
- The Coordinates column appears only when a vision model analyzed the screenshot
- The container is shown as a blockquote `> Container: '...'` before the table

## Caching

Research results are cached for 1 hour:
- In memory during the session
- On disk in `output/research/`

Use `--force` to bypass the cache:

```bash
/research --force
```

This cache controls when a fresh result is reused within a session. It is separate from how [deep research reuses previous results](#reusing-previous-results): a deep run always reloads the last saved research file from `output/research/` to replay and verify previously discovered hidden sections, regardless of the cache window or session.

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

### Focus on a Single Element

When your app opens a modal, drawer, or detail panel on top of the main layout, you usually want the Researcher to map only that overlay, not the page behind it. `focusSections` is a list of CSS selectors — the first one that matches on the current page wins, and the Researcher limits its UI map to that element:

```javascript
ai: {
  agents: {
    researcher: {
      focusSections: [
        '[role="dialog"]',   // open modal
        '.drawer-open',      // expanded side drawer
        '#focused-panel',    // your app's detail panel
      ],
    },
  },
}
```

When none of the selectors match, the Researcher falls back to mapping the whole page.

### Handling Truncated Responses

The Researcher produces a lot of output for busy pages. If the model's response is cut off at `maxOutputTokens`, Explorbot retries by splitting the work into one request per section (focus, main, sidebar, and so on) and merging the results. This usually happens transparently in the logs; no configuration is needed.

If you see it often, consider:
- lowering reasoning effort (see [Low Reasoning Effort](#low-reasoning-effort) below),
- pinning the Researcher to a non-reasoning model with a larger output window,
- or narrowing the scope with `focusSections`.

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

### Low Reasoning Effort

Reasoning tokens count toward the model's output budget. On a heavy page the chain-of-thought can consume the whole `maxOutputTokens` window before the UI map is emitted, which surfaces as `AI response empty: output truncated at maxTokens`.

The Researcher already runs with `reasoning: 'low'` by default. AI SDK 7 added a single provider-agnostic `reasoning` setting, so you can adjust it without knowing each provider's key — the SDK maps it to the active provider's effort control:

```javascript
ai: {
  agents: {
    researcher: {
      reasoning: 'none', // 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'provider-default'
    },
  },
}
```

For provider-specific control (such as a thinking-token budget), set `providerOptions` instead. These keys take precedence over the top-level `reasoning`:

```javascript
ai: {
  agents: {
    researcher: {
      providerOptions: {
        anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } },
        google:    { thinkingConfig: { thinkingBudget: 0 } }, // Gemini 2.5
      },
    },
  },
}
```

If truncation persists, pin the Researcher to a non-reasoning model. It is faster, cheaper, and has a larger effective output window for table generation:

```javascript
ai: {
  model: groq('openai/gpt-oss-20b'), // default for other agents
  agents: {
    researcher: {
      model: groq('llama-3.3-70b-versatile'), // non-reasoning, 32k output
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

- [Configuration](./configuration.md) - general configuration options
- [Agents](./agents.md) - all agent descriptions
- [Knowledge Files](../guides/knowledge.md) - domain-specific hints
