# Prima False Verdicts — No Reload, Vision-Confirmed Outcomes, Unconfirmed ≠ Failed

**Date:** 2026-08-18
**Status:** Implemented
**Follows:** `2026-08-07-prima-fixes-design.md`
**Evidence:** field feedback from an orchestrator driving prima over eight calls

## Problem

Prima returned verdicts that did not match what happened, in both directions.

- `prima do` reported `error: open: <instruction>` for clicks that had landed. The caller only
  found out by screenshotting anyway — which is the cost the boat exists to remove.
- `prima check` returned `ok: false` for an environmental reason and said nothing about it.
- No command answered a visual question with a verdict. `check` and `verify` never read a
  screenshot; `ask` read one but returned prose.

The skill tells callers to trust `### Result`. A false red trains them out of that, and then the
greens stop meaning anything either.

## Mechanisms found

1. **`check` reloaded the page before checking it.** `prima.check()` → `tester.test()` →
   `runTestSession` → `explorer.visit(task.startUrl!)` (`tester.ts:192`, unconditional) →
   `I.amOnPage()` (`explorer.ts:431`) → `page.goto()`, which reloads even on the same URL.
   `task.startUrl` is the page the caller is already on. Any transient state — an open dialog, a
   selected tab, an unsaved form — was destroyed by the command asked to inspect it. This was
   guaranteed, not a race with a dev-server reload.
2. **`check` could not say why it failed.** `reportEnvelope` never sets `failure`, and
   `envelope.steps` was built only from notes with `status === FAILED`. An abort produced
   `ok: false` with an empty Steps section and no Failure section.
3. **`do`'s verdict was the model's bookkeeping, not the page.** An instruction the model never
   passed to `completed()` was rendered as an error, so an envelope could show every step green
   and `ok: false` at once. `settleLedger`'s `.catch(() => null)` made a provider error
   indistinguishable from a model that would not report.
4. **Vision routing was per command, not per question.** `verify` produced DOM assertions only;
   `check`'s verdict came from that same tool plus `settleExpectations`, which judged a text log.
   The `inexpressible` branch told the model to "check it with `see()`" with no model in the loop
   to act on the suggestion.
5. **`prima status` printed the page tree.** `saveStatus` stored the full compact ARIA under
   `changes`, so the command whose job is to cite artifact paths dumped the tree inline instead.

## Changes

### 1. `check` starts where the caller is

`Tester.test(task, opts)` takes `startOnCurrentPage`, which skips the initial visit. Prima passes
it. Nothing else changes for the explore flow, where reload-to-start-url is intentional.

`reset` needs no guard: it already refuses when the current URL equals the start URL, which is
the case for a check that starts in place. Once a check has navigated away, resetting back is
the right behaviour anyway.

### 2. The screenshot is the proof, and a disagreement is a finding

`settleExpectations` is called from exactly one place, `prima.ts`, so it is prima's final judge
and can change without touching the explore flow. It now takes the final `ActionResult` and, when
that carries a screenshot and a vision model is configured, settles every outcome in one
structured call on the vision model with the image attached.

The screenshot is not one of two equal inputs. An outcome is satisfied when the page shows it to
somebody looking at it; the log only says what the run did. The prompt says so.

**Where the two disagree, the judge does not choose.** It reports `conflict` and says what each
side shows. A value present in the page structure but absent from the picture — element hidden,
container collapsed, covered by an overlay, drawn off-screen — is a defect in the application, and
it is exactly the case both other verdicts destroy: `passed` hides it behind an assertion that
happens to match, `failed` mislabels a feature that half works. It is the most valuable thing a
run can find, so it comes back as its own status with both sides quoted, and it fails the command.

The screenshot is the final page only. An outcome the run established earlier stays established
even when the page has moved past it, and the prompt says that is not a conflict — otherwise every
"record deleted, then navigated away" scenario reports one.

There is no line describing which evidence the judge had; that is plumbing, not a fact about the
app. When no screenshot backed the outcomes — no vision model configured, or the vision call could
not produce a verdict, which falls back to the text model and flips `Stats.visionDisabled` — the
envelope carries a `### Warning` saying the outcomes came from the run log alone. That appears only
when something is wrong with the setup, not under every run.

### 3. `check`'s verdict is its outcomes

`ok` no longer comes from `tester.test()`'s success flag, which could contradict the outcomes
printed beside it. `ok: true` when no outcome failed and none conflicted; each failure and each
conflict names itself in `### Failure`. `unverified` is not a failure — it is a statement about
the run, matching what the help text already promised.

A run that could not complete is reported separately from an application failure: when the test
never finished or was skipped, the envelope says the run established nothing and cites the last
step recorded.

### 4. `do` distinguishes failed from unconfirmed

`ok` is a function of what ran, not of the paperwork. An action error or a `blocked()` fails the
command. An instruction the model never reported becomes a `??` row in `### Steps` — the actions
that ran are listed above it — and does not fail the command. An AI error while settling the
ledger is reported as its own step rather than attributed to the instruction.

The `<proof>` block gains one general line: how much of the page moved is not evidence of whether
something happened. A change confined to one region proves an instruction as well as one that
redraws everything.

### 5. `verify` reaches for vision when no assertion can express the claim

The `inexpressible` branch now judges the claim from a screenshot and reports the judgement,
instead of dead-ending on a suggestion nothing acts on. Because Tester's `verify` tool calls the
same `navigator.verifyState`, this covers `check` as well.

`Prima.visionEnabled()` also honours `Stats.visionDisabled`, so a session that lost vision
mid-run stops claiming to have it.

### 6. `status` cites artifacts instead of reprinting the page

The ARIA blob is gone from `status.json`. `status` returns the page block and the artifact paths,
which is its whole job.

## Decisions Log

- `check` starts on the current page. A command that inspects transient UI must not destroy it.
- Vision is not a fallback in `check`; it closes every run that has a vision model. The
  screenshot is the proof — what a user can see — and the run log only says what was done.
- A disagreement between the page and the run is reported as `conflict`, never settled one way.
  Something in the DOM that is not on the screen is a defect, and both `passed` and `failed`
  would bury it. A conflict fails the command.
- `settleExpectations` judges all outcomes, not only undecided ones, when it has a screenshot —
  otherwise a DOM assertion the run already made could never be contradicted by the page.
- `unverified` is not a failure, in `check` outcomes and in `do` instructions alike. A statement
  about the run is not a statement about the application.
- Bookkeeping is not evidence. `do`'s `ok` follows actions and blocks; an unreported instruction
  is surfaced, never rendered as an error.
- A run that could not complete is reported as such, never as an application failure.
- `provider.getVisionModel()` is added for symmetry with `getModelForAgent`/`getAgenticModel`;
  `processImage` returns free text and cannot carry a per-outcome verdict.
- A failed vision judgement falls back to the text model and flips `Stats.visionDisabled` — the
  existing global for "vision is not usable this session" — which prima reads through
  `visionEnabled()`.
- No line reports which evidence the judge had; that is plumbing. Only the degraded case is
  stated, as a `### Warning`, because only that case is a fact the caller must act on.
- The verdict vocabulary lives in `prima <command> --help`. A marker the caller can see in an
  envelope but cannot look up is not documented.

## Not done

- `explorer.beginTest` still calls `closeOtherTabs()`, so `check` closes other tabs of an
  attached session. Guarding it means threading an option through `beginTest`, which every flow
  shares.
- `do` gets no vision confirmation pass. Its `completed()` proof is the same kind of unverified
  paperwork, but a per-instruction vision call is a different cost profile.
- The `prima` skill in `testomatio/skills` documents the old envelope vocabulary. It needs the
  `??` row, the `CONFLICT` status, and the unconfirmed-is-not-failed rule.
