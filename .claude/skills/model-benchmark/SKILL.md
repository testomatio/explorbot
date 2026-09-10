---
name: model-benchmark
description: Use when choosing, comparing, or validating an AI model for an Explorbot slot (base/reading, agentic/planning, vision) — evaluating a new model, checking whether a cheaper model holds up, or producing cost/latency/pass-rate numbers for a model comparison.
---

# Model Benchmark

Measures a model in one Explorbot slot against the Trackly regression scenario, recording pass rate, cost, tokens and latency per run.

**Core principle: swap exactly one slot, hold everything else fixed, and always run a same-day baseline.** A model's numbers mean nothing alone — they only mean something next to the model it would replace, measured on the same tree, the same day.

## The three slots

| Slot | Config key | Does | Carries |
|---|---|---|---|
| base / reading | `ai.model` | Researcher, Navigator, **Tester**, Driller — reads pages and executes steps | ~70% of calls, ~85% of input tokens |
| agentic / planning | `ai.agenticModel` | **Planner and Pilot only** — writes the test plan, supervises the run | Few calls, decides what gets tested |
| vision | `ai.visionModel` | Screenshot analysis | Rare |

Verify this map before attributing a result — it is not what the architecture diagram implies. An agent's slot is whichever of `getModelForAgent` (base) or `getAgenticModel` (agentic) builds its conversation; `startConversation(prompt, name)` resolves to the base slot. Attributing a planning failure to the base model, or a locator failure to the agentic one, inverts the conclusion.

Name the slot in every report. "Base model" and "planning model" are different experiments and their numbers are not comparable.

## Eligibility gate — before spending a run

A run costs ~5 minutes and real money. Check the model can do the job first:

```bash
curl -s https://openrouter.ai/api/v1/models | \
  python3 -c "import json,sys; [print(json.dumps(m,indent=1)) for m in json.load(sys.stdin)['data'] if m['id']=='<slug>']"
```

Require `tools` and `structured_outputs` in `supported_parameters`. Then send one real request with a `tools` array and a strict `json_schema`, plus `"usage":{"include":true}`, and confirm all three come back: a tool call, schema-valid JSON, and `usage.cost`. A model that fails any of these cannot be benchmarked — report that and stop.

Note `top_provider.max_completion_tokens`. If it is below the fixture's `maxOutputTokens` (8000), lower it or the run dies on truncation rather than on model quality.

## Running

```bash
bunosh bench:model inception/mercury-2.5 --runs=2                  # base slot (default)
bunosh bench:model inception/mercury-2.5 --slot=agentic --runs=2   # agentic slot
bunosh bench:model openai/gpt-oss-20b:nitro --runs=2               # baseline — never skip
bunosh bench:report
```

Roughly 5 min and $0.06 per run. `--slot` takes `base`, `agentic` or `vision` and sets `BENCH_MODEL`, `BENCH_AGENTIC_MODEL` or `BENCH_VISION_MODEL`; `USAGE_FILE` turns on per-request recording. All are read by `tests/regression/fixture/explorbot.config.js`, and when unset that config behaves exactly as CI expects — so the unswapped slots keep their defaults and form the control automatically.

Each run is archived to `tests/regression/.bench/<slug>-<slot>-<n>/` with `meta.json` (verdict, duration, slot, four gate details), `usage.jsonl` (per-call model, cost, tokens, reasoning, ms) and the full `run/` output tree. The archive key includes the slot, so the same model benchmarked in two slots does not overwrite itself — but re-running the *same* model and slot does `rmSync` the previous archive. Copy it first if you want to keep it.

## Rules that change the answer

**Never use retries.** `bench:model` runs `retries=0` deliberately. `regression:basic` defaults to 2 retries and stops at the first pass, which scores whichever model got lucky rather than the model.

**Runs are sequential.** Every run reuses and `rmSync`s `tests/regression/.runs/basic-native-a1`. Two benchmarks in parallel destroy each other's artifacts. Wait for one to finish.

**Freeze `src/` across every arm.** Agent or prompt changes between arms void the comparison — `planner.ts`, `pilot.ts`, `rules.ts` and `tools.ts` change agent behavior directly. Each run records a `tree` fingerprint in `meta.json` and sets `treeStable: false` if `src/` moved mid-run; **check that every arm shares one `tree` value before comparing anything.** A benchmark takes tens of minutes, so on a repo with other sessions or agents active, confirm nobody else is editing before starting.

**The gate is zero-tolerance.** A run passes only when `failed === 0`, so a single flaky test flips a whole run red. Report the tests-passed ratio (9/10) as the primary number and the gate rate (1/2) second, with that rule stated — otherwise 1/2 reads as a 50% failure rate.

**n=2 cannot measure a pass rate.** It settles cost, latency, token shape and the research/planning gates, which are stable. It cannot distinguish 50% from 90%. Say so, or run more.

## Reading the results

Attribute each call by `model` in `usage.jsonl` — the slot under test is whichever id matches, and everything else is the fixed slots. OpenRouter returns the canonical id, so `openai/gpt-oss-20b:nitro` comes back as `openai/gpt-oss-20b`; match on the id with the `:variant` suffix stripped or slot cost silently reads zero.

**When two slots hold the same model, their traffic is indistinguishable by id.** Benchmarking a model against a control that also serves vision (the default Luna in both slots) puts vision calls in the control's slot bucket and inflates it. Split them with the `image` flag in `usage.jsonl`, or subtract the vision traffic measured in the other arm — the agentic slot makes the same number of calls whichever model fills it, so matching call counts confirm the split.

**Never quote observed cost without checking `provider` and `cost` in `usage.jsonl`.** A routing variant such as `:nitro` can land on a provider that bills nothing, and the table then reports `$0.0000` for an arm that is not actually free. Whenever an arm's observed cost is zero or the two arms landed on different providers, recompute both from list price (`pricing.prompt`, `pricing.completion`, `pricing.input_cache_read` in `/api/v1/models`) over fresh, cached and output tokens, and say which figure you are quoting.

**Compare cost per test, not only per run.** A model that plans fewer tests looks cheaper and faster per run while doing less work. Read `Tests run` first: if the arms differ, `$/run` and duration are confounded and `$/test` is the honest comparison.

**Speed has three separate numbers and they disagree.** `Mean call` is per-request latency, `Out tok/s` is generation throughput over the slot's own request time, and `Duration` is wall clock for the whole run. A model can win on throughput and still lose on wall clock by making more calls, or by spending its output budget on reasoning tokens nobody reads. Quote all three, and check the reasoning share before crediting a model for speed.

Separate the failure kinds, because they point at different slots:

- **Planning failures** — the plan asserts something the app never promised. Look for an invented requirement that becomes a reported defect: verify the claim against the fixture source before repeating it, since the analyst escalates a failed test into a `[High]` defect without rechecking the premise.
- **Execution failures** — the plan is right and the interaction misses (wrong option chosen, malformed locator, retries exhausted). These implicate the agentic slot as much as the base one.

The per-test outcomes are in `run/output/reports/session-*-tests.md`; the clustered narrative is in `run/output/reports/explore-*.md`. Counting the analyst's "Execution Issues" lines across runs is a fast quality signal that the pass/fail gate misses entirely.

## Reporting

Lead with the verdict and the slot, then `bench:report`'s table, then failure analysis by kind, then an adopt / don't / needs-more-data call. Quote cost per run, not per token — token pricing hides how many calls a slot makes, and cache-hit rates move real cost more than the headline rate does.

`.bench/` is gitignored, so paste `report.md` into the PR or issue rather than linking it.

## Never

Do not start the `regression` GitHub workflow, add its label, or approve its environment gate to get benchmark numbers. It costs up to 150 minutes of runner time and only the user decides when it runs. Local `bunosh` runs are the benchmark path.
