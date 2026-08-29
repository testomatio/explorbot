# Region States Fixes — Persist the Overlay, Widen the Gates, Reject the Shell

**Date:** 2026-08-29
**Status:** Planned
**Follows:** `2026-08-29-region-states-design.md`
**Evidence:** 7 traced test sessions against beta.testomat.io (Langfuse, 2026-08-29 10:19–13:01), analyzed
trace-by-trace: `SharedConstitutionalChocolate674`, `ManualConsciousPeach543`, `MagicDepressedRose1`,
`MedicalUnfairGold673`, `ProudHungryChocolate14`, `RegularQuarrelsomeTurquoise190`, `InevitablePoisedBlack301`.

## Problem

The region-of-interest feature detects correctly and then loses its own result. Across every traced run
where the diff path fired, `pageDiff.areaOfInterest` carried the right announcement — and the state hash
never forked (`region_` appears in **zero** traces), Pilot's `region:` line appeared **never**, and the
Tester context blocks arrived once-late or not at all. The concrete bill for one run
(`MagicDepressedRose1`): the correct scope `//body/div[16]` sat unused in the tool result while
`interact()` burned 9 attempts on a guessed `.modal` selector that does not exist — roughly half of a
4-minute run spent compensating for guidance the feature had already computed.

Where detection did classify, quality was poor at the edges: every diff-detected root was either a
positional XPath (`//body/div[9..16]`) or the whole app shell (`div.main-app`); a hydration burst was
classified as a `drawer` covering the page; a modal-*closing* click registered as a drawer *opening*; a
genuine overlay (its subtree literally contains `modal-footer`, Pilot's screenshot read "obscured by a
modal") classified as inline `region`; and nested panels inherited the outer panel's name.

Meanwhile the app pattern these runs actually exercise — a drawer that opens **with a URL change**
(`/suites/suite/new-test`, `/plans/new/manual`) — is invisible to the diff path by design, and the one
overlay the old ARIA path caught got no root because ARIA detection pre-empts the probe entirely.

## Mechanisms found

1. **Edge-triggered overlay, wiped one capture later.** `Action.detectRegionOfInterest` sets
   `result.overlay` only on the action whose diff crossed the threshold. The next capture finds no new
   appeared subtree (the region is no longer *new*), falls through to `Overlay.fromAria` — empty, these
   drawers carry no `role=dialog` — and `updateState` replaces the current state with an overlay-less
   one. Everything downstream of the state (hash fork, `isNewState`, `<focus_scope>`,
   `<area_of_interest>`, Pilot's `region:` line, experience `root:` frontmatter) starves. Confirmed
   empirically: `reinjectContextIfNeeded` demonstrably ran every iteration (658 `current_focus` tags in
   one trace) while its region branches fired 0 times against 2 real detections.
2. **URL-change blind spot.** `Diff.calculate` short-circuits to `liveRegionMessages` whenever the URL
   changed, and `detectRegionOfInterest` guards on `isSameUrl`. A route-synced SPA drawer — the standard
   pattern in the app under test — is therefore never evaluated, in any run.
3. **Shell containers pass the body guard.** `toOverlay` falls back to the element XPath only when the
   container is literally `body`. `div.main-app` — body's sole meaningful child — sailed through as a
   "scope", producing `<focus_scope>` text that was factually false ("elements outside are not
   actionable" about a container that wraps the entire page, `MedicalUnfairGold673` 12:49:08).
4. **Hydration and modal-close read as regions.** A ~2s same-URL hydration window between a failed click
   and a `context()` call crossed the flat 10K threshold and, with a stray fixed-position widget, was
   classified `drawer (root: div.main-app)`. Separately, dismissing a picker re-rendered base content
   and fired `drawer "New Plan" opened, scope: div.main-app` on a click that *closed* an overlay
   (`InevitablePoisedBlack301` 13:00:53). Both false positives share a shell root.
5. **Floating check ignores ancestors.** `inspectRegion` reads `position`/`z-index` off the appeared
   node only. A large subtree appearing *inside* an already-floating drawer classifies as inline
   `region` even when the subtree itself contains `modal-footer` and a screenshot shows an overlay
   (`MagicDepressedRose1` 12:45:23).
6. **Naming picks the largest part, not the newest heading.** `appearedSubRoot` maximizes subtree size,
   then `nameFrom` joins h1–h4 of that subtree — so a nested picker is named after the outer panel
   ("New Plan", "New Test") instead of its own heading ("Select tests for plan", "Select suite for
   test"), which sat in the same state's h3 the whole time.
7. **ARIA pre-empts the probe; failed batches capture nothing.** `if (result.overlay.detected) return`
   means an ARIA-detected modal never gets `root`/`html` enrichment — every `<focus_scope>` in
   `ManualConsciousPeach543` lacked the scope sentence. And `executeOnce` only captures state on
   success: the click that opened that modal succeeded *inside* a `form()` batch whose third line
   failed, so no capture, no detection, and a tool result that labeled all four sub-commands FAILED —
   including the two that succeeded. Cost: ~26s clicking a button behind a modal the system had been
   told twice (by its own `see()`) was open.

## Changes

### 1. Persist the detected overlay until it verifiably closes (the P0)

The overlay stops being a per-action edge and becomes state that is carried forward. In
`Action`'s detection step, per capture, in order:

1. **Same URL, HTML unchanged** → carry the previous state's overlay verbatim. Nothing moved.
2. **Close check before open check.** If the previous overlay was diff-detected (has an element XPath)
   and its element is gone from the new HTML or the openness probe says its center no longer belongs to
   it → drop it (debug log "region closed"). The hash reverts, `updateState` records the close
   transition — open/close cycles become visible to `isInDeadLoop`, as the original spec intended.
3. **New detection** from the diff, as today.
4. **No new detection, previous overlay still confirmed open** → carry it forward onto the new
   `ActionResult`.

To make the close/confirm check possible, `Overlay` additionally records the appeared element's XPath
(`xpath`, internal — never rendered into prompts; `root` remains the scoping selector shown to agents).
The confirm probe is the existing center hit-test (`OverlayPage`), run against the stored XPath — one
cheap probe per capture, and only while an overlay is being carried.

This single change is what unlocks the already-built downstream behavior: the hash forks
(`region_<name>`), `isNewState` fires once, `<focus_scope>`/`<area_of_interest>` inject,
Pilot's `<state>` shows the region, and experience files for region states get written with their
`root:` frontmatter.

### 2. Detect route-synced drawers across URL changes

`Diff` always computes the HTML diff, URL change or not. Tool-result behavior for navigations does not
change — `PageDiff` keeps surfacing only messages for a changed URL, never navigation-noise
`htmlParts` — the diff is computed for detection's sake and stays memoized (one parse5 pass, shared).

Detection drops the hard `isSameUrl` gate and replaces it with a structural rule: across a URL change, a
region is considered only when `similarity >= SOFT_NAVIGATION_SIMILARITY` (unexported const, ~50) — the
old page must still substantially exist under the new content. A real navigation (low similarity)
produces no region; a drawer rendered over the still-present page does. The accepted-trade-off section
of the original spec ("first paint with no ARIA role") stands; this closes the much larger gap the field
runs actually hit.

### 3. Reject shell containers, prefer semantic roots

- The body fallback generalizes: a container whose subtree spans most of the document
  (`containerSize >= SHELL_RATIO * bodySize`, measured on the diff's own maps, ~0.8) is a shell, not a
  scope — same treatment as literal `body`.
- When the container degrades, the appeared element itself is tried for a stable selector first (id or
  meaningful classes, the same filtering `findStableContainer` already applies), with the positional
  XPath as the last resort it was always documented to be. `html-diff` exposes this as an optional
  `appearedSelector` on the part; root preference becomes: non-shell container → appeared element's
  semantic selector → element XPath.

This kills both observed false-positive roots (`div.main-app`) and upgrades `//body/div[16]`-class
roots wherever the app gives the element any identity.

### 4. Classify with ancestors and isolation

- **Floating check walks up.** `inspectRegion` reports floating when the element *or any ancestor up to
  body* is fixed/absolute/z-indexed. A re-render inside an open drawer now classifies as the drawer it
  is.
- **Isolation guard.** A region requires a dominant single addition: the winning part must account for
  the bulk of the diff's total changed subtree length (`REGION_DOMINANCE`, ~0.7). A hydration burst
  that touches containers all over the page no longer qualifies, independent of the shell-root fix.
- **Close is not open.** Because change 1 runs the close check first, a click that dismisses the current
  overlay is consumed as a close transition; re-rendered base content underneath cannot double as a
  fresh region in the same capture.

### 5. Name from the newest heading

`nameFrom` filters the subtree's headings to those **absent from the previous HTML** (plain containment
check against the prior snapshot — structural, no semantics) and takes the first survivor; only when
none survives does it fall back to the current first-heading join. A nested picker opening inside "New
Plan" is now named "Select tests for plan" — which also keys its own hash fork and its own experience
file, instead of colliding with the outer panel's.

### 6. Merge ARIA identity with probe geometry

ARIA detection no longer pre-empts the probe — the two paths answer different questions and merge:

- ARIA supplies **identity** (type `dialog`/`modal`, accessible name) — it is authoritative when
  present.
- The diff+probe supplies **geometry** (`root`, `xpath`, `html`) when a qualifying appeared subtree
  exists for the same moment.

An ARIA-detected modal whose opening also produced a large diff gets a root and a region snapshot; the
`<focus_scope>` scope sentence and Pilot's `(root: …)` suffix stop being diff-path-only.

### 7. Capture on the failure path, report batches truthfully

- `executeOnce` captures page state (detection included) on non-fatal failures too, not only on
  success. A batch that opened a drawer on line 2 and died on line 3 must still produce a state with
  the drawer in it.
- The `form()` failure report attributes per-line status from the steps that actually ran (the
  `executedSteps` machinery from #150), instead of stamping every sub-command FAILED. The model must
  learn "your click already opened something" from the tool result, not from 26 seconds of timeouts.

### 8. Region transitions wake the Pilot

`shouldAnalyzeProgress` treats a region open/close transition since the last analysis like a new-page
event: analysis triggers at the next iteration regardless of the interval modulo. In
`RegularQuarrelsomeTurquoise190`, Pilot went dark for 27 tool calls — the entire lifetime of the region,
three server 400s included; the feature's Pilot surface is worthless if Pilot never runs while a region
is open.

## Out of scope — separate follow-ups

Real issues from the same traces that are not this feature's subsystem, recorded here so they are not
lost:

- **Verdict integrity** (`MedicalUnfairGold673` false pass): pre-existing entities accepted as proof
  despite the provenance rule; Pilot's own screenshot doubt discarded between two calls 3 seconds
  apart; verbatim expected-result settlement unenforced at `finish()`; the post-run recipe compactor
  correctly concluded "no step actually creates a test" and that signal reaches nothing.
- **Reload primitive**: `pressKey('F5')` is a no-op that reports success; persistence scenarios need a
  real reload action.
- **Pilot server-error triage**: a raw backend error (`WRONGTYPE`) was first misdiagnosed as a form
  problem; 4xx/5xx with non-validation bodies should bias to stop-and-report on first occurrence.
- **Experience vocabulary**: a stored recipe describing the picker as a "modal" steered `interact()`
  into guessing `.modal`; supersede stale wording when a fresh run's classification disagrees, instead
  of suppressing the new write as a duplicate.
- **App defects found** (report to the product, they are findings, not bugs here): plans `POST` → 400
  `WRONGTYPE` with partial persistence; suites search → 500; stale Ember modal backdrop blocking Save;
  Monaco editor duplicating filled content.

## Validation

- Unit: carry-forward and close transitions (StateManager history shows open → carried → closed);
  cross-URL detection above/below the similarity floor; shell-container rejection; ancestor-floating
  classification; dominance guard against scattered diffs; newest-heading naming with a nested-panel
  fixture; ARIA+probe merge producing rooted `dialog`; failure-path capture.
- The seven Langfuse sessions above are the acceptance fixture: re-run the same two focus commands
  (`create test`, `create plan of different kinds`) and require — hash forks containing `region_`,
  Pilot `<state>` showing the region while open, zero `.modal`-guess `interact()` scopes, and no
  `div.main-app` root anywhere.
