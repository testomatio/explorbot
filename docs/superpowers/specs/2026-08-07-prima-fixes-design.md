# Prima Fixes — Perception Ladder, No Heal, Proof-Carrying Envelopes

**Date:** 2026-08-07
**Status:** Draft for review
**Supersedes parts of:** `2026-08-01-prima-boat-design.md`
**Evidence:** `docs/superpowers/reviews/2026-08-06-prima-vs-playwright-cli.md`

## Problem

A field run of prima against a live app (Testeiya, `localhost:3050`) found the boat working but
not trustworthy as an executor. Four defects matter:

- A `pw` call on a selector that does not exist returned `ok: true`, `healed: true`, having
  clicked an unrelated control ("New agent"). Heal substituted the target and reported success.
- `### Changes` never appeared in any successful envelope, so a successful action proved
  nothing and every step had to be confirmed with a playwright-cli snapshot.
- `do` given two instructions performed four, typing into a live chat box actions nobody asked
  for.
- Auto-discovery of a playwright-cli session never matched, while the failure message advised
  opening the session the user already had open.

Underneath the third defect is a perception problem. `action.ts:139` captures
`page.locator('body').ariaSnapshot()` **without** `mode: 'ai'`, so `do` sees roles and text but
no element handles and must invent locators. That is why the `click` tool's schema demands
"multiple commands targeting the SAME element" and why one click produced five ladder attempts,
one of them invalid JavaScript.

## Goals

- Prima is the executor for an expensive orchestrator: page data never enters that context on
  the happy path, intent is never guessed, and every action carries proof of what changed.
- `do` acts on element handles it was given, not on locators it invented.
- Failures are failures. No code path may reach a different element than the one asked for.
- Attachment to an existing playwright-cli session works without hand-editing files.

## Non-Goals

- Replacing playwright-cli. It remains the fallback for direct driving and the tool prima
  points back to when it cannot help.
- Reducing per-command latency, and improving `research` locator quality. Separate concerns.
- Changing Tester, Navigator, or Researcher behaviour outside the shared pieces named below.

---

## 1. Perception ladder for `do`

Four tiers, tried in order. Each tier answers "what can I act on here?" at a different cost.

| Tier | Source | When |
|---|---|---|
| 1 | Research UI map | a stored map exists for this state hash and the state is well-visited |
| 2 | **ARIA snapshot with refs** | default |
| 3 | Compact HTML tree | a ref action failed, or the control is absent from the ARIA tree |
| 4 | Vision (`visualClick`) | click only, when the target is identifiable solely by appearance |

### Tier 1 — research map

Read through `getPreviousResearch(hash)` — a TTL-free disk read. Not `getCachedResearch`, whose
six-hour TTL carries session-scoped semantics that must not be stretched for cross-invocation
reuse. The trigger is the StateManager visit count for the current state hash, the same number
the envelope already prints as `visit #N`: use the map from the **third visit onward**, so a
state has to prove it is worth the map before prima prefers one. Below that, skip to tier 2.
The threshold is a single config field under `ai.agents.prima`, per the one-knob convention.

Research cost is real — 41s on the vision model in the field run — so tier 1 only pays off
amortized across repeat visits to one state. Prima does not run research on the caller's behalf
inside `do`; it consumes a map that already exists.

### Tier 2 — ARIA snapshot with refs (the default)

`page.locator('body').ariaSnapshot({ mode: 'ai' })` emits `[ref=eN]` handles. Playwright resolves
them natively through the `aria-ref=` selector engine, verified live against the running app:

```
aria-ref=e1 → 1 match
```

No DOM mutation, no attribute stamping. The model is given the ref-bearing tree and names a ref;
resolution to a CodeceptJS command is §1.1. One ref becomes one command and the
multiple-locator fallback ladder collapses.

**Ref lifetime is one context injection.** Refs are snapshot-scoped and shift between calls —
in the field run the same sidebar button was `ref=e13` in one snapshot and `ref=e284` in a later
one on the same page. Prima re-snapshots whenever the `do` loop re-injects context on state-hash
change (the hook exists at `prima.ts:104`), and the prompt states that refs from an earlier
injection are dead.

**Ref shape.** Refs are frame-qualified: every ref this app emits is `f1e13`-shaped, not `e13`.
A validator that accepts only `e\d+` rejects every real ref and silently disables the whole tier,
so the accepted shape is `(f\d+)?e\d+`. Refs are never adapted or invented — a ref that does not
parse, or that resolves to nothing, is a failure with its own message.

### Tier 3 — compact HTML tree

The current `simplifiedHtml` path. Entered when a ref action fails or the target is not
represented in the accessibility tree.

### Descending the ladder — `context()`

The tiers above are only reachable if something can move between them mid-run. The `do` loop
re-injects context between iterations when the state hash changes, which leaves no way to
recover from a ref that died *within* an iteration — the model's only remaining moves would be
to guess a locator, which the prompt forbids, or to stop.

`do` therefore carries a `context` tool. First call returns the page as it is now with fresh
refs, which replace every ref the model was holding; a later call on the same page drops to
capped markup for elements the accessibility tree does not describe. It is the tier descent, not
a page dump.

This is deliberately **not** the `context` tool from `createAgentTools`. That one returns
`getInteractiveARIA()` — `compactAriaSnapshot` over `ActionResult.ariaSnapshot`, captured without
`mode: 'ai'`, so it carries **no refs** — plus a 6k-char HTML dump beside it. Offering it here
would hand the model a ref-less tree and push it straight back to guessed locators, undoing
tier 2.

### Tier 4 — vision

`visualClick` (`src/ai/tools.ts:791`), already implemented. Click only — a coordinate is not a
handle, so it cannot serve fills, selects, or assertions.

### 1.1 Acting on a ref — `clickRef` / `hoverRef` in `boat/prima/src/tools.ts`

CodeceptJS has no `aria-ref` locator, so a ref cannot be handed to `I.click()` directly. It is
resolved to a locator CodeceptJS does understand, using machinery that already exists:

```
page.locator(`aria-ref=${ref}`)
  → WebElement.fromPlaywrightLocator(...)     (web-element.ts:112)
  → I.click(<xpath>)
```

**Which XPath, and the one that is not available.** `WebElement` declares two — `clickXPath`,
built attribute-first by `buildClickableXPath` (`utils/xpath.ts`), and `xpath`, the absolute
positional path. On this path only `clickXPath` exists: `fromPlaywrightLocator` builds through
`fromRawData`, which hardcodes `xpath: ''` (`web-element.ts:89`). Only `fromXPathMatch`, the
static-HTML path, populates the absolute form. So there is no positional fallback to reach for,
and that is the right outcome anyway — an absolute path is deduplication machinery, fragile the
moment the DOM shifts, and the ref resolution and the click happen on separate round-trips.

Verified live, ref → `clickXPath` → match count:

```
e15  link "Checking the proxy…"  //*[self::a and contains(.,"Checking the proxy and the firewall")]  → 1
e19  button "Reload"             //*[@id="reload-button"]                                            → 1
e20  button "Details"            //*[@id="details-button"]                                           → 1
```

**Require a unique match.** Because there is no fallback, the resolved `clickXPath` is checked
to match exactly one element before it is used. Zero or many is a failure, reported as such —
never a click on an ambiguous match and never a retreat to guessed locators.

Ref acting lives in **separate tools in the boat** — `clickRef` and `hoverRef`, from a
`createRefTools` factory in `boat/prima/src/tools.ts`. `click` and `hover` in `src/ai/tools.ts`
are left byte-identical. A prima-only tool belongs to prima; core keeps only what every caller
uses, and lends the boat its result-shaping helpers (`successToolResult`, `failedToolResult`,
`commitNote`) rather than having them copied.

Adding an optional `ref` to the existing tools looks cheaper and is wrong. A tool's schema and
description are shared with every caller, and Tester never receives ref-bearing snapshots, so it
would be shown a parameter it can only fill by inventing one. Making `commands` optional to
accommodate the new field weakens the contract for Tester too. "Prima enables ref mode, Tester is
untouched" is not achievable through one definition: there is one definition, and Tester sees it.

Each ref tool takes a ref and nothing else, resolves it, executes one command, and reports that
command as `used:` — real CodeceptJS a generated test can keep. A ref that does not resolve is a
failure, not a cue to fall back to a guessed locator: it means the context is stale.

`hoverRef` exists for the same reason as `hover` — revealing hover-only controls is a
prerequisite for clicking them.

Prima keeps the locator tools alongside the ref tools: tier 3 works from markup that carries no
refs, and needs them. Tier 4 keeps the coordinate input.

---

## 2. Heal is deleted

`heal()` (`prima.ts:428-460`) is removed, along with `--no-heal`, `PrimaOptions.heal`, the
`healed:` / `healNote` envelope fields, the `HealAttempt` type, and the
`### Healing attempts` section. The three call sites — `pw` (`:79`), `do` (`:135`), `go` (`:211`)
— go straight to `failureEnvelope`.

The failure envelope already does the right thing and becomes the only failure path: `ok: false`,
the exact error with its call log, and compact ARIA inline. Measured at 8.6s in the field run
against 34.8s for the heal path that got the answer wrong.

This removes the substitution defect at the root. No remaining code path can select an element
other than the one asked for, so no envelope can report success for an action the caller did not
request. Routine obstructions — an overlay covering a button, an element not yet visible — now
return the failure envelope, and the orchestrating model decides. That is the accepted cost: the
compact ARIA block is the one place page data deliberately enters the expensive context.

---

## 3. Proof-carrying envelopes

Two defects with one cause. `renderOutcome` (`envelope.ts:76`) returns the **first** of
changes / answer / research / verdict, so `### Changes` is structurally impossible alongside
`### Verdict`, `### Answer`, or `### Research`. And `pageChanges` returns `ariaChanges ?? null`,
which renders nothing when the diff is empty or `previousState` is null.

- `### Changes` renders on every action envelope, showing `no change` explicitly when the tree is
  identical. A caller can then tell "nothing happened" from "prima did not say".
- `renderOutcome` stops being mutually exclusive: `### Changes` renders alongside the command's
  own outcome section.
- Prima captures an explicit before-snapshot rather than relying on whatever `stateManager`
  holds at process start.
- New `### Steps` block for `do`: one line per instruction, each naming the ariaDiff entry that
  proves it, or marked `unproven`.

### Refs must never reach the diff or hash pipeline

The ref-bearing snapshot is a **context artifact only**. Refs are stripped before hashing and
diffing. Storing the `mode: 'ai'` output in `ActionResult.ariaSnapshot` would poison every
`### Changes` block, because Playwright renumbers refs on each call. Measured on an identical
page whose refs merely shifted:

```
ref churn only, page identical → diff count = 6
  added:   button "Cancel" [ref=e21], button "Save" [ref=e20], textbox "Name" [ref=e22]
  removed: button "Cancel" [ref=e11], button "Save" [ref=e10], textbox "Name" [ref=e12]
```

Six phantom entries for a page that did not change. Capture ref-bearing and ref-free variants,
and feed only the ref-free one to `diffAriaSnapshots` and `getStateHash`.

---

## 4. Executor prompt

`instructionSystemPrompt` (`prima.ts:493`) already says to stop when every instruction is done,
but nothing tracks per-instruction completion, so the loop runs until the model stops calling
tools. Two rules are added, stated as general principles rather than as counter-examples from
any debugging session:

- Act only on the listed instructions. An adjacent action that appears helpful is out of scope;
  report it as an observation instead of performing it.
- For each instruction, cite the observed page change that proves it. An instruction that cannot
  be tied to an observed change is reported unproven rather than claimed as done.

The prompt also states the ref contract: act on refs from the current context injection; refs
from an earlier injection are dead.

---

## 5. Attachment and discovery

Three separate faults, all confirmed empirically.

**Connect with the daemon's own build when attached.** `connectDescriptor` (`prima.ts:374`)
tries prima's own playwright first and only falls back to `descriptor.playwrightLib` if connect
fails. Connect *succeeds* across builds, so the fallback is never reached — and then the tier-2
snapshot breaks:

| client lib | `connect()` | `ariaSnapshot({mode:'ai'})` |
|---|---|---|
| own playwright 1.62.1 | ok | `locator.ariaSnapshot: timeout: expected float, got undefined` |
| daemon playwright-core 1.62.0-alpha | ok | ok, 3376 bytes, `aria-ref=e1` → 1 match |

In attached mode, prefer `descriptor.playwrightLib` when present and fall back to our own. Carry
`playwrightLib` through the `--endpoint` path too, which currently hardcodes `''`.

**Stop keying discovery on `workspaceDir`.** No `@playwright/cli` release writes that field —
verified on 0.1.13 and 0.1.17. `parseDescriptor` (`pw-registry.ts:56`) requires it and
`selectDescriptor` filters on it, so every descriptor is dropped and discovery finds nothing no
matter what is installed. Resolution becomes: `--endpoint` → `--pw-session <title>` →
`PLAYWRIGHT_CLI_SESSION` → live descriptor titled `default` → the single live descriptor →
tool error listing candidate titles. Liveness-probe before selecting.

**Bump the playwright pin to `^1.62`.** `playwright@^1.60` could not `connect()` to a 1.61/1.62
browser server at all; 1.62.1 connects. The pin is the reason the original review concluded
attach was broken outright.

Consequences: `browser list` shows attachable sessions rather than reporting none while one is
live, and the no-browser error stops advising `playwright-cli open <url>` to someone who already
ran it.

---

## 6. `verify` honesty

`rules/navigator/verification-actions.md` offers nine assertions — `see`, `seeElement`,
`seeInField`, `seeInTitle`, `seeInSource` and their `dontSee*` counterparts — none of which
express enabled, disabled, checked, selected, or expanded. A claim about interactive state is
therefore unprovable by construction, and the field run reported a working feature as failing:

```
verify "the Save button in the skill editor is now enabled ..."
→ passed: false, code: (empty), evidence: no assertion held on the current page
```

The app was correct — `● unsaved` was displayed and the button was enabled.

- Add state assertions to the rule.
- `verify` distinguishes **assertion failed** from **could not express this assertion**. The
  second is not a test failure and must not be reported as one.
- With §7's compaction fix, `verify` reads state from the same ref-bearing snapshot the tier-2
  ladder produces.

---

## 7. Prerequisite fix — ARIA compaction drops refs and state

`compactAriaSnapshot` keeps only the first bracket group on a line. Playwright emits state
attributes before `[ref=]`, so every stateful control loses its handle. Measured:

```
button "Plain"    [ref=e10]              → ref KEPT
button "Active"   [active]   [ref=e13]   → ref LOST
button "Disabled" [disabled] [ref=e14]   → ref LOST
button "Pressed"  [pressed]  [ref=e15]   → ref LOST
button "Expanded" [expanded] [ref=e16]   → ref LOST
checkbox "Checked" [checked] [ref=e17]   → ref LOST
button "Cursor"   [ref=e18] [cursor=pointer] → ref KEPT
```

The controls most worth acting on and asserting about are exactly the ones stripped of their
handle. **Keep every bracket group on a line.** No allow-list, no drop-list — parsing one group
and discarding the rest is the whole bug, and any rule about which groups survive re-creates it
the next time Playwright adds an attribute. This fix is a prerequisite for §1 tier 2 and enables
§6.

---

## 8. Envelope hygiene

- `used:` carries the winning line only — no concatenated ladder attempts, no comment lines. The
  field run produced `I.click(".sidebar button:has-text("Workflows")")`, which is not valid
  JavaScript, and a `// 1. Open dialog...` comment inside the code block.
- `click` and `fill` stop labelling themselves `do` in `command:`.
- `network.jsonl` is written and advertised only when requests were actually captured. It was
  0 bytes across all 18 runs while being advertised in every envelope; an artifact line that
  points at an empty file is worse than no line.
- Research annotation overlays are removed from the DOM after use. The browser is shared with
  playwright-cli, and leftover `Legend` / `e8` / `e10` nodes appeared in its next snapshot.
- Commands stop requiring a URL when attached to a browser already on a page.
- A redirect that preserves origin and path counts as navigation success. The app's
  `/` → `/?session=<uuid>&ws=1` redirect cost 3m00s and eight attempts under the old heal path,
  and a hard tool failure against a prima-owned browser — in an envelope whose own inlined ARIA
  proved the page had loaded.

---

## Testing

- **Unit** — envelope rendering with `### Changes` always present, including the `no change`
  form and the combination with `### Verdict` / `### Answer` / `### Research`; compaction
  preserving every bracket group across the §7 combinations and any order of them; ref-free
  diffing (the six-phantom case must yield zero); descriptor selection without `workspaceDir`,
  including the ambiguous multi-session error.
- **Ref resolution** — a ref resolves to an attribute-based `clickXPath` matching exactly one
  element, and still matching after unrelated siblings are added or removed; a ref that resolves
  to zero or many fails rather than falling back to a guessed locator.
- **Integration** — `do` prompt behaviour through the existing `@copilotkit/aimock` harness per
  `docs/contributing/ai-integration-tests.md`: instructions performed and nothing beyond them,
  per-instruction proof citation, unproven reporting. Fictional fixture data only.
- **End-to-end** — against a local fixture: a ref named from the snapshot clicks the element it
  names and no other; a failing `pw` returns `ok: false` with compact ARIA and never a
  substituted action; attach to a live playwright-cli session with no descriptor editing; a
  session-param redirect resolves as success.

---

## Decisions Log

- Heal is deleted outright rather than constrained to same-target recovery. No flag, no opt-in.
- `do` perception is a four-tier ladder: research map, ARIA with refs, compact HTML, vision for
  click.
- Refs come from Playwright's native `aria-ref=` engine. No eidx attribute stamping, so the
  shared browser's DOM is not mutated.
- Ref acting lives in `boat/prima/src/tools.ts`, not in core; `click` and `hover` are untouched.
  Extending a shared tool would show Tester a `ref` parameter it can only fill by inventing one,
  and would weaken `commands` for every caller.
- A ref resolves through `WebElement` to an attribute-based `clickXPath`. The absolute positional
  `xpath` is not a fallback — `fromRawData` never populates it on the live-locator path, and it
  would be the fragile choice regardless.
- A resolved `clickXPath` must match exactly one element. A dead or ambiguous ref is a failure,
  never a fallback to guessed locators.
- ARIA compaction keeps every bracket group. No allow-list of attributes to preserve.
- Refs are a context artifact only, stripped before hashing and diffing.
- Ref lifetime is one context injection; the loop re-snapshots on state-hash change.
- Tier 1 reads maps via `getPreviousResearch`; the trigger is StateManager visit count.
- Discovery matches on title plus liveness; `workspaceDir` is abandoned as a key.
- Attached mode connects with `descriptor.playwrightLib` first, because connect succeeds across
  builds but `ariaSnapshot` does not.
- The playwright pin moves to `^1.62`.
- `verify` reports inexpressible assertions as inexpressible, never as failures, and does not
  record them as verifications — a claim that could not be checked must not be remembered as
  one that failed.
- `do` carries a prima-shaped `context` tool that descends the ladder — fresh refs first, capped
  markup on a repeat call. The shared `context` from `createAgentTools` is not reused: it returns
  a ref-less tree and an HTML dump.
- The baseline snapshot is captured lazily when a command needs a diff, not in `start()`, which
  runs before a page is loaded.
