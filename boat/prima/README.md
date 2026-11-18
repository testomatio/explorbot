# prima-cli

Prima is a high-level AI browser driver. You describe the behaviour you want checked, and it works out how to reach it — instead of writing selectors and step-by-step click paths.

It drives a browser opened by [playwright-cli](https://www.npmjs.com/package/playwright-cli), or one of its own.

```bash
npx prima-cli check "a workflow can be created and appears in the list" --expected "the new workflow is listed"
```

## Install

```bash
npm install -g prima-cli      # install it
npx prima-cli --help          # or run without installing
```

Install it when an agent drives it: `npx` adds about 5 seconds to every call.

Prima also ships inside [explorbot](https://www.npmjs.com/package/explorbot), so `npx explorbot prima <command>` runs the same tool if you already have it.

Requires Node.js 22.13+. Playwright browsers come from `npx playwright install chromium`.

## Session

Prima drives a browser opened by `playwright-cli` and never launches one itself. `browser start` and `browser stop` hand over to `playwright-cli open` and `playwright-cli close`:

```bash
prima-cli browser start https://app.example.com
prima-cli check "the settings page saves a changed theme"
prima-cli browser stop
```

`browser start` reports the session when one is already open. `--pw-session <title>` names the session to open or close. A session you opened with `playwright-cli open` yourself works the same way.

## Commands

| Command | What it does |
| --- | --- |
| `check <scenario>` | Run a scenario end to end as a test, verify it, and report the steps it took |
| `do <instructions...>` | Run high-level instructions tester-style, one argument per instruction |
| `verify <assertion>` | Assert a statement about the current page |
| `ask <question>` | Answer a question about the current page |
| `state` | Capture the current page without acting on it: url, state, open overlay, and the aria, html and screenshot files |
| `research` | Map the current page and return verified locators |
| `ux [focus]` | Review the area being worked on for UX issues at the current width, 768px and 375px |
| `go <target>` | Navigate to a url, a path, or a page described in plain words |
| `pw <fn>` | Run a Playwright function expression against the open page |
| `status <hash>` | Show the artifacts and page detail recorded for an earlier command |
| `report` | Turn every command of a session into one html and markdown report |
| `video` | Join and edit the `do` and `check` recordings of a purpose into one video |
| `browser start [url]` | Open a playwright-cli session for prima to drive, or report the one already open |
| `browser stop` | Close the playwright-cli session |
| `config` | Show models, config file and paths used by this run |
| `skill` | Print the skill that teaches a coding agent to use prima, or install it with `--install` |

`check` takes an outcome rather than a click path. It runs on the page you are already on and never reloads it, so an open dialog survives the check. Each `--expected` outcome comes back as PASSED, FAILED, CONTRADICTION or not verified — settled against a screenshot of the whole page, because what a user can see is the proof.

`do` accounts for every instruction you gave: each is reported as ok, FAIL or ??. Nothing runs past the last instruction.

`ux` reviews one area, not the whole page. A named focus is shown first with at most one click, which may open a dialog, tab or section or go to another page; nothing is submitted, and when no click leads to it the command fails without reviewing. The area reviewed is the dialog or region open on the page, else the focus you named, else the area your session's commands on this page acted in, else the main content. It measures target sizes, spacing, overflow, text size, zoom and motion at each width, runs axe on the area, and asks the model to judge copy, forms and navigation against the rules in `rules/quartermaster/ux/`. Findings are ranked Critical to Low. It reports problems only: no replacement wording and no colors or styles, since the project owns those. Override a rule by placing a file of the same name in `./rules/quartermaster/ux/`, or add your own with `ai.agents.quartermaster.rules`.

## Purpose and video

`--purpose <text>` marks a series of commands as working toward one goal. Every command run with the same text joins one Langfuse session, and `report --purpose <text>` reports just those commands, even across browser restarts.

Each command run with a purpose gets a number, `#0001`, `#0002` and so on in hex, printed on its `purpose:` line.

`--video` on `do` or `check` records the command. `video --purpose <text>` joins the recordings into one webm and prints its path:

```bash
prima-cli do "add an item to the cart" --purpose "checkout" --video
prima-cli check "the cart total updates" --purpose "checkout" --video
prima-cli video --purpose "checkout"
```

Without options, every command that passed is joined in run order. Waits are condensed, so a still frame holds for at most a second, and a recording where nothing moved on screen is left out. Recording needs `ffmpeg` on PATH.

Edits refer to commands by number:

| Option | Effect |
| --- | --- |
| `--list` | List the purpose's commands with number, result and whether a recording exists |
| `--only 0003,0001` | Join only these commands, in this order; failed ones may be picked |
| `--caption 0001="Add to cart"` | Show a caption over one command |
| `--speed 0001=2` | Play one command faster (`2`) or slower (`0.5`) |
| `--hold 0003=3` | Hold the last frame of one command for 3 seconds |

`--caption`, `--speed` and `--hold` repeat for several commands:

```bash
prima-cli video --purpose "checkout" --only 0002,0001 --caption 0002="Cart total updates" --speed 0001=2 --hold 0002=3
```

## AI model

Prima needs a model, and one API key is all the setup there is. Export the key of the provider you use and prima picks that provider's recommended models for every role, from the list bundled with the package. There is no `init` to run and nothing is written for you.

```bash
OPENROUTER_API_KEY=your-key
```

`prima-cli recommended-models` prints every supported provider, the key each one reads, the models it gets per role, and which keys are already set. Prefer it to any model name written down elsewhere: the recommendations change between versions.

When several keys are exported, name the provider:

```bash
PRIMA_CLI_AI_PROVIDER=openrouter
```

To pin a role yourself, write the model as `provider/model-id` in `PRIMA_CLI_AI_MODEL`, `PRIMA_CLI_VISION_MODEL` or `PRIMA_CLI_AGENTIC_MODEL`, or pass `--model` and `--vision-model` for a single run. `PRIMA_CLI_DECISION_MODEL` or `--decision-model` sets the [decision model](https://github.com/testomatio/explorbot/blob/main/docs/web-testing/decisions.md), which answers narrow yes/no and pick-one questions so the main model is called less often.

Prima is usually run by a coding agent, so the best home for the key is the agent's own config, where it reaches every command the agent runs.

Claude Code, in `~/.claude/settings.json`:

```json
{
  "env": {
    "OPENROUTER_API_KEY": "your-key"
  }
}
```

Codex, in `~/.codex/config.toml`:

```toml
[shell_environment_policy]
set = { OPENROUTER_API_KEY = "your-key" }
```

`set` is applied after Codex filters the inherited environment, so the key survives even where names containing `KEY` are stripped.

To run prima yourself, or from any agent that inherits your shell, export it in `~/.bashrc` or `~/.zshrc`:

```bash
export OPENROUTER_API_KEY=your-key
```

Fish uses `set -gx` in `~/.config/fish/config.fish` instead of `export`.

A provider that serves no vision model leaves screenshot analysis off. Prima still runs then, but settles `check` outcomes from the run log rather than from the page as seen; set `PRIMA_CLI_VISION_MODEL` to add one.

Every `PRIMA_CLI_*` variable mirrors the `EXPLORBOT_*` one of the same name and wins over it, so prima can be pointed at a different provider, model or URL without disturbing an explorbot setup on the same machine.

Where [explorbot](https://www.npmjs.com/package/explorbot) is already configured, prima reads its config too — a project's `explorbot.config.js` first, then `~/.explorbot/config.js`. A bare API key applies only when neither exists; `PRIMA_CLI_AI_PROVIDER` and `PRIMA_CLI_AI_MODEL` win over the global config. `prima config` prints what a directory resolves to, and `--ephemeral` keeps no state between runs, writing output to a temp directory.

Without a model `pw` still works, since it runs Playwright directly.

## Agents

Prima is built to be called by a coding agent: one call takes a whole job, and the reply is a compact report rather than a browser transcript. Prima ships its own skill, which teaches an agent to describe behaviour instead of scripting clicks:

```bash
prima-cli skill                    # print the skill
prima-cli skill --install          # install into this project
prima-cli skill --install global   # install into your home directory
```

`--install` writes `prima/SKILL.md` into `.claude/skills` and `.agents/skills`, which Claude Code, Codex and OpenCode read.

## License

Elastic-2.0. Part of [explorbot](https://github.com/testomatio/explorbot).
