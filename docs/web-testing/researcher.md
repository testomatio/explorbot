# Researcher Agent

The Researcher analyzes web pages to understand their structure, identify UI elements, and build UI maps with locators.

## Overview

Research gives other agents the context they need:

- **Planner** — calls the Researcher before generating test scenarios
- **Tester** — uses research results to understand page context during execution

You can also run research manually to inspect pages or debug locator issues.

## Configuration

> [!IMPORTANT]
> The Researcher processes large amounts of HTML and ARIA tokens on every call. Use a **fast, cheap model** — it does not need deep thinking, just accurate element extraction. Models like `gpt-oss-20b` via Groq or Cerebras at 100+ TPS work well. On reasoning models the Researcher runs at low reasoning effort by default — see [Reasoning Effort](#reasoning-effort).

```javascript
ai: {
  agents: {
    researcher: {
      model: groq('openai/gpt-oss-20b'),
      systemPrompt: 'Focus on form validation elements...',
      sections: ['overlay', 'content', 'list'],
      maxExpandableClicks: 10,
      retries: 2,
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
| `focusSections` | `string[]` | `[]` | CSS selectors used in the truncated-response fallback, when research is split into per-section requests (first match wins). The matching element becomes the container for the focused section — see [Handling Truncated Responses](#handling-truncated-responses). |
| `maxExpandableClicks` | `number` | `10` | Max expandable elements clicked during deep research |
| `errorPageTimeout` | `number` | `10` | Seconds to wait for the page to settle before research; error pages detected during this wait abort research. Set `0` to skip the wait |
| `retries` | `number` | `2` | Retries when most locators are broken in Stage 2 |
| `reasoning` | `string` | `'low'` | AI SDK v7 reasoning effort: `'none'`, `'minimal'`, `'low'`, `'medium'`, `'high'`, `'xhigh'`, `'provider-default'` |
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
npx explorbot research /products --data
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

# Skip locator validation and fixing
/research --no-fix
```

Explicit research always runs fresh (bypassing the [cache](#caching)) and always captures a screenshot.

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
| `overlay` | Dialog, modal, drawer, popup, or active form overlay |
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

Enable vision by configuring a vision model instance:

```javascript
ai: {
  visionModel: openai('gpt-4o'),
}
```

Explicit research always captures a screenshot; when a vision model is configured, the screenshot is analyzed in Stage 4.

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

### Selecting Elements

Not every element should be explored. During deep analysis the AI itself discovers expandable candidates from the research results — and from the annotated screenshot when a vision model is configured — picking elements that hide content until clicked (menus, dropdowns, accordions, tabs) and skipping regular links and navigation. Repeated controls, like the same expand button on every list row, collapse to a single representative. When more candidates are found than the click budget allows, the AI selects the most promising ones. The budget is set by `maxExpandableClicks` (default 10).

## Output Format

Research results are saved to `output/research/{hash}.md`:

```markdown
## Summary

Brief description of the page purpose.

## Login Modal

Modal dialog for user login...

> Container: '[role="dialog"]'
> **Focused**

| Element | Type | ARIA | CSS |
|---------|------|------|-----|
| 'Email' | textbox | { role: 'textbox', text: 'Email' } | 'input#email' |
| 'Password' | textbox | { role: 'textbox', text: 'Password' } | 'input[name="password"]' |
| 'Sign In' | button | { role: 'button', text: 'Sign In' } | 'button[type="submit"]' |

## Content Section

Main content area...

> Container: '.main-content'

| Element | Type | ARIA | CSS | XPath | Coordinates |
|---------|------|------|-----|-------|-------------|
| 'Save' | button | { role: 'button', text: 'Save' } | 'button.save' | - | (400, 300) |
| 'Delete' | button | { role: 'button', text: 'Delete' } | - | '//button[@class="del"]' | (500, 300) |
```

Notes:
- Sections are named after their content (never "Focus"); a focused overlay is marked with a `> **Focused**` blockquote under its container line
- The Type column is derived from the ARIA role during cleanup
- The XPath column appears only when CSS is broken and XPath was backfilled from the DOM
- Coordinates are backfilled from DOM positions for all indexed (eidx) elements; a vision model additionally contributes colors and icons
- The container is shown as a blockquote `> Container: '...'` before the table

## Caching

Research results are cached for 6 hours:
- In memory during the session
- On disk in `output/research/`

Separately, for up to 1 hour a page whose HTML fingerprint is at least 90% similar to an already-researched state reuses that state's research.

The cache applies to research triggered automatically by other agents. Explicit `/research` always bypasses it and runs fresh.

This cache controls when a fresh result is reused within a session. It is separate from how [deep research reuses previous results](#reusing-previous-results): a deep run always reloads the last saved research file from `output/research/` to replay and verify previously discovered hidden sections, regardless of the cache window or session.

## Configuration Examples

### Limit Sections

```javascript
ai: {
  agents: {
    researcher: {
      // Only research these sections, skip navigation and menu
      sections: ['overlay', 'content', 'list', 'detail'],
    },
  },
}
```

### Focus on a Single Element

`focusSections` applies when a truncated response forces the Researcher into per-section research (see [Handling Truncated Responses](#handling-truncated-responses)). It is a list of CSS selectors — the first one that matches on the current page wins, and the split research treats that element as the focused container instead of the whole page. Useful for apps that open a modal, drawer, or detail panel on top of the main layout:

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

When none of the selectors match, per-section research covers the whole page.

### Handling Truncated Responses

The Researcher produces a lot of output for busy pages. If the model's response is cut off at `maxOutputTokens`, Explorbot retries by splitting the work into one request per section (focus, main, sidebar, and so on) and merging the results. This usually happens transparently in the logs; no configuration is needed.

If you see it often, consider:
- lowering reasoning effort (see [Reasoning Effort](#reasoning-effort) below),
- pinning the Researcher to a non-reasoning model with a larger output window,
- or narrowing the scope with `focusSections`.

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

### Reasoning Effort

The Researcher runs with `reasoning: 'low'` by default. On reasoning models this keeps the chain-of-thought short, so the output budget goes to the UI map instead of thinking tokens. `reasoning` is the provider-agnostic setting from AI SDK v7 — the SDK maps it to the active provider's effort control, so the same value works across OpenAI, Anthropic, Google, Groq, and others:

```javascript
ai: {
  agents: {
    researcher: {
      reasoning: 'none', // 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'provider-default'
    },
  },
}
```

For provider-specific control (such as an exact thinking-token budget), set the provider's own keys in `providerOptions` — they take precedence over `reasoning`.

If heavy pages still truncate the response (`AI response empty: output truncated at maxTokens`), lower `reasoning` to `'none'`, raise `maxOutputTokens`, or pin the Researcher to a non-reasoning model.

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

- [Configuration](../reference/configuration.md) - general configuration options
- [Agents](./agents.md) - all agent descriptions
- [Knowledge Files](../workflow/knowledge.md) - domain-specific hints
