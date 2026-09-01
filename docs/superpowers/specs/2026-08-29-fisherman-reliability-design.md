# Fisherman Reliability — Design

Fisherman is the API test-data preparation agent. Pilot calls it through the `precondition()` tool before a test runs; in **replicate mode** (no `api` config block) it learns endpoints from browser XHR traffic captured into `output/requests/`, in **achieve mode** it reads an OpenAPI spec. This design fixes replicate mode, which has never worked reliably.

## Evidence

Langfuse traces contain only two real Fisherman episodes (2026-04-30 and 2026-06-01); every August export has zero Fisherman spans, so the August fixes (#133) have no behavioral data behind them.

- **Jun 01 01:28 — the one clean success.** 12 tool calls: a 400 on a missing field, retried correctly, parent suite created, test created inside it, `finish` with both real ids. Error-driven recovery worked.
- **Jun 01 01:30–01:32 — poisoned by the success.** The 01:28 run's own *rejected* bodies were handed back to the next runs as "the captured request example". They spent 20–49 requests guessing body shapes. One "succeeded" on the third invocation after ~155 model calls, with weak evidence: the reported created id was one an earlier run had *read* out of a GET list.
- **Apr 30 — false success.** Asked for a milestone; no milestone endpoint existed, so it POSTed to `/tests` and reported a created milestone. Pilot passed that to the Tester as a satisfied precondition. The prompt's endpoint list also contained a write endpoint from a different project. `stop` was never called in any episode; runs that hit max iterations reported nothing at all.

## Root causes (verified in current code)

1. **Self-poisoning store.** `addMadeRequest()` saves every request Fisherman itself makes — 400s included — into `output/requests/`. `loadFromDisk()` reads the whole directory back as `capturedRequests`, indistinguishable from browser XHR. Replicate-only: achieve mode never calls `loadFromDisk`.
2. **First-match spec lookup.** `findCapturedRequest()` is `find(method && path.startsWith(prefix))` — a stale 400 displaces a good 200, and `/suites` matches `/suites/123/move`. #133 only labels rejected captures `usable: false`; it does not rank.
3. **Scope filter never matches.** `getWriteRequestsForScope()` prefix-matches a page URL (`/projects/…`) against API paths (`/api/…`) — always falls through to `'/'`, silently, giving every captured write from every project.
4. **`finish` is unconditional success.** It writes the model's `created` array through verbatim; nothing checks it against what HTTP actually returned.
5. **Silent exhaustion & clobbered status.** No `finish` → `summary: ''` → Pilot logs nothing and the vision fallback is told the reason is "unknown". In the `request` tool, `...extractKeyFields()` spreads after the `status` key, so a body field named `status` overwrites the HTTP status, and the depth-5 first-id scan surfaces ids the run never created.

## Design decisions

1. **Provenance by id prefix, not a new envelope key.** File ids already encode the writer: `xhr_*` from `xhr-capture.ts`, unprefixed from `api-client.ts`, and `fail_*` records never reach disk. `loadFromDisk()` admits only `xhr_*` files. Poisoned directories migrate for free; a directory with only Fisherman-made files now correctly yields replicate mode disabled.
2. **Ranked lookup.** `findCapturedRequest` ranks candidates: exact segment-count match > deeper sub-path, then `status < 400` > rejection, then newest timestamp. An exact-path rejection deliberately beats a sub-path success — the `usable: false` branch explains it to the model.
3. **Shared path normalization.** Id-shaped segments are detected by the existing `isDynamicSegment()` (`src/utils/url-matcher.ts`) and printed as `{id}` in endpoint lists; lookup normalizes both sides, so patterns and concrete ids both match. Over-generalization (e.g. `/api/v2/…` → `/api/{id}/…`) is accepted: `getEndpointSpec` returns the concrete stored path, and the workflow mandates a spec lookup before first use.
4. **Scope = most selective shared segment.** Score each page-URL path segment by how many captured writes contain it; the scope key is the non-zero segment with the fewest matches, leftmost on ties. The project slug beats generic literals like `projects` structurally, with no site-specific knowledge. When nothing matches, the list degrades to global — and the system prompt says so.
5. **`finish` gated by the request ledger, not replaced.** `createFishermanTools` snapshots the made-request count; "this run" is everything after it. `finish` with zero successful writes is rejected back to the model (it can keep working or `stop`). Claimed ids are verified against actual 2xx write responses; verified items carry `via: "POST /api/…"` so Pilot sees what ran; unverifiable ids are dropped. When the loop ends without `finish`, the result is synthesized from the ledger — honest summary, ledger-derived created items — never an empty string.
6. **Deterministic loop guard.** Four consecutive failures (HTTP ≥ 400 or network error) against one endpoint end the run — the API-side analog of StateManager's dead-loop detection.
7. **One general prompt rule** against substituting resource types: if no endpoint creates a requested type, `stop` — never create a different type. (Ledger id-verification alone cannot catch the milestone→test case, since that POST genuinely succeeded.)

All checks are deterministic-tier (structural matching, closed vocabularies); the model keeps judgment over what to create and how to describe it — the generate-then-verify ladder from CLAUDE.md.

## Out of scope

- Achieve mode (OpenAPI-driven) behavior.
- Cross-session reuse of captures beyond what the `xhr_` filter admits.
- New agents, tools, or envelope keys.

## Acceptance criterion

One regression trace where `precondition()` returns created ids and those ids are visible on the page the Tester then acts on. The regression run is triggered only by the user via the `regression` label.

## Implementation

`docs/superpowers/plans/2026-08-29-fisherman-reliability.md`
