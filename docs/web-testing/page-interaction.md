# Page Interaction

This page explains how Explorbot agents read a web page and act on it — and the two things you can change to help them: filtering noisy HTML and marking custom components.

## How agents see a page

Agents read each page three ways at once:

| Source | What it gives | Used for |
|--------|---------------|----------|
| **ARIA snapshot** | Roles, labels, states, hierarchy | Understanding structure, building locators |
| **HTML** | Classes, IDs, data attributes, form fields | Precise locators, reading field values |
| **Screenshot** | Layout, colors, icons, coordinates | Visual checks, click fallbacks |

The accessibility tree is the primary source. HTML adds detail. The screenshot is a fallback when the first two aren't enough.

## Filter noisy HTML

Agents work from the `combined` HTML snapshot. Cookie banners, chat widgets, ads, and analytics tags add noise and burn tokens. Exclude them in your config:

```javascript
// explorbot.config.js
html: {
  combined: {
    include: ['*'],
    exclude: ['script', 'style', 'svg', '.cookie-banner', '.analytics-tracker'],
  },
}
```

Three snapshots exist, each configurable:

| Snapshot | Purpose | Config key |
|----------|---------|------------|
| `combined` | Main HTML for agents | `html.combined` |
| `minimal` | Interactive elements only | `html.minimal` |
| `text` | Text content only | `html.text` |

## Mark custom components

Some components are interactive but have no ARIA role or semantic HTML, so agents miss them. Mark them with a `data-explorbot-*` attribute:

```html
<div data-explorbot-role="button" data-explorbot-label="Save Draft">
  <svg>...</svg>
  Save
</div>
```

A marked element is always kept in snapshots, treated as interactive, and shown to agents. During processing, `data-explorbot-role="button"` becomes `role="button"`, so you add a hint without changing how your component behaves.

Use this when standard locators fail to find an element, or when a custom control isn't detected as interactive.

## Locator priority

When an agent picks a locator, it prefers the most stable option first:

1. Text with a container — `I.click('Save', '.modal')` — simplest and preferred when a container is known
2. ARIA with a container — `I.click({ role: 'button', text: 'Save' }, '.modal')` — for disambiguation
3. ARIA alone — `I.click({ role: 'button', text: 'Save' })`
4. Text alone — `I.click('Save')` — only when the text is unique on the page
5. CSS or XPath — `I.click('#save-btn')`
6. Coordinates — `I.clickXY(400, 300)` (last resort)

When a locator fails, the agent tries the next strategy, then a visual click. Locators that worked are saved to experience and preferred on the next run.

## What happens after each action

After every action, Explorbot captures the new page state and compares it with the previous one. The resulting diff tells the agent what changed — the URL, the accessibility tree, or the HTML — so it can confirm the action worked and decide what to do next. The Researcher turns a page into a structured UI map of sections and elements; see [Researcher](./researcher.md).

## See also

- [Knowledge files](../workflow/knowledge.md) — teach Explorbot about your app
- [Agent hooks](./hooks.md) — run code before or after an agent
- [Configuration](../reference/configuration.md) — full configuration reference
- [Researcher](./researcher.md) — how pages become UI maps
