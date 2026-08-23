# prima-cli

Prima is a high-level AI browser driver. You describe the behaviour you want checked, and it works out how to reach it — instead of writing selectors and step-by-step click paths.

It drives a browser opened by [playwright-cli](https://www.npmjs.com/package/playwright-cli), or one of its own.

```bash
npx prima-cli check "a workflow can be created and appears in the list" --expected "the new workflow is listed"
```

## Install

```bash
npx prima-cli --help          # no install
npm install -g prima-cli      # or install it
```

Prima also ships inside [explorbot](https://www.npmjs.com/package/explorbot), so `npx explorbot prima <command>` runs the same tool if you already have it.

Requires Node.js 24+. Playwright browsers come from `npx playwright install chromium`.

## Session

Prima needs a browser to drive. Either attach to a `playwright-cli` session:

```bash
playwright-cli open https://app.example.com
prima-cli check "the settings page saves a changed theme"
playwright-cli close
```

Or let prima own the browser:

```bash
prima-cli browser start --url https://app.example.com
prima-cli do "open the account menu" "choose the settings entry"
prima-cli browser stop
```

## Commands

| Command | What it does |
| --- | --- |
| `check <scenario>` | Run a scenario end to end as a test, verify it, and report the steps it took |
| `do <instructions...>` | Run high-level instructions tester-style, one argument per instruction |
| `verify <assertion>` | Assert a statement about the current page |
| `ask <question>` | Answer a question about the current page |
| `research` | Map the current page and return verified locators |
| `go <target>` | Navigate to a url, a path, or a page described in plain words |
| `pw <fn>` | Run a Playwright function expression against the open page |
| `status <hash>` | Show the artifacts and page detail recorded for an earlier command |
| `report` | Turn every command of a session into one html and markdown report |
| `browser start\|stop\|status\|list` | Manage the browsers prima drives |
| `config` | Show models, config file and paths used by this run |

`check` takes an outcome rather than a click path. It runs on the page you are already on and never reloads it, so an open dialog survives the check. Each `--expected` outcome comes back as PASSED, FAILED, CONTRADICTION or not verified — settled against a screenshot of the whole page, because what a user can see is the proof.

`do` accounts for every instruction you gave: each is reported as ok, FAIL or ??. Nothing runs past the last instruction.

## AI model

Prima needs a model, and takes it from the environment. There is no `init` to run and nothing is written for you.

```bash
export PRIMA_CLI_AI_MODEL=openrouter/openai/gpt-oss-120b
export OPENROUTER_API_KEY=your-key
```

The provider comes from the model name, so that is the whole setup. Fish uses `set -gx` instead of `export`. Since prima is usually run by a coding agent, the better home is the agent's own config — in `~/.claude/settings.json`, an `env` block reaches every command the agent runs:

```json
{
  "env": {
    "PRIMA_CLI_AI_MODEL": "openrouter/openai/gpt-oss-120b",
    "OPENROUTER_API_KEY": "your-key"
  }
}
```

Screenshot analysis needs its own model — one is never guessed from the main model. Set `PRIMA_CLI_VISION_MODEL`, or pass `--vision-model` for a single run, as `--model` does for the main one. Without it prima still runs, but settles `check` outcomes from the run log rather than from the page as seen.

Every `PRIMA_CLI_*` variable mirrors the `EXPLORBOT_*` one of the same name and wins over it, so prima can be pointed at a different provider, model or URL without disturbing an explorbot setup on the same machine. `PRIMA_CLI_AI_MODEL`, `PRIMA_CLI_URL`, `PRIMA_CLI_VISION_MODEL` and the rest all work this way.

Where [explorbot](https://www.npmjs.com/package/explorbot) is already configured, prima reads its config too — a project's `explorbot.config.js` first, then `~/.explorbot/config.js`. Variables win over both. `prima config` prints what a directory resolves to, and `--ephemeral` keeps no state between runs, writing output to a temp directory.

Providers: openai, anthropic, google, groq, mistral, openrouter, sambanova.

Without a model `pw` still works, since it runs Playwright directly.

## Agents

Prima is built to be called by a coding agent: one call takes a whole job, and the reply is a compact report rather than a browser transcript. Point your agent at `prima-cli --help` and it will find its way.

## License

Elastic-2.0. Part of [explorbot](https://github.com/testomatio/explorbot).
