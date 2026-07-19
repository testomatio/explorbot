# Agentic Usage

Explorbot is a terminal command, so a coding agent — Claude Code, Cursor, Codex, or your own script — can drive it the same way it drives `git` or `npm`. This page covers the two things an agent needs: starting a run without a config file, and handing Explorbot a test plan it wrote itself.

The division of labour that works best: the agent decides *what* to test and writes it down as a plan; Explorbot figures out *how* to click through the app and reports what actually happened.

## One-liner API

Explorbot normally reads `explorbot.config.js`. When that file is absent and `EXPLORBOT_AI_PROVIDER` is set, Explorbot builds a config from `EXPLORBOT_*` environment variables instead. Name a provider and you get its recommended models:

```bash
EXPLORBOT_URL=https://app.example.com \
EXPLORBOT_AI_PROVIDER=openrouter \
  npx explorbot explore /login --max-tests 3
```

No `init`, no config file, no project directory, no model IDs to look up. A config file always wins when present, so adding these variables never changes the behavior of an existing project.

### Variables

| Variable | Required | Meaning |
|---|---|---|
| `EXPLORBOT_AI_PROVIDER` | yes | A provider name; fills every role from its recommended models. Setting it turns on this mode |
| `EXPLORBOT_AI_MODEL` | no | Pins the main `model` — a model id for the provider, or a standalone `provider/model-id` that turns on this mode by itself |
| `EXPLORBOT_URL` | yes | Base URL to test. The [API boat](../api-testing/basics.md) reads it as the base endpoint |
| `EXPLORBOT_VISION_MODEL` | no | Screenshot analysis. A provider name or `provider/model-id`; overrides the provider recommendation |
| `EXPLORBOT_AGENTIC_MODEL` | no | Captain and Pilot decisions. A provider name or `provider/model-id`; overrides the provider recommendation |
| `EXPLORBOT_OUTPUT` | no | Output root. Defaults to a fresh temp directory |
| `EXPLORBOT_KNOWLEDGE` | no | Inline knowledge text, applied to every page |
| `EXPLORBOT_KNOWLEDGE_FILE` | no | Path to a knowledge markdown file |
| `EXPLORBOT_API_SPEC` | no | OpenAPI spec path for the API boat |

`EXPLORBOT_URL` is optional when the command itself carries an absolute URL, as `docs collect https://…` does.

### Naming models

Set `EXPLORBOT_AI_PROVIDER` to a provider name and Explorbot uses that provider's recommended model for every role — the same IDs listed in [Providers](../basics/providers.md), maintained in [`models.json`](../../models.json):

```bash
EXPLORBOT_AI_PROVIDER=openrouter   # model, visionModel, and agenticModel all filled in
```

This is the form to reach for when you do not care which model runs, only that the run works. Recommendations change as models are released, so a provider name keeps up while a pinned ID does not.

To pin the main model, add `EXPLORBOT_AI_MODEL`. With a provider set, it is the model id for that provider, used verbatim — slashes and all:

```bash
EXPLORBOT_AI_PROVIDER=openrouter \
EXPLORBOT_AI_MODEL=openai/gpt-oss-120b:nitro \
  npx explorbot explore /checkout
```

On its own, without a provider, `EXPLORBOT_AI_MODEL` must carry the provider as `provider/model-id`, and it sets only the main `model` — `visionModel` and `agenticModel` stay unset unless you add `EXPLORBOT_AI_PROVIDER` or set them explicitly. It splits on the **first** slash, so provider-qualified IDs survive intact:

```
openrouter/openai/gpt-oss-120b:nitro   → openrouter, model "openai/gpt-oss-120b:nitro"
groq/openai/gpt-oss-20b                → groq, model "openai/gpt-oss-20b"
anthropic/claude-haiku-4-5-20251001    → anthropic, model "claude-haiku-4-5-20251001"
```

`EXPLORBOT_VISION_MODEL` and `EXPLORBOT_AGENTIC_MODEL` override those roles the same way — a provider name for its recommendation, or `provider/model-id` to pin one. Mix the forms to take a provider's recommendations and override one role:

```bash
EXPLORBOT_AI_PROVIDER=groq \
EXPLORBOT_AGENTIC_MODEL=anthropic \
  npx explorbot explore /checkout
```

Supported providers: `openai`, `anthropic`, `google`, `groq`, `mistral`, `openrouter`, `sambanova`. Each is created with its conventional API-key variable — `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, and so on.

Not every provider has a recommendation for every role — Anthropic is recommended only for `agenticModel`, since Claude models are accurate but costly for token-heavy page reading. Naming a provider that has no recommendation for a role you asked for is an error that names the role, so combine providers as in the example above.

A `.env` file in the working directory is loaded before the config lookup, so `EXPLORBOT_*` variables and API keys can live there instead of on the command line.

### Knowledge without a project

Both knowledge variables write into the run's knowledge directory, and both can be set at once.

`EXPLORBOT_KNOWLEDGE` is the fast path for credentials — it applies to every page:

```bash
EXPLORBOT_KNOWLEDGE="Log in as admin@example.com / secret123. Dismiss the cookie banner first." \
EXPLORBOT_URL=https://app.example.com \
EXPLORBOT_AI_PROVIDER=openrouter \
  npx explorbot explore /admin/users
```

`EXPLORBOT_KNOWLEDGE_FILE` points at a markdown file the agent wrote. Its frontmatter is preserved, so it can target specific URLs — see [Knowledge](./knowledge.md) for the format:

```bash
EXPLORBOT_KNOWLEDGE_FILE=./checkout-knowledge.md npx explorbot explore /checkout
```

### What this mode changes

Config-free runs are built to leave no trace in the working directory:

- **Output goes to a temp directory** unless `EXPLORBOT_OUTPUT` is set. Read the path from the `Configuration built from EXPLORBOT_* environment variables. Output: …` line.
- **Experience is not written.** Nothing accumulates between runs, so a run is reproducible. Reading existing experience still works if the directory has any.
- **The Historian is off.** No generated CodeceptJS or Playwright test files. Plans and reports are still written.

For a long-lived agent that should learn across runs, point `EXPLORBOT_OUTPUT` at a stable directory or switch to a real config file.

### Reading results

Everything lands under the output root:

| Path | Contents |
|---|---|
| `reports/<mode>-<session>.md` | Session report: coverage, defects, execution issues |
| `plans/<page>.md` | The plan that was generated or executed |
| `states/` | Per-state HTML, ARIA snapshots, and screenshots |
| `research/` | UI maps produced by the Researcher |

The report is the artifact to parse. It clusters findings by root cause and is written for a reader, not a machine.

`explore` and `test` exit `0` whenever the session completes, and non-zero only when the run itself fails to start — a failing scenario is a result, not a crash. Do not read pass/fail from their exit code; read the report. `navigate` is the exception and exits `1` when a URL is unreachable, which makes it a useful pre-flight check.

## Running agent-prepared plans

A [test plan](./test-plans.md) is plain markdown. An agent that has read the codebase usually knows what a feature is supposed to do better than an agent looking at rendered HTML, so writing the plan and executing it are worth separating.

Write the plan:

```markdown
<!-- suite -->
# Checkout

### Prerequisite

* URL: /cart

<!-- test
priority: critical
-->
# Customer completes checkout with a saved card

## Requirements
/cart

## Steps
* Proceed to checkout from the cart
* Pick the saved card as the payment method
* Confirm the order

## Expected
* The order confirmation page shows an order number
* The cart is empty afterwards
```

Then hand it to Explorbot:

```bash
EXPLORBOT_URL=https://app.example.com \
EXPLORBOT_AI_PROVIDER=openrouter \
  npx explorbot test checkout-plan.md '*'
```

The index argument selects tests: `1`, `1,3`, `1-5`, or `*` for all. The plan file is input only — Explorbot never rewrites it, so plans stay in version control next to the code they cover.

Steps are guidance, not a script. The Tester adapts them to what the page actually shows, which is why steps should describe intent rather than selectors. Expected outcomes are the strict part: a test passes only when every one of them is verified. See the [Planner's outcome guidance](../web-testing/planner.md#built-in-styles) for what makes an outcome verifiable.

To have Explorbot invent the scenarios instead, run `explorbot plan <path>` and read the generated file from `plans/`.

## Inspecting a page without spending tokens

Two commands help an agent orient itself before committing to a run:

```bash
npx explorbot context /login        # URL, headings, knowledge, interactive elements
npx explorbot shell /login 'I.click("Sign in")'   # run one CodeceptJS command
```

`context` makes no AI calls. Use it to check that a page loads, that login knowledge applies, and that the elements a plan assumes are actually there.

## The other boats

The same variables drive API testing and doc collection.

```bash
EXPLORBOT_URL=https://api.example.com \
EXPLORBOT_API_SPEC=./openapi.yaml \
EXPLORBOT_AI_PROVIDER=openrouter \
  npx explorbot api explore
```

```bash
EXPLORBOT_AI_PROVIDER=openrouter \
  npx explorbot docs collect https://app.example.com/dashboard --max-pages 20
```

`docs collect` takes its base URL from the absolute path argument, so `EXPLORBOT_URL` is optional there.

Knowledge written by `EXPLORBOT_KNOWLEDGE` carries `endpoint: '*'` frontmatter alongside `url: '*'`, matching the convention `api init` and `api know` use. The API boat does not read knowledge at runtime yet; the frontmatter is there for when it does, and the web side ignores it.

## See Also

- [Test Plans](./test-plans.md) — the plan format in full
- [Knowledge](./knowledge.md) — teaching Explorbot about your app
- [Commands](../reference/commands.md) — every CLI command
- [Continuous integration](./ci.md) — scheduled runs with cached experience
- [Scripting](../reference/scripting.md) — the programmatic API when a CLI call is not enough
