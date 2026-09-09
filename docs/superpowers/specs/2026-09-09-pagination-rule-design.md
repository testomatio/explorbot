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

Detection finds out which strategy a list uses; a rule tells the tester what to do about it,
and is injected only when there is something to say. No new tool: the gesture already exists in
CodeceptJS and is reachable through `form`.

Splitting it that way is what keeps the rule short. The tester never has to discover anything
at run time, and never carries guidance for a strategy this page does not use.

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
  string is dropped: presence of a call, never a page number.

## Design

### A. Researcher determines each list's pagination strategy

Four steps, cheapest first, stopping as soon as one answers. This is the escalation ladder from
CLAUDE.md end to end: a table lookup, then AI judgment, then a probe whose result converts
judgment back into a recorded fact.

**0. Do the ARIA/HTML conventions name it? (deterministic, no research, no AI)**

Some markup states the answer outright. These are spec-defined attributes and values, so this
tier is a lookup, not a guess — and it is the only step that works when research has not run.

| Marker | Means | Available in |
|---|---|---|
| `[aria-current="page"]` | current page of a pagination set | HTML only |
| `a[rel="next"]`, `a[rel="prev"]` | sequential document relations | HTML only |
| `[role="feed"]` | scrollable list that grows as it is scrolled | HTML and ARIA snapshot |
| `[aria-setsize="-1"]` | total count unknown, so the set loads lazily | HTML only |

The first two mean `controls`, the last two mean `infinite`.

Verified against Chromium: `ariaSnapshot()` does **not** emit `aria-current`, so a link marked
as the current page is indistinguishable from its neighbours in the ARIA path. Explorbot also
dissolves `navigation` wrappers (`src/utils/aria.ts:46`, `:147`) and treats the role as
template chrome (`src/utils/aria.ts:543`), so a `nav` labelled "Pagination" never reaches the
model either. **These markers must be read from HTML.** `role="feed"` is the one exception —
it survives as `- feed "…"` in the snapshot.

Two constraints that keep this a lookup rather than a heuristic:

- The value must be `aria-current="page"` exactly. `aria-current="true"` is what tabs and
  breadcrumbs use and would over-match — confirmed in the same probe.
- A `nav` whose `aria-label` reads "Pagination" is author prose, not closed grammar. It is not
  part of this tier.

**Absence proves nothing.** A pager built from plain buttons, and an infinite feed built from
plain divs, carry none of these. That is what steps 1–3 are for.

**1. Are there pagination controls? (AI, free)**

Only asked when step 0 found nothing. Controls are named in open-ended ways — words, arrows,
bare numbers — so this is AI judgment, not a pattern match. Researcher is already describing
the section, so it costs nothing extra:
a new `rules/researcher/pagination.md`, loaded alongside the existing three at
`src/ai/researcher/sections.ts:81`, asks it to note when a section contains controls that move
between pages of the same collection.

If found, the section records `> Pagination: controls` and the remaining steps are skipped.

**2. Can the section scroll at all? (deterministic gate)**

Only asked when no controls were found. One `page.evaluate` per container:

- `el.scrollHeight > el.clientHeight` → the container has its own scroller.
- `el.getBoundingClientRect().bottom > innerHeight` → the list continues below the fold.
- Neither → nothing more to do; no line recorded.

This gate exists to keep step 3 from running on every short list.

**3. Probe: does scrolling load more? (deterministic measurement)**

Scroll the container to its end, wait for readiness (`waitForPageReadiness`,
`src/utils/page-readiness.ts`), and compare. More descendant rows than before, or a same-origin
xhr/fetch fired during the scroll, means the list appends. Record `> Pagination: infinite`.

Then restore `scrollTop` to what it was, so screenshots, coordinates and later research see the
page as they found it. Scroll position is not app state, so this needs none of the modal
cleanup `_restorePageState` does in `deep-analysis.ts:453` — there is nothing to reuse there.

**Recorded vocabulary:** `controls` or `infinite`, as a line in the section's container
blockquote. Nothing is written when a list neither paginates nor grows, which is the common
case and should stay silent.

```
> Container: '.semantic-container'
> Pagination: infinite
```

**This line has a reader**, because section B injects the rule only when pagination was
detected, and that decision is code. `extractPaginationFromBlockquote` joins
`extractContainerFromBlockquote` (`src/ai/researcher/parser.ts:86`) and returns the recorded
value or null.

That makes `Pagination:` a closed vocabulary read deterministically by code, so the envelope
checklist from CLAUDE.md applies and holds: read by code, scoped to a section of a state,
optional with "absent" as the default, and written by one module.

### A2. Where the code goes

New `src/ai/researcher/pagination.ts` mixin, composed into `ResearcherBase`
(`src/ai/researcher.ts:47`), owning steps 2 and 3. Step 1 is prompt text in
`rules/researcher/pagination.md` and needs no code.

It runs after `validateContainers` (`src/ai/researcher/locators.ts:268`), on containers that
survived validation, so a probe never targets a selector already known to be broken.

Not `deep-analysis.ts`: that mixin owns the same interact-measure-restore shape, but it is
gated behind `deep` (`src/ai/researcher.ts:287`), and infinite scroll has to be detected on
ordinary research runs too. It is also already 26k.

Not `locators.ts`: that mixin owns locator validity, not list behaviour.

**One writer for the blockquote.** `updateSectionContainer`
(`src/ai/researcher/locators.ts:300`) currently owns that `blockquote[0]` replace. The
pagination mixin must not write it independently. Extract the blockquote composition into one
helper both call, so `Container:` and `Pagination:` are always emitted by the same code.

A new `src/utils/pagination.ts` owns the two deterministic halves — the step 0 marker scan over
HTML, and the in-page evaluate functions for steps 2 and 3, self-contained with no outer-scope
references. One concern: how a list continues. `measureLayout` in `overlay.ts` is not reused:
it is xpath-based and returns a modal-scoring `RegionLayout`, while sections carry CSS
selectors and need neither.

### B. The pagination rule, injected only when pagination was detected

Not part of the static system message. A page with no list should not carry list guidance, and
a page with page numbers should not be told how to scroll.

**Seam:** `reinjectContextIfNeeded` (`src/ai/tester.ts:554`), which already injects per-state
blocks conditionally — `focusedElementRule` when something is focused, an `<overlay>` block
when a region is open. A `<pagination>` block joins them. Navigator gets the same block where
it builds its own per-state context (`src/ai/navigator.ts:414`).

**Condition:** the state shows pagination if step 0's markers are present in the current HTML,
or `extractPaginationFromBlockquote` finds a recorded value for a section. Markers win when
both are available, since they describe the page as it is now rather than as research left it.

**Which text:** the strategy selects the fragment, so the model is never shown the other one.

`paginationControlsRule`:

```
<pagination>
This list pages through a larger collection. If what you need is not on screen,
click next or the page number you need before concluding it is absent.
</pagination>
```

`infiniteScrollRule`:

```
<pagination>
This list grows as it is scrolled. If what you need is not on screen, scroll to
the last item in the list — every scrollable ancestor of that item scrolls, so
this reaches a list with its own scrollbar.

New rows in the aria changes mean more arrived; a request with none means nothing
was left. Stop on the first attempt that adds no rows: the end of a collection is
an answer, not a failure.
</pagination>
```

Both live in `src/ai/rules.ts` as exports. Not `rules/*.md`: those load per agent, and these
have two consumers.

**Reach narrows from the earlier draft.** Composing into `actionRule` would have reached
Rerunner (`src/ai/rerunner.ts:450`) and Captain web-mode (`src/ai/captain/web-mode.ts:148`) too;
conditional injection reaches only agents that build per-state context, which is Tester and
Navigator. That is the cost of making it conditional, and it is the right trade: Rerunner heals
known steps rather than traversing lists.

Constraints both fragments keep: general phrasing, no selectors, no site names, no example
taken from a debug session, one to three lines per bullet.

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

Fix: one line in `hasObservablePageChange` — `if (data.pageDiff.requests?.length) return true;`
— and a no-change message that states what was observed rather than prescribing a
form-specific recovery.

**`src/ai/tools.ts:1208`** — `isMajorPageChange` (`src/ai/tools.ts:1220`) fires at
`ariaChangeCount >= 50` with no URL change (`LARGE_ARIA_CHANGE_THRESHOLD`,
`src/utils/aria.ts:581`), producing "MAJOR PAGE CHANGE. Page entered a different mode."
`diffByCount` (`src/utils/aria.ts:309`) pushes one entry per surplus occurrence, so a batch of
appended rows clears 50 easily. The rule says growth is the same state; the tool says the mode
changed.

Fix: a diff consisting of additions with no corresponding removals is growth, not a mode
change. Mode changes churn — they remove as well as add.

The added/removed split exists inside `diffAriaSnapshots` but is flattened into a single
`count` before it reaches the check, so it has to be threaded through:

1. `AriaDiff` (`src/utils/aria.ts:587`) gains `added: number; removed: number` — both arrays
   are already computed at `src/utils/aria.ts:522`.
2. `Diff` (`src/action-result.ts:650`) stores them alongside `_ariaChangeCount`, set where
   `diffAriaSnapshots` is called (`src/action-result.ts:740`), and exposes them.
3. `PageDiff` (`src/action-result.ts:46`) gains `ariaAdded` / `ariaRemoved`, populated next to
   `ariaChanges` / `ariaChangeCount` (`src/action-result.ts:552`).
4. `isMajorPageChange` then reads the split instead of the total.

## Risks

- **The probe costs a scroll per candidate section.** Steps 1 and 2 narrow it to sections that
  have no pagination controls and can actually scroll, which on most pages is zero or one. If
  it still proves too slow, the gate to tighten is step 2, not the probe itself.
- **Region misclassification.** `OverlayPage.detectRegion` (`src/utils/overlay.ts:41`) accepts
  in-flow added content that is `sizable` (≥5,000 chars, `src/utils/region.ts:99`), dominant
  (≥70% of added raw size) and carries a name or root. A large appended batch in one list
  container fits all three, which would fork the state hash with `region_<name>` and record a
  transition. The probe can trigger this during research as well as the tester during a run.
  Watch for it on the first real run; not changed here.
- **Virtualized lists.** Recycled nodes keep counts flat, so the probe sees no growth and the
  aria diff shows renames (`src/utils/aria.ts:325`) rather than additions. Such a list records
  nothing and the rule will not know to scroll it. Out of scope.
- **The stop condition lives only in the prompt.** No tool enforces it, so a model that keeps
  scrolling past an attempt which added no rows will keep scrolling. Accepted: the tester's own
  iteration cap is the only backstop.
- **A REST call alone no longer stops the loop, by design.** After the D fix an empty-payload
  200 counts as an observable change, so the tool reports success. The rule makes rows, not
  calls, the evidence that more arrived — otherwise a list that answers every scroll with an
  empty page would loop.

## Testing

- Unit coverage for step 0's marker scan: `aria-current="page"` and `rel=next/prev` yield
  `controls`; `role="feed"` and `aria-setsize="-1"` yield `infinite`; `aria-current="true"` on a
  tab list yields nothing.
- `tests/integration/researcher-sections.test.ts` — `> Pagination: controls` appears for a
  section whose UI map holds next/prev controls, and step 1 is not asked when step 0 already
  answered.
- A browser test for steps 2 and 3, following `tests/integration/overlay-modal-browser.test.ts`:
  a container with its own scroller that appends on scroll (`infinite`), one that does not
  (silent), a list with pagination controls (`controls`, no probe runs), and confirmation that
  `scrollTop` is restored afterwards.
- An aimock prompt-inspection test that the matching fragment reaches the tester on a paginated
  state, the other fragment does not, and neither appears on a state with no list, per
  `docs/contributing/ai-integration-tests.md`.
- Unit coverage for the two `tools.ts` corrections: requests-only diff counts as observable;
  an additions-only diff over the threshold is not a major page change.

## Out of scope

- Any new tool. The gesture is reachable through `form` today.
- Persisting the strategy across runs. Research recomputes it, and the research cache is
  session-scoped.
- Virtualized list support.
- Changing `detectRegion` thresholds.
