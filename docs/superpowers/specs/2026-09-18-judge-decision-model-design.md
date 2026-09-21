# Judge — a decision model tier — Design

An optional *decision model* answers one narrow question with a probability over the answers offered. Explorbot uses it where it would otherwise guess: a code call site asks, and a confident answer lets the site skip its own, more expensive decision. The model is TypeSafe's Jev (a "System One" model), reached through OpenRouter or TypeSafe's own API.

With `ai.decisionModel` unset, nothing registers and nothing calls out.

## The interface

```ts
judge.decide(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision>

class Decision {
  readonly value: string | null;   // the winning option; 'yes' for an approved yes/no
  readonly confidence: number;     // P(yes) for a yes/no, the chosen option's probability for a list
  get approved(): boolean;         // value !== null
  get rejected(): boolean;         // value === null
}
```

- **An array is a categorization**, sent as a Choice. `value` is the chosen option. Including `UNDECIDED` lets the model say none fits.
- **A boolean or `null` is a yes/no**, sent as a Noul, whose single number is P(yes). Only a confident yes approves.
- **Approved means the answer's probability is above 70%** and it isn't `UNDECIDED`.
- **Everything else is rejected**: a confident no, a low probability, `UNDECIDED`, a timeout, a failed request, a list with fewer than two options, or the direct path being disabled. `decide` never throws and never returns `null`.

The threshold and every failure mode live in one place. A call site only ever sees a confident decision or a rejection, so it cannot misread uncertainty.

### The one rule for call sites

**`rejected` means "not approved", never "confidently no".** It absorbs uncertainty, so a question must be phrased so that `approved` is the action the site would take, and `rejected` falls through to today's behaviour. Then `if (decision?.approved)` is correct by construction.

`consult(...)` is the same call without the direct-path gate, used by the tool.

## Configuration

```js
ai: { decisionModel: { provider: 'openrouter', model: 'typesafe/jev-1.13' } }             // via OpenRouter
ai: { decisionModel: { provider: 'typesafe', model: 'jev-latest' } }                       // TypeSafe API directly
ai: { decisionModel: { provider: 'openrouter', model: 'typesafe/jev-1.13', tool: false } } // direct sites only
```

`config.ts` holds only the field type. An unknown provider or a missing API key throws at startup, naming what to fix.

Everything transport-specific lives in `src/ai/judge-provider.ts`: `endpointFor()` (a `switch` over `openrouter` and `typesafe`, each with its endpoint and API-key variable), the HTTP call, timeout, and the Noul/Choice wire format. That file is temporary: when the Vercel AI SDK supports decision models it is deleted and `decisionModel` becomes a regular provider-built model.

`Judge.fromConfig()` builds the judge; it reaches agents through `AgentDeps` and tools through `ToolDeps`.

## Where it is used

| Site | Question | Approved means |
|---|---|---|
| `failedToolResult`, multi-element branch | Which listed element does the intent name? | suggest that element by `elementIndex` |
| `Pilot.analyzeProgress`, scheduled trigger only | The run is moving toward the goal and can continue without a supervisor now. | skip the review |
| `Pilot.settleExpectations`, text-only path | What did this run establish about the expected outcome? | settle it; the rest go to the agentic model |
| `Navigator.verifyState`, before the prompt | Which already verified claim means the same as this one? | treat it as verified, skip the HTML-bearing prompt |
| `Navigator.verifyState`, inexpressible branch | The page shows that this claim is true. | report it as a judgement, not an assertion |
| Prima `go()`, semantic target | Which listed control leads to the target? / The page now shows the target. | click the ref, confirm arrival, skip the navigator |
| `judge` tool (Tester and Pilot) | whatever the model asks | the answer; otherwise "not confirmed" |

Invariants the sites keep:

- **Reactive reviews are never gated.** Pilot is summoned reactively on a region change, three consecutive failures or two empty results. Those always review. A skipped scheduled review does not reset the tester's counters, and two scheduled reviews are never skipped in a row.
- **A judge answer never enters `verifications`.** A dedup match skips the work but writes no cache entry for the new claim, because a cache entry stands in for a proof.
- **Prima confirms arrival** before returning a success envelope. `cli.ts` exits on `envelope.ok`.
- **The tool assembles its own state**: scenario, compact ARIA capped at `JUDGE_PAGE_CAP`, and recent steps. The model supplies only the question.

## Deliberately not used

- **Pilot's verdict.** A generic "the app never held the state the scenario assumes" would fire on boundary give-ups, like "previous page" on page 1 when `»` is listed, and turn an executable scenario into a clean-looking skip. That hides the execution gap. The fix for a boundary give-up belongs in planning, not the verdict.
- **Experience filtering.** It removes no model call, and one question per stored block on every prompt build costs more than it saves.
- **Generation, screenshots, tool-calling loops.** The model is text-only and does not generate.

## Measurements behind the threshold

On states reconstructed from recorded traces:

- A literal, concrete phrasing beat an abstract one on identical state: 0.88 versus 0.58. Questions should name what they expect to see.
- A composite "continue or call Pilot" Choice tied at confidence 0.08 on a run that was progressing. Under `rejected` semantics, a tie falls through to a review, which is the safe direction.
- The first live probe picked `copy` over `root` at 0.48 versus 0.41 on a dialog whose Copy button was disabled. A 70% bar rejects that, correctly.

Threshold and phrasing should be tuned from traces: every call records `question`, `value` and `confidence` on its `judge.decide` span, and failures record their reason.
