# Running Explorbot: TUI and CLI

There are two ways to run Explorbot: an interactive terminal UI where you watch and steer, and plain CLI commands that do one job and exit. Same engine, same config, same artifacts — the difference is whether you are in the loop.

| Use | Choose it when | Start with |
|-----|----------------|------------|
| **TUI** | You are learning, steering, or debugging interactively | `npx explorbot start /path` |
| **CLI** | You want one repeatable task that prints a result and exits | `npx explorbot explore /path` |
| **Persistent browser** | You run several local commands and want to avoid starting a new browser process each time | `npx explorbot browser start --show` |
| **CI** | You need unattended, scheduled, or pipeline runs with saved reports | `npx explorbot explore /path --max-tests 10` |

Persistent browser is an optimization for local TUI or CLI work, while CI uses CLI commands. Each command still creates a fresh browser context; use `--session` when cookies and login state must carry over. See [Persistent Browser](../reference/commands.md#persistent-browser) and [Continuous Integration](../workflow/ci.md) for setup details.

## TUI mode

`npx explorbot start` opens the interactive terminal UI. Pass a path to start on a specific page:

```bash
npx explorbot start /admin/projects
```

The screen splits into a log pane, where everything Explorbot does is printed as it happens, and an input line at the bottom. Type slash-commands to drive it:

```
/explore     # full loop: research, plan, test, repeat
/research    # analyze the current page
/plan        # propose test scenarios
/test        # run the next test
```

You can also type raw CodeceptJS commands — `I.click('Save')`, `I.amOnPage('/login')` — and they execute in the browser immediately. In interactive mode the bot asks you for help when it gets stuck, instead of giving up.

Use the TUI for:

- **First runs.** You see every step and every mistake as it happens.
- **Teaching Explorbot your app.** Watch it fail, add a knowledge file, retry — the tight loop is what the TUI is for.
- **Debugging a failing scenario.** Replay it step by step with slash-commands and raw `I.*` commands.

The TUI needs a modern terminal — iTerm2, WARP, Kitty, Ghostty, or Windows Terminal with WSL; see [Prerequisites](./prerequisites.md) for the compatibility notes.

## CLI mode

Every other command runs without the TUI: it launches a browser (headless by default), does its job, prints the result, and exits.

| Command | What it does | Docs |
|---------|--------------|------|
| `explore <path>` | Research a page, plan tests, run them, move to sub-pages | [Web Testing Basics](../web-testing/basics.md) |
| `plan <path>` | Generate a test plan as markdown and exit | [Test Plans](../workflow/test-plans.md) |
| `test <planfile> [index]` | Run tests from a saved plan | [Test Plans](../workflow/test-plans.md) |
| `rerun <file>` | Re-run generated tests with AI healing | [Rerun](../web-testing/rerun.md) |
| `docs collect <url>` | Crawl pages and generate documentation | [Doc Collection](../doc-collection/basics.md) |
| `api plan` / `api test` / `api explore` | Plan and run API tests | [API Testing](../api-testing/basics.md) |

The full list, with every option, is in the [Commands reference](../reference/commands.md).

### Exit codes

CLI commands follow one rule: exit `0` when the run completed, `1` when the run itself failed — a config error, an unreachable start page, a provider that won't respond. Before exiting, the CLI shows a short session summary if anything happened during the run.

For `explore` and `test`, a failing test does **not** change the exit code. The run completed; the failure is a result, printed in the console summary and recorded in the reports. So `npx explorbot explore / || echo broken` catches crashes, not bugs. To gate a pipeline on test results, read the reports — see [Continuous Integration](../workflow/ci.md).

A few commands have sharper semantics you can script against:

- `plan` exits `1` when no test scenarios could be generated.
- `navigate <url>` exits `0` when the page was reached, `1` when not — a cheap "is the app up and can we log in" probe.
- `api test` and `api explore` exit `1` when any test failed.

## Flags that matter in both modes

The browser runs headless by default; `--show` opens a visible window and `--headless` forces it hidden. `--session [file]` saves and restores the browser session (cookies, localStorage) — the default file is `output/session.json` — so login happens once and later runs skip it. `--incognito` runs without recording experience, useful for throwaway runs. `--verbose` prints debug logs. See the [Commands reference](../reference/commands.md) for the rest.

## Driving Explorbot from other tools

CLI mode makes Explorbot scriptable by anything that can run a shell command — including coding agents like Claude Code. Every input and output is plain markdown: plans land in `output/plans/`, reports in `output/reports/`, and hints live in `knowledge/`. An agent can run `explorbot plan /checkout`, read the generated plan, edit or extend it, run `explorbot test` on it, read the report, then write a knowledge file to fix what confused the bot — and iterate. No API or SDK needed; the files are the interface.

## Running in CI

Because CLI commands exit cleanly and keep their learning in cacheable directories, Explorbot fits scheduled pipelines: run `explore` nightly with a test budget, cache `experience/` and `output/` between runs, and upload the reports. See [Continuous Integration](../workflow/ci.md) for worked examples.
