# Judge — a decision model tier — Design

Explorbot resolves every open-ended judgment with a generative model. This design adds a second tier: a *decision model* that answers one narrow typed question and returns a probability distribution over the answers you defined, plus a confidence derived from that distribution. TypeSafe calls this class a System One model; its first is Jev.

The tier is optional. Without `ai.decisionModel` set, nothing registers and nothing calls out — the acceptance test for the whole design is that an unconfigured run is byte-identical to today.

Two entry points, independently disableable:

- a `judge` tool the Tester and Pilot call when they need a yes/no or a pick-one, the way they already call `see()`
- direct calls from code at fixed sites — five in Explorbot core, two in Prima — where a typed answer can gate behaviour without a model round-trip

## Evidence

`output/plans/` holds twelve session post-mortems written between 2026-08-21 and 2026-09-17. Seven are plumbing, and no model tier touches them: a listener registered for both `step.passed` and `step.failed` (`src/action.ts:595`), `updateState` discarding accumulated `verifications` (`src/state-manager.ts:143`), `visualClick` missing from `DELEGATED_ACTION_TOOLS`, `tooltip` missing from `LIVE_REGION_ROLES` (`src/utils/html-diff.ts:40`), a deletion gate computed from a set that structurally excludes the running test, an unbounded HTML diff, and `analyzeProgress` never being passed `<notes>`.

The other five are judgment, and each one's own *Trade-off* section names a residual the prompt fix cannot express:

- **`fix-pilot-skipped-prerequisites.md`** (trace `c1406df8`). `fail` partitions on outcome while `skipped` partitions on whether a control responded; the correct partition is one question — *did the app hold the data/state the scenario presumes?* Clicking `«` on page 1 of a list is not a defect, and the verdict was `fail`. The trade-off: "a control dead from a real defect and a control dead at a data boundary produce an identical session log… can misfile a genuine bug as `skipped`." For a testing tool that is a silent false negative. The fix is still unapplied: `src/ai/pilot.ts:121` carries the pre-fix text.
- **`disabled-control-single-cause.md`** (trace `a51c50de`). Pilot's `<state>` carried `disabled buttons: No matched tests, Launch, Save` and an `active form` block with no `[required]` marker. Pilot steered at the title field for the whole run, burning four `see()` calls and three contradictory `record()` calls on a guard that does not exist. Trade-off: where the app names no constraint, Pilot "falls back to the scenario's field exactly as today" — silently.
- **`picker-always-picks-first-item.md`** (traces `176eb0ac`, `8eb030b1`). `src/ai/tester.ts:809` is the only rule governing which item to take from a list, and its sole criterion is "not empty". Across three picks in two sessions the tester chose row 1 every time. Trade-off: the graded rewrite "may still converge on the same 'richest' item across independent sessions."
- **`pilot-named-instance-vs-capability.md`** (trace `80a2e0dd`). The scenario named `MySuite_20260811_001`; the page held `MySuite_20260811_00`. The run died in 82 seconds with zero pin actions. The fix is a paragraph in `capabilityGroundingRule`, one string included by three separate prompts. Trade-off: "it now rests on the model's read of whether the instance is the target or the goal."
- **`researcher-invents-pagination-control.md`**. Out of scope here; the primary fix is ordering (`detectPagination` first), which is a code change with or without a decision model.

Two of the five diagnose prompt divergence as the mechanism. `disabled-control-single-cause` notes the negative-goal rule lives in `getSystemPrompt` but not `buildVerdictSystemPrompt` and calls the divergence "the general problem, not this trace." `fix-pilot-skipped-prerequisites` found one `generateObject` call carrying two contradictory definitions of `skipped` — the system prompt's and the schema's `.describe()` — and a third phrasing at `src/ai/pilot.ts:234`. The Tester's system message currently holds 45 decision bullets; `src/ai/pilot.ts` holds 50.

## What Jev is, and what it cannot do

Constraints that bind every decision below, from the vendor docs:

- **Text only.** No images. Every vision path is out.
- **64k tokens for state and all questions; 32k for state plus the longest question.** `combinedHtml()` does not fit.
- **No generation, no tool calling.** It answers questions; it does not act or write prose.
- **Literal reader.** Unreliable at counting, dates, and arithmetic. Keep those in code.
- **Context rot.** Accuracy falls as the state grows with material the question does not need.
- **State is not treated as hostile.** Explorbot feeds it content from the site under test.
- **Noul carries no `confidence` field.** Choice and Score return `probabilities` and `confidence`; Noul returns one 0–1 probability.
- Priced at $0.042/Mtok input, output free; 1200 requests/minute. Questions in one request are evaluated in parallel and in isolation, so asking a question you may not need is nearly free.

## Transport, verified live 2026-09-18

`typesafe/jev-1.13` serves on OpenRouter through a dedicated route. `chat/completions` rejects it — *"is a decisions model and cannot be used with the chat/completions endpoint"* — and the native shape passes through unchanged:

```
POST https://openrouter.ai/api/alpha/decisions
  { "model": "typesafe/jev-1.13", "state": {...}, "questions": { id: {type, instructions, criteria} } }
→ { "answers": { "blocked": {"type":"noul","noul":0.97},
                 "target":  {"type":"choice","choice":"copy",
                             "probabilities":{"copy":0.48,"root":0.41,"cancel":0.11},
                             "confidence":0.21} },
    "usage": {"input_tokens":372,"output_tokens":54,"cost":0.000015624} }
```

`probabilities` and `confidence` survive the trip, so nothing about the design depends on the direct TypeSafe API. Endpoint metadata reports a 32,000-token context, `$0.000000042` per prompt token, free completion, and `max_completion_tokens: 28800`. The existing `OPENROUTER_API_KEY` authenticates it; no second account is needed.

The vendor documents 64k across state and all questions with 32k for state plus the longest question; OpenRouter advertises 32,000 total. Budget against the smaller figure, and treat the difference as a thing to confirm rather than a contradiction to resolve on paper.

That first probe is the design in miniature. It picked `copy`, but at 0.21 confidence with `root` nearly tied — correct, because the Copy button was disabled and a destination had to be selected first. Acting on `choice` alone clicks a dead button; the distribution says to hold.

## Measured behaviour on our own traces

Two states reconstructed from post-mortems, asked as one fan-out request each (~550 input tokens, $0.00002 per call).

**A** — trace `c1406df8`, previous-page clicked on page 1 of 1. **B** — trace `bbc69562`, four failed clicks followed by two successful `visualClick`s that moved a switch.

| Question | A | B | Truth |
|---|---|---|---|
| `route` Choice: continue / reobserve / call_pilot | `call_pilot`, conf **0.72** | three-way tie, conf **0.08** | escalate / continue |
| `prereq_absent`: "the app never held the data or prior state the task presumes" | 0.58 | 0.45 | yes / no |
| `no_prior_page`: "There is no page of rows before the one currently shown" | **0.88** | 0.50 | yes / n-a |
| `changed`: "The last action changed the page" | 0.03 | 0.83 | no / yes |
| `goal_unreachable` | 0.66 | 0.24 | yes / no |
| `repeating`: "repeating an approach that already failed" | 0.47 | 0.57 | no / yes |

Five results shape the decisions below:

1. **Literal phrasing beats abstract on identical state.** `prereq_absent` 0.58 versus `no_prior_page` 0.88 is the same underlying judgment, reworded. This is the vendor's documented literal-reading failure, reproduced on our own trace.
2. **A composite question collapses.** "What should the runner do next" hides progress, stuckness and reachability inside one Choice and ties at 0.08 in B, while the atomic questions separate cleanly. Ask signals; route in code.
3. **The tool path is stronger than the direct path**, because only the model knows the scenario well enough to phrase the concrete question. A code-level site can ask only a generic one.
4. **`repeating` and `changed` stay deterministic.** `repeating` is coin-flip on both states, and StateManager already detects loops exactly; `changed` is `ariaDiff`, which Explorbot computes. B's actual bug was `visualClick` missing from `DELEGATED_ACTION_TOOLS` — code, not judgment.
5. **A yes/no supervision gate separates where the composite did not.** Asked as a Noul rather than folded into a route Choice, `pilot_needed` reads **0.83** on A, **0.57** on B, and **0.28** on a third state — C, a clean run where a dialog opened, a field filled and the submit control went enabled. `progressing` reads 0.28 / 0.58 / **0.94**. Only C clears both bars, so only C is skippable. Three hand-built states are a shape, not a benchmark; the threshold comes from shadow traces.

## Where it plugs in, ranked by win

Session `SelectedTheoreticalCoffee792` sets the scale: 26 tester iterations on the base model averaging **28,741 input tokens** each, 21 agentic invocations from Pilot averaging 7,557, and 3 `verify` calls each running a navigator conversation carrying full page HTML. A judge call in the probes above was ~550 tokens and $0.00002.

Two kinds of win, and they are not the same kind. Displacing an **agentic** call buys performance and price, because that model is expensive and sits on the critical path. Displacing a **base** call buys better decisions, because that model is cheap, is handed 28k tokens of page context, and guesses when the context does not separate the options.

### Agentic-model reductions — performance and price

1. **Pilot supervision gate** (`src/ai/pilot.ts:63`). The periodic review is the most frequent agentic call in a run, so gating it is the single biggest lever: a skipped round replaces a 7.5k-token expensive call with a 550-token cheap one, and it is the only item that reduces wall-clock, since the review sits between tester iterations rather than beside them.
2. **Pilot verdict axis** (`src/ai/pilot.ts:118`). One or two calls per test, so the price saving is small and the win is correctness — the `fail`/`skipped` partition currently carries two contradictory definitions inside one `generateObject` call. Measured at 0.58 in the generic phrasing code must use, so it ships in shadow and Pilot keeps deciding.

### Base-model reductions — better decisions

3. **Multiple element selection** (`src/ai/tools.ts:1277`). An ambiguous locator costs a full tester iteration to resolve and, when matches are indistinguishable, resolves to a guess. A Choice over the matches plus *none* answers it inside the tool, and a flat distribution routes to `visualClick` instead of picking. Largest correctness win in the list.
4. **Picker row selection** (`src/ai/tester.ts:809`, through the tool). Same shape at list scale, where three picks across two sessions all chose row 1. One Noul per row on visible substance, ranked in code, with `aria-selected` covering "already chosen" deterministically. A flat distribution here is the answer: interchangeable rows mean varying the pick is correct.
5. **`verifyState` dedup** (`src/ai/navigator.ts`). Semantic equality against the short list of prior claims, asked before the largest prompt in the codebase is built. A hit skips the whole round-trip and retires the `ALREADY_VERIFIED:` prefix.
6. **Experience block selection** (`src/ai/task-agent.ts:82`, `src/ai/pilot.ts:714`). Removes no call; shrinks every base prompt downstream by filtering structurally-matched blocks at the renderer, never inside `ExperienceTracker`.

### New capability — nothing displaced

7. **`verifyState` inexpressible branch** (`src/ai/navigator.ts`). The only item that answers a question the system cannot answer at all today, where the tool currently returns a dead end and records nothing.

## Design decisions

1. **`ai.decisionModel`, a single field that doubles as on/off and tuning.** A string enables both paths; an object disables either.

   ```js
   // both paths on
   ai: { decisionModel: 'typesafe/jev-1.13' }

   // direct sites only, no tool in the model's tool list
   ai: { decisionModel: { model: 'typesafe/jev-1.13', tool: false } }

   // tool only, no code-level gating
   ai: { decisionModel: { model: 'typesafe/jev-1.13', direct: false } }
   ```

   It does not join `MODEL_ROLES` (`src/config.ts:23`). That list holds Vercel AI SDK instances produced by `resolveModel()`, and `modelName`, `modelProvider` and `describeModels` all assume that shape; a System One model has no message array and no assistant text. `decisionModel` resolves to `{ model, baseUrl, apiKey }` and prints in `explorbot config` beside the other models. No CLI flag.

2. **`src/ai/judge.ts` — one file, one method.**

   ```ts
   ask(state, questions) → Record<id, { answer, probabilities, confidence }> | null
   ```

   Many questions per request, since fan-out is nearly free. It never throws: timeout, 429, malformed response and "no endpoints available" all return `null`. Judge is not an agent — it owns no verb and makes no decision of its own — so it takes no `agentXxx()` factory. It reaches agents through `AgentDeps` (`src/ai/agent.ts`, `src/explorbot.ts:207`), so no agent reads config.

3. **One question shape, at the tool and in code.** A question, and an optional map of options. Options absent means yes/no. Both cases are sent as a Choice, the two-option case included, so every answer carries a native `confidence` computed the same way. Noul may calibrate better on yes/no questions; that is one line in `judge.ts`, and now that the endpoint serves it is a measurement to run rather than an assumption to carry.

4. **The `judge` tool, registered for Tester and Pilot when `tool !== false`.** Input is `question`, optional `options`, and optional extra `context`. Output is the answer, its confidence, and the distribution.

   **Code assembles the state; the model writes only the question.** The state carries named fields — the scenario as `task`, a compact page observation as `page`, the recent tool executions as `recentActions` — which is the shape browser-use's Jev agent settled on and the shape both probes above used at roughly 550 input tokens. `page` is `getCompactARIA()` under a cap, never `combinedHtml()`: the 32,000-token window is a ceiling, not a target, and accuracy falls as the state grows with material the question does not need. Anything the model wants judged that the observation does not carry goes in `context`.

   The tool is the higher-value path, and measurement 3 says why: a code-level site can ask only a question phrased without knowledge of the scenario, while the model can phrase the concrete one. The description states the contract in general terms — one judgment per call, phrase the condition literally and concretely rather than in abstract terms, do not hide several judgments in one question, do not ask for what code can compute, prefer asking over deciding alone — with no example drawn from any trace, per CLAUDE.md's rule on prompts.

5. **Five direct call sites, six questions** — `verifyState` asks two, at different moments. Each site runs its deterministic prefilter first, calls judge, gates on confidence, and falls through to today's path on a low answer or a `null`.

   | Site | Question |
   |---|---|
   | `src/ai/tools.ts:1277` multi-element branch of `failedToolResult` | Which match does this intent mean? Options are the matches plus none. |
   | `src/ai/pilot.ts:118` `reviewDecision` | Did the app hold the data/state the scenario presumes? |
   | `src/ai/pilot.ts:63` supervision cadence | Is the run progressing, and is the goal still reachable? |
   | `src/ai/navigator.ts` `checkAlreadyVerified` | Does this claim mean the same as one already verified? |
   | `src/ai/navigator.ts` `verifyState`, inexpressible branch | Does the page satisfy this claim? |
   | agent-side experience renderer (`src/ai/task-agent.ts:82`, `src/ai/pilot.ts:714`) | Which structurally-matched block applies here? |

   Judge reaches the tool layer the way every other dependency does: as a member of `ToolDeps`/`AgentToolDeps` (`src/ai/tools.ts:34`, `:590`), alongside `navigator`, `researcher` and `supervisor`. The multi-element branch lives in `failedToolResult`, a module-level function with no deps of its own, so the tool bodies that call it pass judge in.

   The verdict site asks a question the code must phrase without knowing the scenario, and measurement 1 puts that generic form at 0.58 where the concrete form reached 0.88. It therefore stays in shadow longest, and Pilot's own verdict remains the decider; the tool is where that judgment gets asked well.

   The multi-element site answers inside the tool, so an ambiguity no longer costs a Tester round-trip. The dedup site answers before the prompt that carries full page HTML is built, and retires the `ALREADY_VERIFIED:` magic prefix. The experience site filters at the renderer, never inside `ExperienceTracker` — `getRelevantExperience` (`src/experience-tracker.ts:243`) stays structural, per the data-tier boundary in CLAUDE.md.

6. **Supervision: skip a scheduled review only on a confident "not needed".** Pilot's periodic review (`stepsToReview`, default 5, `src/ai/pilot.ts:63`) runs on the agentic model because it is expensive. Judge is cheap enough to ask at every scheduled review, so the review becomes conditional: `pilot_needed` and `progressing` are asked together, and the review is skipped only when the first is low *and* the second is high. Anything in between keeps the review.

   Measurement 5 is what makes this safe. `pilot_needed` reads 0.83 / 0.57 / 0.28 across a stalled run, a messy-but-progressing run, and a clean one; `progressing` reads 0.28 / 0.58 / 0.94. Only the clean run clears both bars. The messy run — four failed clicks, then two `visualClick`s that did move the switch — lands mid-range and keeps its review, which is where a run that cannot be read confidently belongs.

   The same asymmetry that ruled out the three-way Choice governs the gate: a wrong skip is invisible, because the run drifts unsupervised until the next scheduled review, while a wrong review costs one agentic call. So uncertainty resolves toward reviewing, never away from it.

   Three deterministic vetoes override the skip, each already computed and exact: StateManager reporting a dead loop, every tool execution in the window having failed, and an empty `ariaDiff` across the whole window. A floor caps the damage regardless — two scheduled reviews are never skipped in a row, so Pilot runs at least every `2 × stepsToReview` iterations.

   Judge may also pull a review **forward** between scheduled points, which is free at this price. The post-mortems argue for it: Pilot deciding late accounts for the 76-second stall, the Edit→Add→Select→Cancel loop repeated three times, and ten failed delete clicks before `interact()` solved it in one call.

7. **A judge answer never enters `verifications`.** `verifyState`'s `inexpressible` branch (`totalAttempted === 0`) records nothing today and tells the Tester the claim could not be turned into an assertion. Judge answers it instead, and the answer returns as tool output and into task notes, where Pilot reads it with its confidence. It does not call `addVerification`, because `getVerification` short-circuits later attempts with a cached result; writing an opinion there would cache over a future proof. The generated test is unaffected either way — that is fed by `assertionSteps`, which judge never produces.

8. **The majority vote stays deterministic.** `verified = successfulCodes.length >= majorityNeeded` is real assertions passing in a real browser, the one place in the system holding actual proof. No judge call goes in front of it.

9. **Acting and observing are decided per site, by what bounds a wrong answer.** A site acts on a confident answer when its fall-back is exactly today's behaviour and a wrong answer is bounded: the element pick returns to the numbered list, the dedup returns to the full verification, the experience filter keeps the block, the supervision gate carries three vetoes and a floor, Prima's navigation returns to Navigator. Those sites act from the start.

   The verdict site only observes. Its question measured 0.58 in the generic phrasing code must use, and a wrong verdict has no downstream check — nothing acts on it afterwards to reveal the error. It is called, logged with its confidence, and Pilot decides exactly as today until traces say where the line goes.

   The tool is live everywhere it is registered, since there the model reads the confidence itself. During the observing phase the same question can be answered twice in one run — code logging what judge would have said, and the model asking it through the tool — and that pairing is the cheapest evidence that a site's question is worth gating on.

10. **Every judge call announces itself and is traced.** `setActivity('⚖️ Asking judge...', 'ai')` (`src/activity.ts`) runs for the duration of the call, so the TUI shows a decision being made rather than an unexplained pause — the same treatment Researcher and Driller already give their own work. Every call also gets an `Observability.run` span, so answers are replayable from Langfuse and thresholds are read off real traces rather than invented. The span records a `null` result and its error class too — a dead endpoint changes no behaviour, but it must be visible in a trace, or shadow mode cannot be told apart from a site that was never reached.

## Prima

Prima (`boat/prima/`) runs its own loop, and it already implements the part of the jev-ultrafast design that Explorbot core does not: **the model never authors a selector.** `ariaRefSnapshot` gives every control a ref, `clickRef` (`src/ai/tools.ts:476`) executes `page.locator(ariaRefSelector(ref)).click()`, and `refIsGone` rechecks the ref before acting. Its own description states the property — *"a ref names one exact element, so it cannot match several by mistake and never needs disambiguating."* That is browser-use's "every executed target is resolved from an observed node", already shipped. What Prima lacks is the typed decision over that table: today a base model reads the ref snapshot inside a tool-calling loop and picks.

One constraint binds every ref-based question. Playwright's aria-ref index is per-document, and any plain `ariaSnapshot()` call wipes it — refs then time out rather than error, and the main frame gains an `f<N>` prefix after each navigation. The table must come from `ariaRefSnapshot` (`boat/prima/src/prima.ts:923`) and be re-captured after every navigation.

### P1. `go(target)` for a semantic target — `boat/prima/src/prima.ts:438`

A non-URL target runs `agentNavigator().visit(target)`, the full AI navigation loop. Two questions answer it first against the ref table: a Noul — the page already shows the target — and a Choice over the refs for which control leads there, with *none of these* as an option. A confident pick becomes one `clickRef`; a flat distribution or a `null` falls through to Navigator unchanged. This is the closest thing in the codebase to jev-ultrafast's own loop, and the closest to a like-for-like port: a base-model navigation loop replaced by one ~550-token call, with the same executor and the same freshness guard underneath.

Low confidence gets a third branch rather than an escalation, following the pattern the demo shows: refresh the observation. Prima's `contextTool` already does exactly that, so an unreadable page re-observes once before falling through.

### P2. `check()`'s expectation settling — `boat/prima/src/prima.ts:371`

`settleExpectations` fills `envelope.expectations`, and `envelope.ok` is derived from the statuses in code (`:377-382`). That division is already right — judgment supplies statuses, code decides the outcome — so judge changes only how the statuses are produced: one Choice per expectation, fanned out and evaluated in isolation, instead of one `generateObject` over an array schema where a wobbly expectation can drag its neighbours. The vision path is untouched, since Jev is text-only and `contradiction` only exists when a screenshot backs it.

The envelope gains `confidence?: number` per expectation entry (`boat/prima/src/envelope.ts:32`) — optional, defaulted, written by one module, read deterministically, so it satisfies the envelope rules in CLAUDE.md. It replaces a proxy measurement: today `envelope.warning` fires when no screenshot was available, standing in for "weakly settled", while confidence measures that directly. A `passed` below threshold must not silently produce `ok: true`; it reads as `unverified`, which already exists as a status and already keeps out of the `ok` calculation.

### P3. `do()`'s action selection — `boat/prima/src/prima.ts:147`, named but not scoped here

The full jev-ultrafast shape is one request carrying an operation Choice plus speculative target heads, where only the head matching the chosen operation executes and a small generative model writes text solely for the typing case. Prima has every piece — the ref table, the ref executor, a ledger of instructions, `completed()`/`blocked()` tools. Porting it would replace the tool-calling loop itself rather than gate a decision inside it, which is a different and larger change. It deserves its own design once P1 and P2 have run against real traces.

## Out of scope

- The researcher's pagination claim. Its primary fix is ordering.
- Anything generative: research summaries, plans, CodeceptJS, reports, and the prose fields of Pilot's verdict.
- Anything carrying a screenshot.
- Migrating the Tester's 45 decision bullets or Pilot's 50. They stay as written; the tool's description encourages asking rather than deciding alone, and nothing is deleted.
- New agents or new CLI flags. One envelope key is added — `confidence` on Prima's expectation entries — and it meets the four-point checklist.
- Porting the jev-ultrafast operation/target loop into Prima's `do()` (P3 above).

## Acceptance criteria

1. **Unconfigured runs are unchanged.** With no `ai.decisionModel`, `judge` does not appear in any tool list and no direct site calls out. A unit test asserts the tool registry and each site's fall-through.
2. **Each toggle works alone.** `tool: false` leaves the direct sites live and the tool absent; `direct: false` the reverse.
3. **Every answer carries a confidence**, including yes/no.
4. **Failure is invisible.** With `decisionModel` set and the endpoint refusing — wrong key, 429, or a withdrawn model — every site behaves as if unconfigured and the run completes. Tested by pointing `decisionModel` at an unreachable base URL.
5. **Shadow traces exist.** A configured run emits a judge span at each direct site it passes through — carrying an answer and confidence when the call succeeded, and a `null` with its error class when it did not. A run against an unreachable endpoint emits the spans and the recorded failures, not silence.
6. **Prima's envelope is unchanged when unconfigured.** With no `ai.decisionModel`, expectation entries carry no `confidence` key and `prima check` produces byte-identical output. With it set, `envelope.ok` is still derived only from the statuses — a confidence value never enters that calculation directly, it only moves a weakly-settled `passed` to `unverified` first.
7. **A skipped review is auditable.** Whenever a scheduled Pilot review is omitted, the trace records both values that authorised it and the veto checks that passed, so a run that drifted can be read back to the round where supervision was skipped. Two consecutive scheduled reviews are never both skipped.

## Testing

`@copilotkit/aimock` does not cover this; it mocks a chat protocol and System One is not one. Tests use a stub judge returning fixed confidences, per site, asserting both the gated and the fall-through branch.

The replay corpus already exists in `output/plans/`, each entry with a known-wrong outcome: the `c1406df8` verdict input (expected `skipped`, produced `fail`), the `a51c50de` state block (the constraint the page names versus the field the scenario assumed), and the picker `ariaDiff` from `8eb030b1` (rows 2–4 versus row 1).

## Open questions

- **Noul versus a two-option Choice** for yes/no calibration. The endpoint serves now, so this is a measurement over the `output/plans/` corpus, not an open design question.
- **Thresholds per site.** Set from shadow traces, not chosen in advance.
- **Key resolution.** Inferring the credential from the base URL is compact but implicit; an explicit `apiKey` field is plainer. Deferred to the implementation plan.

## Implementation

`docs/superpowers/plans/2026-09-18-judge-decision-model.md` — not yet written.
