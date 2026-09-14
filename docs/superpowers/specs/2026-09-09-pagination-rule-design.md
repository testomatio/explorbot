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

Research finds out which strategy each list uses and records it in the UI map, beside that
list's own container. The tester already reads the UI map, so the fact arrives attached to the
list it describes. No new tool: the gesture already exists in CodeceptJS and is reachable
through `form`.

Nothing is injected per page — see section B for why the first attempt at that was wrong.

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

**1. Are there pagination controls? (AI, free)**

Controls are named in open-ended ways — words, arrows, bare numbers — so this is AI judgment,
not a pattern match. Researcher is already describing
the section, so it costs nothing extra:
a new `rules/researcher/pagination.md`, loaded alongside the existing three at
`src/ai/researcher/sections.ts:81`, asks it to note when a section contains controls that move
between pages of the same collection.

If found, the section records `> Pagination: controls` and the remaining steps are skipped.

**2. Markers and the scroll gate — one `page.evaluate` per container (`inspectList`)**

Only reached when research recorded nothing. Everything the probe needs comes back in one call,
**scoped to the container**, never to the page:

- `a[rel="next"]`/`a[rel="prev"]` inside it → `controls`, recorded without scrolling.
- `[role="feed"]` → `infinite`, recorded without scrolling. These are spec-defined relations, so
  this tier is a lookup, not a heuristic.
- `scrollHeight > clientHeight`, or the container's bottom below the fold → it can scroll, so
  step 3 may run. Neither → nothing recorded.

`aria-current` is excluded in every value: its primary spec use is a site-navigation link
marking the page you are on, and `aria-current="true"` is what tabs and breadcrumbs use.
`rel="next"`/`rel="prev"` carry the sequential meaning unambiguously.

The scoping is the point. Asking the same question of the whole page is what section B removed.

**3. Probe: does scrolling load more? (deterministic measurement)**

Scroll the container to its end, wait for readiness (`waitForPageReadiness`,
`src/utils/page-readiness.ts`), and compare descendant counts. More than before means the list
appends. Record `> Pagination: infinite`.

**Rows are the evidence, not requests.** The same rule the tester follows: a request that
brings no rows tells you nothing arrived. A page also fires telemetry and prefetches while
scrolling, so a bare request count would report growth where there is none. `networkRequests`
is private to `Action` (`src/action.ts:46`) and stays that way — nothing here needs widening.

**The scroll goes through `Action`, not through `page.evaluate`.** `deep-analysis.ts` sets the
precedent at `:405` — `this.explorer.action()`, then `action.attempt(cmd)` per command. Action
is the only thing that moves the browser (CLAUDE.md glue tiers), and going around it would
bypass the recorder and state updates. Measurement (row counts, scroll offsets) still uses
`withPage`, which reads without moving.

Then restore `scrollTop` to what it was, so screenshots, coordinates and later research see the
page as they found it. Scroll position is not app state, so this needs none of the modal
cleanup `_restorePageState` does in `deep-analysis.ts:453` — there is nothing to reuse there.

**Which sections get probed — `Data:` sections are the point.**

Researcher is instructed to emit a list of similar data items as a `## Data: <name>` section
holding a container and a summary line, no table (`src/ai/researcher.ts:502-509`). That is
precisely where a paginated list lands.

But `parseResearchSections` (`src/ai/researcher/parser.ts:100`) filters those out:

```js
.filter((s) => !SKIP_SECTIONS.has(s.name.toLowerCase()) && !s.name.toLowerCase().includes('data:'))
```

`SKIP_SECTIONS` (`:27`) also drops a section literally named `data`. So iterating
`parseResearchSections` — as `validateContainers` does — would probe every section **except**
the lists. Nothing else in the codebase parses `Data:` sections today.

A new `parseDataSections(markdown): ResearchSection[]` in `parser.ts` returns them: the same
`parseSections` call, filtered to names beginning with `data:`, reusing
`extractContainerFromBlockquote` and yielding an empty `elements` array (Data sections carry no
table by construction). Both parsers stay single-purpose.

Steps 1–3 then run over `[...parseResearchSections(text), ...parseDataSections(text)]`. A
non-Data section can hold a list too, and it costs nothing to include it: step 2 gates it out
when it does not scroll.

**Recorded vocabulary:** `controls` or `infinite`, as a line in the section's container
blockquote. Nothing is written when a list neither paginates nor grows, which is the common
case and should stay silent.

```
> Container: '.semantic-container'
> Pagination: infinite
```

**This line has a reader**, because section B injects the rule only when pagination was
detected, and that decision is code. `extractPaginationFromBlockquote(sectionMarkdown)` joins
`extractContainerFromBlockquote` (`src/ai/researcher/parser.ts:86`) and returns `'controls'`,
`'infinite'`, or null — anything else in the line is ignored, keeping the vocabulary closed.

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

### B. The UI map carries it — nothing is injected per page

**Superseded during implementation.** The original design injected a `<pagination>` block into
Tester and Navigator whenever a strategy was detected. That was wrong and is removed.

The condition was computed from the whole page's HTML, which carries no context. A pager
anywhere on the page — a sidebar list, a widget behind an open modal, a drawer — told the
tester "this list pages through a larger collection" whatever it was actually looking at. A
page-level answer cannot address a question about one list among several.

The UI map already solves this. Research records `> Pagination:` under the section's own
container, and the tester already reads the UI map. The fact arrives attached to the list it
describes, and says nothing about any other list on the page. `actionRule` documents
`I.scrollTo` for the capability itself (section C), which is genuinely page-independent.

Consequences:

- `paginationRuleFor` and `paginationFromResearch` are gone; `src/ai/rules.ts` gains only the
  scroll commands in section C.
- `Pagination:` has no code reader, so the envelope checklist does not apply to it — it is
  prompt context, like every other line in the UI map.
- Marker detection moves in-page, scoped to the container, inside `inspectList`. jsdom is no
  longer used: it was pulled in only to parse whole-page HTML for the injection, and eagerly at
  that, while the single existing use in `src/utils/xpath.ts:94` imports it lazily.

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

- Unit coverage for step 0's marker scan: `rel=next/prev` yields `controls`; `role="feed"` and
  `aria-setsize="-1"` yield `infinite`; `aria-current` in any value yields nothing.
- Unit coverage for `parseDataSections`: a `## Data: Suites List` section with a container is
  returned with its `containerCss`, and `parseResearchSections` still excludes it.
- Unit coverage for `extractPaginationFromBlockquote`: reads `controls` and `infinite`, returns
  null for an absent line and for any other value.
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
- The API signal below — a follow-up branch, not this one.

## Follow-up: pagination from the API

The DOM says a list continues; the API says **how far**. That number decides whether paging on
is worth it or the item is not in the collection at all, and nothing in this design can supply
it. Deferred to its own branch because it depends on the API boat being configured and lands on
Pilot rather than on Researcher or Tester.

**Already in place, verified:**

- `XhrCapture.captureReadEndpoint` (`src/api/xhr-capture.ts`) stores GETs as
  `fullUrl = pathname + search`, so the **query string is already captured**.
- `queryParamNames()` extracts the names and `queryParamHint()` renders them into
  `toEndpointList()` (`src/api/request-store.ts:78`), so fisherman already sees
  `GET /api/items ?page,per_page` in its endpoint list.
- `askApi` (`src/ai/fisherman/tools.ts:220`) is wired to **Pilot alone**
  (`src/ai/pilot.ts:786`), and `fisherman.lookupData()` issues live read-only requests, reading
  full responses. Totals are reachable today without touching capture.

**The gap:** GET response bodies are deliberately dropped (`rawResponseBodyValue = ''`,
`responseHeaders: {}`), so `total`, `X-Total-Count` and `Link: rel="next"` are not passively
available. `askApi` re-requests instead, which is why that gap does not block this.

**Shape of the follow-up:**

1. A Pilot rule saying **when** asking is worth it — after repeated paging or scrolling has not
   produced the target — never "ask about every list". Pilot *guides* while Tester *executes*,
   and judging whether to keep paging is guidance; Pilot's conversation is also the light one,
   so API reasoning belongs there rather than in Tester's ARIA-heavy loop.
2. A deterministic signal from captured read requests whose query params name a pagination
   scheme (`page`, `offset`, `cursor`, `limit`, `per_page`). Free — the data is already stored,
   and `queryParamNames` already isolates it.

**Rejected:** capturing GET response bodies to read totals passively. Bodies are large, reads
are discarded on purpose, and `askApi` already obtains them on demand.

Both must stay optional: `fisherman?.isAvailable()` already returns a clean "no API access,
judge from the page instead", and a run without an API boat must behave exactly as it does now.
