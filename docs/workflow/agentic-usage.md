# Agentic Usage

Explorbot is a terminal command, so a coding agent — Claude Code, Cursor, Codex, or your own script — can drive it the same way it drives `git` or `npm`. This page covers the two things an agent needs: getting Explorbot configured once, and handing it a test plan it wrote itself.

The division of labour that works best: the agent decides *what* to test and writes it down as a plan; Explorbot figures out *how* to click through the app and reports what actually happened.

## Start here: the global installation

Configure models and keys once for the machine, and every later command works in any directory with no environment variables to remember:

```bash
npx explorbot init --global --provider openrouter --api-key sk-...
npx explorbot explore https://app.example.com/login --max-tests 3
```

`init --global` writes `~/.explorbot/config.js` with the recommended model ids of this Explorbot version and stores the key in `~/.explorbot/.env`. It needs no terminal — with `--provider` there is no wizard, so an agent can run it unattended.

The global config holds models and keys, never a site. Most commands carry the site themselves — `explore`, `plan`, `research`, `navigate`, `context`, `shell`, `freesail`, `docs collect`. The ones that take no URL argument — `test`, `learn`, `knows`, `experience`, `compact` — read it from `EXPLORBOT_URL`, and stop with `No site to explore` when it is unset:

```bash
EXPLORBOT_URL=https://app.example.com npx explorbot learn "/login" 'Sign in as ${env.APP_USER}'
```

This is the form to prefer. Each site explored gets its own folder under `~/.explorbot/sites/<host>/` holding `knowledge/`, `experience/`, and `output/`, so what Explorbot learns about an app is still there on the next run — the agent that explored `/checkout` yesterday does not start from zero today. Later runs can name the site by host instead of repeating the URL:

```bash
npx explorbot explore app.example.com/dashboard
npx explorbot sites                                # what is registered, and when it last ran
```

The `EXPLORBOT_*` variables below still win over it: setting `EXPLORBOT_AI_PROVIDER` or `EXPLORBOT_AI_MODEL` builds the configuration from the environment and the global config is skipped. So an agent can install once and still override models or the URL per command.

## One-liner API

When nothing can be installed — a CI job, a container, someone else's machine — set `EXPLORBOT_AI_PROVIDER` and Explorbot builds a config from `EXPLORBOT_*` environment variables instead. Name a provider and you get its recommended models:

```bash
EXPLORBOT_URL=https://app.example.com \
EXPLORBOT_AI_PROVIDER=openrouter \
  npx explorbot explore /login --max-tests 3
```

No `init`, no config file, no project directory, no model IDs to look up. These variables win over the global installation, so a run can always be pinned to its own models. A project `explorbot.config.js` still wins over them, so adding these variables never changes the behavior of an existing project.

### Variables

<!-- START env -->
| Variable | Required | Meaning |
|---|---|---|
| `EXPLORBOT_AI_PROVIDER` | yes | Provider name; fills every model role from its recommended models. Turns on config-free mode |
| `EXPLORBOT_AI_MODEL` | no | Pins the main model — a model id for the provider, or a standalone provider/model-id |
| `EXPLORBOT_URL` | yes | Base URL to test; the API boat reads it as the base endpoint |
| `EXPLORBOT_VISION_MODEL` | no | Screenshot analysis; overrides the provider recommendation |
| `EXPLORBOT_AGENTIC_MODEL` | no | Captain and Pilot decisions; overrides the provider recommendation |
| `EXPLORBOT_OUTPUT` | no | Output root for states, plans, research, and reports. Defaults to the site dir under ~/.explorbot/sites |
| `EXPLORBOT_EPHEMERAL` | no | Keep no state between runs — output goes to a fresh temp directory instead of the site dir |
| `EXPLORBOT_KNOWLEDGE` | no | Inline knowledge text, applied to every page |
| `EXPLORBOT_KNOWLEDGE_FILE` | no | Path to a knowledge markdown file |
| `EXPLORBOT_API_SPEC` | no | OpenAPI spec path for the API boat |
| `EXPLORBOT_NO_BANNER` | no | Suppress the startup banner, for machine-readable output |
| `EXPLORBOT_MAX_DURATION` | no | Wall-clock budget in minutes for an explore run; same as --max-duration |
<!-- END env -->

`EXPLORBOT_URL` is optional when the command itself carries an absolute URL, as `docs collect https://…` does. The [API boat](../api-testing/basics.md) reads it as the base endpoint.

This table is generated from the registry in `src/config.ts`, which also feeds `explorbot --help` — so `npx explorbot --help` lists the same variables on any command, and an agent can discover them without reading these docs.

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

Config-free runs leave no trace in the working directory:

- **Output goes to the site folder** — `~/.explorbot/sites/<host>/`, the same folder the global installation uses, so states, plans, research, and reports for one app collect in one place however the run was configured. `EXPLORBOT_OUTPUT` points them somewhere else. Read the path Explorbot resolved from the `Configuration built from EXPLORBOT_* environment variables. Output: …` line.
- **`EXPLORBOT_EPHEMERAL=1` keeps nothing between runs** — output goes to a fresh temp directory instead, for throwaway CI jobs and demos. The [prima boat](../reference/commands.md#prima-boat) exposes the same switch as `--ephemeral`.
- **Experience is written into the site folder.** What worked on a page is remembered and reused by later runs against the same host. `EXPLORBOT_EPHEMERAL=1` turns writing off, so an ephemeral run stays reproducible.
- **The Historian is off.** No generated CodeceptJS or Playwright test files — that is the one thing the global installation gives that this mode does not. Plans and reports are still written.

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
