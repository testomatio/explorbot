# Interactive Mode and Screenshots

A static crawl documents what each page looks like. Interactive mode also documents what pages do: before writing a page's docs, the collector clicks a few of its controls and records what actually happens. Tabs get switched, panels get opened, and the results become observed behavior instead of guesses.

Enable it in `docbot.config.ts`:

```ts
export default {
  docs: {
    interactive: true,
  },
};
```

## What changes

The collector picks a handful of safe controls on each page and clicks them one by one. After every click it compares page state — the URL and the elements that appeared or disappeared — and records the difference. If a click navigates away, it returns to the page and continues.

These raw observations are handed to the AI as evidence for the page's capabilities, and the page file gains a `## State Transitions` section:

```markdown
## State Transitions

### Clicked tab: Merged

**Before:** 18 elements (tab:3, link:5, text:7). URL /pulls

**After:** 21 elements (tab:3, link:8, text:7). URL /pulls

**Observed changes:**
- ARIA snapshot gained 6 elements
- Visible links after interaction: 8
```

URLs discovered through clicks join the crawl queue, so interactive mode can reach pages that no plain link points to.

## What gets tried per page

The collector does not click everything:

- **Tabs first.** If research found a tab group (2 to 6 tabs), each tab is clicked to capture the page's alternate states.
- **Then primary actions.** Up to `maxPrimaryCandidates` (default 3) of the most promising links and buttons from the page's content and control sections. Navigation menus, headers, and footers are excluded. Controls that open dialogs or change a local screen area are recorded as child states; controls inside an already open overlay are not explored recursively.
- **Hard cap.** `maxInteractions` (default 5) limits total clicks per page, tabs included.

Raise the numbers for control-dense pages you want covered deeply; lower them to speed up large crawls:

```ts
docs: {
  interactive: true,
  maxInteractions: 8,
  maxPrimaryCandidates: 5,
}
```

Clicks that change nothing observable are discarded. If no click on a page produces a meaningful change, or interaction fails entirely, the page falls back to static documentation. Interactive mode adds evidence; it never blocks a page from being documented.

## deniedActionLabels — the click safety list

The crawling filters keep the collector away from dangerous URLs; `deniedActionLabels` does the same for clicks. A control is never clicked when its label or locator contains a denied word. The defaults cover destructive and session-ending vocabulary: `delete`, `remove`, `destroy`, `archive`, `discard`, `logout`, and similar. Matching is substring-based and case-insensitive, so "Delete account" and "Archive all" are both skipped.

Setting `deniedActionLabels` replaces the built-in list, so keep the defaults when adding words specific to your app.

## Low-signal pages

Some crawled pages have nothing worth documenting: empty states, redirect stubs, error pages. A page is skipped from the spec when both are true:

- it yields fewer proven actions than `minCanActions` (default 1), and
- research found fewer interactive elements than `minInteractiveElements` (default 3)

Skipped pages appear at the end of `index.md` with the reason. This filter applies in static and interactive mode alike. If real pages are being dropped, lower the thresholds; `minCanActions: 0` keeps every page.

## Screenshots

Screenshots are on by default (`screenshot: true`) in both modes. For every documented page the collector captures:

- one full-page screenshot
- one screenshot per section the [Researcher](../web-testing/researcher.md) identified — a sidebar, a data table, a filter bar — capped by `maxSectionScreenshots` (default 8)

Images land in `output/docs/screenshots/` and are embedded in the page files, each section shot labeled with the CSS selector it was taken from.

Interactive states are captured before the collector restores the original page. DocBot compares viewport screenshots from immediately before and after the action, finds the rectangle containing the changed pixels, adds a 30-pixel margin, and saves that fragment. If the images cannot be compared safely, it saves the current viewport instead.

```ts
docs: {
  maxSectionScreenshots: 4,
}
```

Set `screenshot: false` to turn captures off entirely. This also disables screenshot-assisted research, which makes the run cheaper and faster but text-only.

## Error handling

`ignoreErrors` controls page-level crawl failures. `true` keeps the current best-effort behavior and skips every failed page, `false` stops the crawl on the first error, and an array skips only errors whose code, name, or message contains one of the listed strings.

```ts
docs: {
  ignoreErrors: ['timeout', 'navigation interrupted'],
}
```
