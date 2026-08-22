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

Prima needs a model. It reads the same `explorbot.config.js` as [explorbot](https://www.npmjs.com/package/explorbot), and the same `EXPLORBOT_*` environment variables — so no config file is needed if you point it at a provider through the environment:

```bash
export EXPLORBOT_AI_PROVIDER=openrouter
export OPENROUTER_API_KEY=...
prima-cli --ephemeral check "the settings page saves a changed theme"
```

`--ephemeral` keeps no state between runs and writes output to a temp directory. `prima-cli config` prints the models, config file and paths a given directory and environment resolve to. Providers: openai, anthropic, google, groq, mistral, openrouter, sambanova.

Without a model `pw` still works, since it runs Playwright directly.

## Agents

Prima is built to be called by a coding agent: one call takes a whole job, and the reply is a compact report rather than a browser transcript. Point your agent at `prima-cli --help` and it will find its way.

## License

Elastic-2.0. Part of [explorbot](https://github.com/testomatio/explorbot).
