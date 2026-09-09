# Pagination rule: page numbers and infinite scroll

## Problem

Explorbot cannot reach list content that is not already loaded. A list shows a window onto
a larger collection, and when the item under test is outside that window the tester concludes
it is absent.

Nothing in the repo scrolls anything. `<actions>` (`src/ai/rules.ts:307`) documents no scroll
command, so the model has no way to know scrolling is available. Where scrolling is mentioned
at all it is as a passing hint inside an unrelated suggestion string
(`src/ai/tools.ts:875`, `:989`, `:1297`).

Two strategies cover practically every paginated list on the web:

- **Controls that replace the window** — next, previous, page numbers, load more.
- **Appending on scroll** — new items are fetched and appended as the list is scrolled.

The second is the hard one, because the scroller is often a container with its own scrollbar
rather than the page. `I.scrollPageToBottom()` moves the window and leaves such a container
untouched.

## Approach

Rules, not a new tool. The gesture already exists in CodeceptJS; what is missing is that the
model is never told about it, has no hint about which container scrolls, and receives tool
output that contradicts what the rule would tell it.

### Why `I.scrollTo` is sufficient

`Playwright.scrollTo(locator)` calls `el.scrollIntoViewIfNeeded()`
(`node_modules/codeceptjs/lib/helper/Playwright.js:1679`), which scrolls **every scrollable
ancestor** of the target. Pointing it at the last item currently in a list therefore scrolls
that list's own scroller.

Verified against Chromium on a page with both a scrollable `div` and a scrollable window:

```
before          {"box":0,    "win":0}
scrollIntoView  {"box":2200, "win":1821}
after cjs tail  {"box":2200, "win":1821}
```

Both scrollers moved. The `window.scrollBy` call CodeceptJS runs afterwards is a no-op: it
passes one object to a two-positional-parameter function, so both deltas coerce to `NaN` and
normalize to zero. Nothing needs to be worked around.

The gesture is a single line beginning with `I.`, so it passes the `form` tool's line check
(`src/ai/tools.ts:384`) and needs no new tool.

### Signals already on the wire

- **`pageDiff.ariaChanges` / `ariaChangeCount`** — `diffAriaSnapshots` (`src/utils/aria.ts:503`)
  counts node summaries, so appended rows surface as counted additions.
- **`pageDiff.requests`** — `Action.recordNetworkCall` (`src/action.ts:314`) captures same-origin
  xhr/fetch as `{method, path, status}`, deduped. It stores `url.pathname` only, so the query
  string is dropped: the rule reads *presence of a call*, never a page number.

## Design

### A. Researcher measures container scrollability

Researcher resolves a `> Container:` selector per section and already calls
`explorer.withPage(...)` to verify containers (`src/ai/researcher/sections.ts:73`). One
`page.evaluate` over those containers at the same point records, per container:

- `el.scrollHeight > el.clientHeight` → the container has its own scroller.
- `el.getBoundingClientRect().bottom > innerHeight` → the list continues below the fold,
  page scroller.
- Neither → nothing recorded.

This is a hint, not a gate. A false negative falls through to the probe, which is the rule's
normal path anyway.

Emitted as one line in the section block, whose grammar Researcher owns:

```
> Container: '.semantic-container'
> Scrolls: own
```

`own` or `page`; the line is omitted when neither holds.

The evaluate function goes in a new `src/utils/scrollable.ts`, self-contained with no
outer-scope references. `measureLayout` in `overlay.ts` is not reused: it is xpath-based and
returns a modal-scoring `RegionLayout`, while sections carry CSS selectors and need neither.

**No persistence.** The fact is recomputed for free on every research pass. The research cache
is session-scoped and must stay that way.

### B. The pagination rule

New `paginationRule` export in `src/ai/rules.ts`, composed into `actionRule` directly after the
scroll command from section C, following the bundling pattern `sectionContextRule` already uses
for `unexpectedPopupRule` (`src/ai/rules.ts:276`).

`actionRule` is the composition point, not `sectionContextRule`: it is the only rule shared by
all four agents that act on pages — Tester (`src/ai/tester.ts:838`), Navigator
(`src/ai/navigator.ts:414`), Rerunner (`src/ai/rerunner.ts:450`) and Captain web-mode
(`src/ai/captain/web-mode.ts:148`). Navigator does not import `sectionContextRule`
(`src/ai/navigator.ts:26`), so composing there would miss it. One edit, no duplication.

Not a `rules/*.md` file: those are loaded per agent, so this would need four copies.

Draft text:

```
<pagination_rule>
A list shows a window onto a larger collection. When what you need is not in the
window, widen it before concluding it is absent.

Two strategies, in this order:
1. Controls that replace the window — next, previous, page numbers, load more.
   If the UI map lists one, click it. It is reversible and it names the position.
2. Appending on scroll — when no such control exists and the list continues past
   what is visible, scroll to the last item currently in the list. Every
   scrollable ancestor of that item scrolls, so this reaches a list that has its
   own scrollbar.

After each attempt read the diff: new rows in the aria changes, or a call in
requests, means more arrived. Neither means the collection ended — that is an
answer, not a failed action.

Repeat a bounded number of times. Stop on the first attempt that adds nothing.
</pagination_rule>
```

Constraints it must keep: general phrasing, no selectors, no site names, no example taken from
a debug session, one to three lines per bullet.

### C. `actionRule` documents the gesture

`<actions>` (`src/ai/rules.ts:307`) gains a scroll entry covering `I.scrollTo(<locator>)` —
stating that it scrolls every scrollable ancestor of the target — and
`I.scrollPageToBottom()` for the window. The `form` tool description
(`src/ai/tools.ts:354`) gains "reach items further down a list" as a use case, since it
currently reads as a typing tool.

### D. Tool output that contradicts the rule

Both are wrong reporting on existing tools, not new behaviour.

**`src/ai/tools.ts:415`** — `hasObservablePageChange` (`src/ai/tools.ts:1236`) ignores
`pageDiff.requests`. A scroll that fires a fetch which has not yet rendered rows, and a scroll
at the true end of a list, both return `failedToolResult` carrying the suggestion "Treat the
field/form action as not completed. Re-locate the editable control…" and commit
`TestResult.FAILED` into the note. That note is read by final review and by Historian, so a
correct end-of-list check is recorded as a failed test step.

Fix: count `pageDiff.requests` as an observable change, and make the no-change message state
what was observed rather than prescribing a form-specific recovery.

**`src/ai/tools.ts:1208`** — `isMajorPageChange` (`src/ai/tools.ts:1220`) fires at
`ariaChangeCount >= 50` with no URL change (`LARGE_ARIA_CHANGE_THRESHOLD`,
`src/utils/aria.ts:581`), producing "MAJOR PAGE CHANGE. Page entered a different mode."
`diffByCount` (`src/utils/aria.ts:309`) pushes one entry per surplus occurrence, so a batch of
appended rows clears 50 easily. The rule says growth is the same state; the tool says the mode
changed.

Fix: a diff consisting of additions with no corresponding removals is growth, not a mode
change. Mode changes churn — they remove as well as add.

## Risks

- **Region misclassification.** `OverlayPage.detectRegion` (`src/utils/overlay.ts:41`) accepts
  in-flow added content that is `sizable` (≥5,000 chars, `src/utils/region.ts:99`), dominant
  (≥70% of added raw size) and carries a name or root. A large appended batch in one list
  container fits all three, which would fork the state hash with `region_<name>` and record a
  transition. Watch for it on the first real run; not changed here.
- **Virtualized lists.** Recycled nodes keep counts flat, so the aria diff shows renames
  (`src/utils/aria.ts:325`) rather than additions. Such a list will read as "nothing arrived"
  and the rule will stop. Out of scope.
- **Bounded repeats live only in the prompt.** No tool enforces the stop condition, so a model
  that ignores the bound can scroll further than intended. Accepted: the tester's own iteration
  cap remains the backstop.

## Testing

- `tests/integration/researcher-sections.test.ts` — the `> Scrolls:` line appears for a
  scrollable container and is absent otherwise.
- A browser test for the measurement, following `tests/integration/overlay-modal-browser.test.ts`:
  a container with its own scroller, a list below the fold, and a short list that needs neither.
- An aimock prompt-inspection test that `paginationRule` reaches the tester's system message,
  per `docs/contributing/ai-integration-tests.md`.
- Unit coverage for the two `tools.ts` corrections: requests-only diff counts as observable;
  an additions-only diff over the threshold is not a major page change.

## Out of scope

- Any new tool. The gesture is reachable through `form` today.
- Storing a per-state pagination strategy. The structural hint is free to recompute and the
  probe is the authority.
- Virtualized list support.
- Changing `detectRegion` thresholds.
