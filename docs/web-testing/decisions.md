# Decisions

A decision model answers one closed question about the current state: a yes/no statement, or a pick from a list of options. It returns the answer together with its probability. Explorbot uses it to settle narrow choices quickly and cheaply that would otherwise need a call to a larger model or a guess.

The decision model is optional. Without it Explorbot behaves exactly as described elsewhere in these docs. Setup is covered in [AI providers](../basics/providers.md#decision-model).

## Decision rules

Every question has one of two shapes:

| Shape | Asked as | Answer |
|---|---|---|
| **Statement** | "The page shows that this claim is true." | Probability that the statement holds |
| **Choice** | "Which listed element does the intent name?" plus numbered options | The chosen option and its probability |

A choice always includes an extra *undecided* option, so the model can say that none of the options fits. The question tells the model to choose it when it is not sure.

Explorbot acts on an answer only when it is **approved**:

- a statement's probability is above the threshold, or
- a choice picked a real option, not *undecided*, with a probability above the threshold.

The threshold is **70%** unless `decisionModel.threshold` sets another value.

Anything else counts as **rejected**, including:

- a confident "no", or any probability at or below the threshold
- *undecided*
- a choice offered with fewer than two options
- a request timeout (15 seconds) or a failed request
- `direct: false` in the config, for built-in decision points

A rejected answer never means "confidently no". It means Explorbot has no usable answer, so it takes its usual path. Every question is worded so that approving it lets Explorbot take a shortcut and rejecting it keeps the usual path. A wrong or unsure answer can therefore cost a shortcut, but never a check.

## Built-in decision points

These are fixed places in the code where Explorbot asks the decision model before doing the usual, more expensive work. Setting `direct: false` turns them off.

### Tester: locator matches several elements

When a click or fill fails because the locator matched more than one element, Explorbot lists the matches and asks which one the step meant.

- **Approved:** a click is repeated right away on the chosen element with `elementIndex`, before the Tester's remaining fallback locators. For other actions, the Tester is told which element to use.
- **Identical options:** when two matches look the same, the question is not asked. The Tester is told to click by appearance with `visualClick()`.
- **Fallback:** the Tester receives the numbered list of matches and picks one itself, narrows the locator, or uses a visual click.

### Pilot: progress review

Every few steps, Pilot reviews the Tester's recent actions with the `agenticModel`. On a routine review it first asks whether the recent actions advance the scenario toward its remaining expected outcomes. The decision model sees the scenario, its planned steps, which expected outcomes are checked and which remain, the run log, the pages visited, the current page and the recent actions.

A review forced by a run of failed or empty steps skips the question and goes straight to Pilot.

- **Approved:** the review is skipped and the Tester continues. This saves one `agenticModel` call.
- **Fallback:** Pilot runs its full review as usual.

### Navigator: claim already verified

Before Navigator writes assertions for a claim, it asks whether a claim it has already verified on this page means the same thing, even if it is worded differently.

- **Approved:** the claim counts as verified and no assertions are generated or run.
- **Fallback:** Navigator verifies the claim with assertions as usual.

The new claim is not added to the page's verified claims. Only a claim backed by assertions that actually ran is recorded as verified.

### Navigator: claim no assertion can express

Some claims cannot be turned into an assertion. When that happens, Navigator asks whether the page shows the claim is true.

- **Approved:** `verify` reports that the page appears to confirm the claim. The result is marked as a judgement, kept apart from assertions that ran, and the Tester is asked to restate the claim so it can be asserted.
- **Fallback:** `verify` reports that no assertion could express the claim, and suggests restating it or checking it with `see`.

In both cases `verify` returns a failure, because nothing ran in the browser.

### Prima: `go` to a described page

When `prima go` gets a description of a page instead of a URL, it asks which control on the current page leads there.

- **Approved:** Prima clicks that control. It then asks a second question: whether the new page shows the target. Only when that is approved too does Prima report success.
- **Fallback:** if the choice is rejected, or the click fails, or the page doesn't change, or arrival is not confirmed, Prima hands off to the Navigator as usual.

### Prima: `check` expected outcomes

When `prima check` settles the expected outcomes of a finished run without a screenshot, it asks what the run established about each outcome: that it happened, or that it did not.

- **Approved:** that outcome is settled as passed or failed without calling the `agenticModel`.
- **Fallback:** the remaining outcomes are settled by the `agenticModel` as usual. When a screenshot is available, all outcomes go to the vision model and the decision model is not asked.

## The `judge` tool

With `tool: true`, Tester and Pilot get a `judge` tool. They use it when a step depends on reading the page rather than running a command. The tool takes:

| Argument | Description |
|---|---|
| `question` | A statement to confirm, or the question a list of options answers |
| `options` | Possible answers. Leave it out to confirm a statement |
| `context` | Anything the page itself doesn't show |

The model supplies only the question. The tool gathers the rest of the state itself: the current scenario, the compact ARIA snapshot of the page (up to 12,000 characters), and the last eight test steps.

- **Approved:** the tool returns the answer and its confidence.
- **Rejected:** the tool returns "Not confirmed" and tells the agent to gather more context or try another route. "Not confirmed" means the page doesn't settle the question. It does not mean the statement is false.

`tool` and `direct` are independent. For example, `tool: false` keeps the built-in decision points but stops the agents from asking questions of their own.

## Where it is not used

- **Pilot's verdict on a test.** Whether a scenario passed, failed or was impossible is always decided by the `agenticModel`.
- **Filtering experience.** One question per stored experience block, on every prompt, would cost more than it saves.
- **Generation, screenshots and tool calling.** The decision model reads text and answers questions. It does not write, look at images or act on the page.

## Tracing

Each question is recorded as a `judge.decide` span:

- **Input:** the exact request body sent to the provider: model, state and question. Post it again to the endpoint to replay the decision.
- **Output:** the raw answer and its probability, before the threshold is applied.
- **Metadata:** `judgeQuestion` for filtering by question, `judgeDecision` with the approved value, confidence, threshold and model, and `judgeEndpoint`.

A failed request marks the span as an error and records the reason. The TUI shows `⚖️ Asking judge...` while a question is in flight. See [Observability](../contributing/observability.md) for setting up tracing.
