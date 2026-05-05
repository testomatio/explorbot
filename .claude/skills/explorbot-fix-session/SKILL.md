---
name: explorbot-fix-session
description: Diagnose a failed Explorbot session via /explorbot-debug, then propose ONE minimal fix to pilot/tester. Strongly biased toward prompt-only changes; rejects over-engineering.
---

# Explorbot Fix Session

Take a Langfuse trace ID or session name, identify the single root cause in pilot/tester, and propose **one minimal change**.

The bar is low on purpose: most session pathologies in pilot/tester come from one prompt phrase, one missing guardrail, or one auto-flip that should not exist. Your job is to find that one thing — not to redesign the agent.

## Step 1: Diagnose

Invoke `/explorbot-debug <trace-id-or-session-name>` and read its output. That skill already knows how to fetch the Langfuse JSON and correlate it with `output/explorbot.log`.

Once the data is on disk, do your own pass. Use `jq` to find the dominant pattern:

```bash
# Which observations ran most often? Madness shows up here.
jq '[.[0].observations[] | .name] | group_by(.) | map({name: .[0], count: length}) | sort_by(.count) | reverse | .[:15]' output/langfuse-export-*.json

# Walk a specific tool chronologically (replace "finish" / "verify" / "see" etc)
jq '[.[0].observations[] | select(.name == "TOOL_NAME") | {time: .startTime, input, output: (.output | tostring | .[0:300])}] | sort_by(.time) | .[]' output/langfuse-export-*.json
```

Look for **same-shape repetition**: same tool with same input across many minutes. That's the loop.

## Step 2: Find the ONE root cause

Trace the loop back to a single decision site in `src/ai/pilot.ts` or `src/ai/tester.ts` (or rarely `src/ai/navigator.ts`). Symptoms cascade — you want the upstream cause, not the downstream noise.

Diagnostic questions to ask, in order:

1. **Is there an auto-flip / auto-retry that overrides an AI verdict on a tooling failure?** (e.g. `pass → continue` flips, `success → retry` overrides, gating an AI decision behind a flaky deterministic check.) These are the #1 source of session madness — the AI is right, the gate is wrong.
2. **Is the AI proposing the same broken thing repeatedly because the prompt doesn't tell it what NOT to do for this class of UI?** (iframes, canvas, custom widgets, dynamic IDs.)
3. **Are two tools / agents disagreeing because their descriptions overlap or both fit?** Read their `description` strings side by side. If you can't tell which one to call from the description alone, the model can't either.
4. **Is one tool description so generic it gets called for everything?** (e.g. a tool that fits "click anything" wins over a more specific tool.)

Stop at the first question that answers yes. That is your single root cause. Do not collect three causes — pick the one that, if removed, eliminates the loop.

## Step 3: Pick the SINGLE minimal fix

Strict ladder — apply the **first** option that works. Do not combine.

| Rank | Fix shape | When |
|------|-----------|------|
| 1 | **Edit a system prompt** — add/remove one paragraph in pilot's `buildVerdictSystemPrompt`, navigator's system prompt, tester's prompt, or a tool's `description`. | The AI keeps making the same wrong choice and the prompt doesn't disambiguate. |
| 2 | **Sharpen a tool/agent description** for disambiguation. | Two similar tools/agents are getting confused. |
| 3 | **Delete a small block of logic** that shouldn't exist. | An over-eager guardrail (auto-flip, auto-retry, programmatic veto on AI verdict) is fighting the AI. Removing it solves it. |
| 4 | **Add a few lines of logic** — a counter, a guard, a state pass-through. | Genuinely needed plumbing. Last resort. |

### Forbidden in the fix

- ❌ New methods (especially on classes outside the one you're touching)
- ❌ New tools
- ❌ New regexes or hardcoded keyword lists
- ❌ Hardcoded examples taken from this debug session (see CLAUDE.md — prompts must be GENERAL)
- ❌ More than one fix point — if you find yourself proposing changes in 3 files, you're addressing symptoms, not the cause
- ❌ "Plus also" additions — every "and we should also…" is a sign you're scope-creeping

### Bias toward deletion

If a few lines of code can be **deleted** to solve it, that beats adding code. The auto-flip case is the canonical example: removing 6 lines fixed a 6-minute loop.

### Disambiguation pass (mandatory)

Before finalizing, read the prompts and tool descriptions in the affected area. Look for:

- Two tools whose descriptions don't make the boundary obvious. Sharpen the one closer to the failure.
- Prompt instructions that conflict (e.g. "always do X" vs "prefer Y"). Pick one.
- Tool descriptions that enumerate examples from past bugs (anti-pattern per CLAUDE.md). Replace with general principle.

Do this even if the disambiguation isn't your fix — note it in the plan as an observation. But if disambiguation IS the fix, that's allowed and counts as the single fix point.

## Step 4: Write the plan

Use this exact shape — short, no headers beyond what's listed:

```markdown
# <one-line title naming the fix>

## Context
<1 paragraph: trace ID, scenario, the loop pattern (counts of repeated calls, duration), the one mechanism in code that drives it. Cite file:line.>

## Root cause
<1-2 sentences. Name the single decision site.>

## Fix
<1 code change, with file:line. Show before/after for prompt edits or the deleted block. Total line count budget: ~15 lines including prompt prose.>

## Why this is enough
<1-2 sentences explaining why the cascading symptoms (the 30+ retries, the 80+ see calls, etc.) all collapse when this one thing changes.>

## Trade-off
<1 sentence on what's now weaker. If you can't name a trade-off, the fix probably isn't real.>

## Verification
- Replay the same scenario; expectation: <quantified — call count, duration>
- `bun test tests/integration/`
- `bun test tests/unit/`
- `bun run check:fix`
```

No "alternatives considered" section. No "future work". No table comparing approaches. The plan is the chosen fix.

## Anti-patterns from past sessions

These were tried in earlier iterations of this skill's reference fix and rejected by the user:

- **Adding a new method to Researcher for a structured visual check.** Solving the symptom by introducing a parallel pipeline. Rejected as scope creep — pilot already has `visualAnalysis` baked into its decision context, the extra method was redundant.
- **Tracking `finishAttempts` + `rejectedVerifications` on the Test class with a 3-attempt cap.** Plumbing across `test-plan.ts`, `tester.ts`, and `pilot.ts` to bound a loop that shouldn't exist in the first place. Rejected — fix the loop, don't bound it.
- **Three-step verification ladder (DOM → visual → restricted re-decision).** A new control-flow structure with a new `downgradeVerdict` private method. Rejected — too clever, too many moving parts, replaces one decision site with three.

The accepted fix in that session was **6 lines deleted + 1 line + 1 prompt paragraph**, all in pilot.ts. That is the standard.

If your draft plan looks larger than that, ask yourself: "Am I solving the cause, or am I papering over its symptoms?"
