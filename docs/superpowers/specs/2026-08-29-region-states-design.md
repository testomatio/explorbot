# Region-of-Interest States — Diff-Detected Modals, Drawers and Soft Navigation

**Date:** 2026-08-29
**Status:** Planned
**Plan:** `docs/superpowers/plans/2026-08-29-region-states.md`

## Problem

A state is `url + h1 + h2` (`ActionResult.getStateHash`, `src/action-result.ts:478`). The only
other state signal is `StateManager.hasDialogAppeared` (`src/state-manager.ts:209`), which fires
when the ARIA snapshot suddenly contains a dialog/modal node (`Overlay.fromAria` →
`detectFocusArea`). Everything that opens without an ARIA dialog role and without a URL change is
invisible as a state:

- drawers and side panels rendered as plain positioned `<div>`s;
- soft navigation — a SPA swapping a large content region in place (wizard step, inline editor,
  detail subview) with no full re-render and no URL change.

The diff pipeline actually *sees* these. `htmlDiff` (`src/utils/html-diff.ts`) returns
`HtmlDiffPart[]` — each with a stable `container` selector and the appeared `subtree` — but
`collapseHtmlParts` (`src/action-result.ts:591`) treats any diff over 8K chars as a full page
re-render and collapses it to `...collapsed (12000 chars)...`. The one signal that says "a modal
just opened" is thrown away as noise.

On top of that, overlay detection today is **scattered across three approaches in four files**:

1. ARIA role detection — `detectFocusArea` in `aria.ts`, via `Overlay.fromAria`;
2. a selector-heuristic browser extractor — `extractVisibleOverlayHtml` in `html.ts`, driven by
   `OVERLAY_SELECTORS` class-name patterns (`[class*="modal"]`, `[class*="drawer"]`…) and a
   z-index geometry fallback, invoked from `Action.captureOverlayHtml` and independently from
   `Driller.getVisibleOverlayHtml`;
3. the `overlayHtml` → `Overlay.resolve` priority chain in `ActionResult`.

The class-name selector heuristic is exactly the kind of memorized surface form the project's
Regex-vs-AI doctrine rejects: it works only on sites that happen to name their CSS that way.

Consequences:

- Tester gets either the strict `<focus_scope>` block (ARIA dialogs only) or nothing. For a
  drawer without a role it keeps targeting elements behind the drawer.
- Pilot's `<state>` says `modal: none` while half the screen is a drawer.
- Modal open/close cycling is invisible to `isInDeadLoop` — every hash in the window is the base
  page.
- Experience recorded while a modal is open lands in the base page's experience file, with no
  record that it only applies inside that modal.

## Design

### Unification: `overlay.ts` is the single detection module

All area-of-interest semantics live in `src/utils/overlay.ts`. After this change there are
exactly **two** detection signals, both general:

1. **ARIA** — `Overlay.fromAria` (role-based dialogs, free at capture time, needs no previous
   state). `aria.ts` keeps only the ARIA-tree *primitives* (`detectFocusArea`,
   `focusAreaControls`); their sole overlay-semantics consumer is `overlay.ts`.
2. **Diff + geometry** — the new pipeline below, for everything the ARIA tree does not label.

The selector-heuristic path is **deleted entirely** (see "Removed code"). No third approach, no
class-name patterns, no priority chain.

`overlay.ts` exposes exactly two classes: `Overlay`, the immutable value describing what is open,
and `OverlayPage`, which wraps the live page and owns detection. The single public entry point is
`new OverlayPage(page).detectRegion(diffParts)`; every lower-level step (subroot picking, the
browser probe, coverage classification) is a private member. The pipeline runs after every action
inside `Action.capturePageState`, before the (sync) `stateManager.updateState` call — `Action`
only hands the page over (it is the only browser mover):

```
capture html/aria
  └─ same URL, not iframe, html changed, no ARIA overlay already detected
       └─ diff vs previous state (parse5, memoized — shared with toToolResult)
            └─ OverlayPage.detectRegion(parts)
                 ├─ appeared subtree ≥ 5K chars       (private)
                 ├─ coverage probe via page.evaluate   (private)
                 └─ coverage classification            (private)
                      ├─ overlays the page → Overlay 'modal' | 'drawer'
                      └─ inline            → Overlay 'region'
```

Detection is 100% structural — size threshold, diff paths, geometry. No AI in the path. AI enters
only downstream: `researchOverlay` describes the region, Tester/Pilot decide what to do in it.

### 1. Appeared-subroot detection (`OverlayPage`, over `html-diff.ts` parts)

The first private step of `detectRegion` picks the largest part that contains an appeared
element (`ELEMENT:` line in `part.added`) and whose minified `subtree` is ≥ `SUBROOT_MIN_HTML`
(10 000 chars, unexported const — no config knob). `html-diff.ts` stays a generic diff engine; it
newly exports `pathToXPath` so overlay.ts can convert appeared-element paths.

The part's `container` is by design an ancestor that exists in **both** snapshots
(`findStableContainer`) — it is never the appeared element, and for portal roots
(`#modal-root`-style, zero-height with fixed children) its geometry lies. So the result carries
both:

- `container` — the stable scoping selector, handed to Tester and stored as the experience `root`;
- `elementXPath` — the appeared element itself (from the `ELEMENT:html[1]/body[1]/div[3]` path
  via `pathToXPath`) — this is what the coverage probe measures.

When `container` degrades to `body` (top-level appended node — the common portal case), the
`elementXPath` doubles as the root selector.

### 2. Openness verification (`OverlayPage`)

One hit-test decides whether the appeared region is **actually open**: take the center of the
region's visible (viewport-intersected) rect, ask `document.elementFromPoint` what lives there,
and check the hit belongs to the region (`.modal` is the region; the input at its center belongs
to it → it is on top). A region whose own center resolves to a foreign element is hidden or
covered — verified not open, and **discarded** rather than classified.

For an open region, two values collected in the same probe decide the kind:

- computed position — floating (`fixed`/`absolute`/positive z-index) → overlaying; in-flow →
  inline `region` (so soft navigation never triggers the strict focus scope);
- visible-rect coverage of the viewport — overlaying with coverage ≥ 0.8 → `modal`, else
  `drawer`.

The probe is a module-private plain function shipped as a source string into `page.evaluate`
(it must stay self-contained so `toString()` reconstruction works in the browser); tests drive
`detectRegion` with fake pages returning canned probe results.

When the probe cannot run at all (no page, evaluate throws, element already gone) the region
degrades to inline `region` with a debug log — never to an overlay: a false "overlaying" verdict
would make Tester refuse legitimate navigation. An off-screen in-flow region (below the fold)
also stays inline instead of being discarded.

### 3. Overlay carries the region (`overlay.ts`)

`Overlay` is extended rather than a parallel concept added:

- `type`: `'dialog' | 'modal' | 'drawer' | 'region' | null` — `region` means inline subview;
- `name`: heading-derived (h1–h4 join over the region HTML, private `nameFromHtml`);
- `root`: the scoping selector (container CSS, or element XPath when the container degraded to
  `body`);
- `get detected()` — **keeps meaning "verified overlaying"** (`type` is dialog/modal/drawer).
  Every existing consumer of `detected` (Tester `<focus_scope>`, Pilot `modal:` line,
  `hasDialogAppeared`) keeps its semantics.
- `get present()` — any region, inline included. New consumers that want "an area of interest
  exists" use this.
- `html`: the region's minified subtree, carried on the overlay itself — `toToolResult` renders
  it as the single diff part instead of a collapsed dump.
- `describe()` — the one-line human/model-facing summary
  (`drawer "Edit User" opened, scope: aside.panel`), used for `pageDiff.areaOfInterest`.
- `OverlayPage.detectRegion` builds the Overlay: verdict `overlays: true` with coverage ≥ 0.8 →
  `modal`; overlaying with partial coverage → `drawer`; otherwise `region`.
- `Overlay.resolve` simplifies to two sources: stored `overlay` data, else `fromAria`.

### 4. State identity (`src/action-result.ts`)

- `getStateHash()` gains a `region_<name>` part when `overlay.present && overlay.name`.
  **Named regions only**: names come from headings (stable across runs); selectors with dynamic
  classes never enter a hash. An unnamed region does not fork the state — which is why
  `hasDialogAppeared` survives (generalized to `hasRegionAppeared` over `present`) as the
  transition trigger for unnamed overlays.
- `baseHash` getter — the hash without the region part. The research cache and Tester's
  `pageStateHash` key off `baseHash`, otherwise a modal open at capture time forks
  `getCachedResearch` and poisons `researchOverlay`'s append-to-page-research flow.
- `diff(previous)` is memoized on `previous.id` so capture-time detection and `toToolResult`
  share one parse5 pass.
- Side effect, intended: with the region in the hash, modal **close** also changes the hash — a
  test cycling open/close now produces alternating hashes that `isInDeadLoop` can see.

### 5. StateManager records region states (`src/state-manager.ts`)

Named regions change the hash, so `updateState` records the transition through the existing
hash-changed path — region states land in `stateHistory`, `getRecentTransitions`, visit counts,
and the `tag('data').log('state', …)` remote frame (which gains a `region` field). Unnamed
regions go through `hasRegionAppeared` (the renamed, `present`-based `hasDialogAppeared`).

### 6. Experience envelope: `root:` (`src/experience-tracker.ts`)

Experience files for region states get a new frontmatter key:

```markdown
---
url: /users
title: Users — Admin
root: 'aside.detail-panel'
---
```

Envelope checklist (per CLAUDE.md "Data Envelope Formats"):

1. **Read deterministically by code** — retrieval gating below; never interpreted by the model.
2. **Scoped to URL/state** — per `<stateHash>.md` file; region states have their own hash, so
   their file is created while the region is open and `root` comes from `state.overlay.root`.
3. **Optional with a default** — absent means "whole page"; every existing file on disk behaves
   exactly as today.
4. **Single writer** — `ExperienceTracker.ensureExperienceFile` only.

**Retrieval rule** (in `ActionResult.isRelevantExperienceRecord`, where matching already lives):
a record carrying `root` is loaded only when the current state has a region open —
`overlay.present` — and, when the current region's own `root` is known, the selectors match
exactly. Found by this state + root selector exists → the experience file is loaded; no region
open → the file is skipped, so drawer recipes stop polluting base-page context. Matching stays
structural (string equality), never semantic.

### 7. Surfacing to the agents

- **Tool results** (`toToolResult`): when the region appeared in this transition, `pageDiff`
  gains `areaOfInterest` — e.g. `drawer "Edit User" opened, scope: aside.detail-panel` — and
  `htmlParts` is replaced by a single part containing the region's cleaned snapshot within the
  existing per-part budget, instead of the `...collapsed (12000 chars)...` marker. This is the
  payoff: the diff signal that was discarded becomes the headline of the acting tool's result.
- **Tester** (`reinjectContextIfNeeded`): verified overlays keep the strict `<focus_scope>`
  block, now with the concrete root selector. Inline regions get a new, softer
  `<area_of_interest>` block — injected once per state change (via the previously write-only
  `previousStateHash`) — that names the region and its root but leaves page navigation
  actionable. The strict "elements outside are not actionable" wording stays gated on the probe
  verdict. The `researchOverlay` trigger widens from `detected` to `present`.
- **Pilot** (`buildStateContext`): the `modal:` line stays for verified overlays (its diagnostic
  prompt patterns keep working) and gains the root; inline regions get a new
  `region: <name> (inline, root: <selector>)` line plus one general system-prompt bullet.
- **Researcher** (`deep-analysis.ts` `researchOverlay`): the guard widens from
  `type === 'dialog' | 'modal'` to any named present region, so drawers and subviews get the same
  incremental Extended Research treatment, still appended under the base page's research (keyed
  by `baseHash`).
- **Driller** (`detectNestedOverlayContext`): stops re-querying the live DOM through the selector
  extractor. The nested-overlay context is built from what the tool result already carries — the
  appeared `pageDiff.htmlParts` subtrees (plus the region part when `areaOfInterest` is set).
  What changed after the click *is* the nested UI; no second detection approach needed.

## Removed code

Unification means the selector-heuristic path is deleted, not deprecated:

| Removed | Was |
|---|---|
| `Action.captureOverlayHtml` + `overlayHtml` capture in `capturePageState` | Selector-extractor invocation per capture |
| `ActionResultData.overlayHtml` + `Overlay.resolve`'s overlayHtml branch + `Overlay.fromHtml` (public) | Priority chain feeding heading-named modals |
| `OVERLAY_SELECTORS`, `Overlay.captureConfig` (`overlay.ts`) | Class-name patterns (`[class*="modal"]`…) |
| `extractVisibleOverlayHtml`, `getVisibleOverlayHtmlExtractorSource`, `VisibleOverlayExtractionConfig` (`html.ts`), plus limit fields used only by them | The selector/z-index browser extractor |
| `Driller.getVisibleOverlayHtml` | Driller's private extractor invocation |
| `extractVisibleOverlayHtml` describe-block and `overlayHtml` resolve tests | Tests of the removed path |

**Accepted trade-off:** an overlay that is *already open at the very first capture* and carries
no ARIA dialog role is no longer detected (there is no previous state to diff). The moment any
action happens, the diff path sees it. This trades a narrow first-paint case for removing a
site-shape heuristic that violates the core "no memorized surface forms" principle.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Single detection home | `overlay.ts` owns every decision function; `aria.ts` keeps ARIA parsing primitives; `Action` only orchestrates | One place to reason about overlays; browser access stays in the Action tier |
| Old selector path | Deleted, including Driller's use (rebuilt on `pageDiff`) | User decision: unify, old code gone; class-name selectors are memorized surface forms |
| What the probe measures | The appeared element (`elementXPath`), never the diff `container` | Container is a both-sides ancestor; portal roots have lying geometry |
| `detected` semantics | Unchanged: verified overlaying only; new `present` for any region | A false overlay claim makes Tester refuse legitimate navigation — worse than no detection |
| Hash contribution | Named regions only; `baseHash` escape hatch for research keys | Heading names are stable; selectors are not; research must stay keyed to the page |
| Threshold | `SUBROOT_MIN_HTML = 5_000` on the minified subtree, unexported const | Single named constant; no config knob until someone needs one |
| `root` retrieval gating | Sync string equality against `overlay.root`, require `overlay.present` | Deterministic, no DOM query in the sync retrieval path |

## Non-goals / follow-ups

- **DOM-presence gating for experience `root`** (querySelector against stored HTML when the
  current region is detected by ARIA and has no `root`). Needs an async retrieval path; revisit
  if the equality rule proves too strict.
- **Region-scoped ARIA slices** for the Tester context. v1 hands the root selector and the
  region snapshot via the tool result; slicing the ARIA tree to the region is a later refinement.
- **First-paint overlay detection without ARIA roles.** If the accepted trade-off above bites in
  practice, the general fix is a geometry-only probe at first capture (top-most covering element),
  not the return of class-name selectors.
