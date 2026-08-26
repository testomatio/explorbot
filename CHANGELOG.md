# Changelog

## 2026-08-26

### Changes

- [Tester] The Tester now remembers every action it took, not only the last one of each turn. When it
  did several things in one turn — click, click, then check — everything but the final action was
  dropped from its memory straight afterwards, so it re-clicked buttons it had already clicked and
  re-checked things it had already confirmed.
- [Pilot] The Pilot now sees the full list of actions and checks when it decides whether a test
  passed. Because most of the Tester's steps were being lost, it often had two lines of activity to
  judge from and failed tests that had in fact succeeded, or kept sending the Tester back to prove
  something it had already proven.
- [Historian] Generated test files now contain every recorded step instead of one step per turn.
- [Provider] Langfuse traces now survive the end of a run. The telemetry batch was never flushed
  on exit, so every session looked abruptly cut off in Langfuse — final actions and the
  session-analysis traces never arrived, and a clean shutdown was indistinguishable from a crash.
  All exit paths (CLI commands and their error branches, TUI `/exit`, Ctrl+C, SIGTERM) now flush
  pending traces before the process exits.

## 2026-08-25

### Configuration

- **`ai.maxParallelRequests`** — How many requests to the AI model may be in flight at the same time,
  across all agents. Additional requests wait in line instead of firing together and tripping provider
  rate limits. Default: `4`.
- **`ai.retryAttempts`** — Renamed from `ai.maxAttempts`, and now pairs with `ai.retryDelay` ("how
  many times × with what pause"). If a private config still says `ai.maxAttempts`, JavaScript configs
  will not warn — rename it manually.
- **`ai.retryDelay`** — Declared since early on but never read; the provider now actually honors it as
  the base pause between retries. Default: `10ms`.

### Changes

- [All agents] Screenshot analysis works again. Images were sent to the vision model wrapped as a data
  URL where the AI SDK expects raw base64, so every visual call failed upstream ("Invalid image_url") —
  in the last overnight run that was 423 failures across 37 of 61 tests, with the `see` tool never
  succeeding once. Screenshots are now sent in the format providers accept.
- [All agents] When the vision model fails, it is now switched off once for the whole session instead
  of only for one tool — previously the researcher kept calling the broken vision path all night.
- [Provider] Model calls are capped by `ai.maxParallelRequests`. In the last overnight run unlimited
  parallelism produced bursts of up to 264 rate-limit errors per minute with tests idling through
  retries; queued pacing replaces that storm.
- [Provider] Models that narrate their reasoning mid-run (the gpt-oss channel format) get a sanctioned
  no-op `commentary` tool instead of a rejected call — that rejection failed the whole generation 132
  times in the last run. Channel-named tool calls are also repaired instead of dropped.
- [Pilot] A check that ran successfully is no longer presented to the verdict as "PASS" evidence —
  what it proves about the goal is what counts, so a check establishing the opposite of the goal reads
  as failure evidence. Reading page state — a snapshot or a UI-map research — no longer counts as proof
  the scenario completed. This removes false-green finishes.
- [Tester] A new test now recovers from an error page left by the previous test before building its AI
  context. When the next test has a different start URL, Tester navigates there first; genuine errors on
  the new test's own start page are still reported normally.
- [Analyst] The end-of-session report is now written even when the exploration loop crashes — the
  session no longer ends silently without one.

## 2026-08-24

### Changes

- `explorbot init` now writes a config that runs as-is. It used to import
  `@openrouter/ai-sdk-provider`, a package it never installed, so the very next command failed with
  "Cannot find package" — under npm the import resolved only because explorbot's own copy got
  hoisted into the project, and under pnpm, bun, or a bare `npx explorbot init` it never did.
  Models are now written as `'provider/model-id'`, resolved from the provider packages explorbot
  already ships. Bringing your own provider package still works — the generated config shows how
  in a comment.
- The model ids in the generated config are taken from the recommendations shipped with the
  release, so a fresh config no longer starts out with stale ones.

## 2026-08-23

### Changes

- Prima reads `PRIMA_CLI_*` environment variables. Each one mirrors the `EXPLORBOT_*` variable of the
  same name and wins over it, so prima can be pointed at a different model, vision model or URL
  without disturbing an explorbot setup on the same machine.
- **`--model <model>`**, **`--vision-model <model>`** — The models prima runs on, each as
  `provider/model-id`, overriding `PRIMA_CLI_AI_MODEL` and `PRIMA_CLI_VISION_MODEL` for one run. A
  vision model is never guessed from the main one, so naming only a main model leaves screenshot
  analysis off.
  ```bash
  prima-cli check "the theme switch sticks" --model openrouter/openai/gpt-oss-120b
  prima-cli check "the theme switch sticks" --vision-model openrouter/google/gemma-4-31b-it
  ```
- [Tester] The prompt no longer promises page HTML that was never sent. The Tester was told to work
  from a `<page_html>` section in four places, but nothing ever put one there — it only ever received
  the accessibility tree and the UI map. It is now told what it actually has: the accessibility tree,
  the page diffs that come back with each action, and HTML it asks for by calling a tool.
- [Tester] When the accessibility tree is not enough, the Tester now knows to hand the step over
  rather than guess. `interact()` is described as what it is — one step delegated to the Navigator,
  which reads the whole page — and the Tester is reminded of it every turn, for the three cases it
  helps with: the direct action tools failed, the step needs a sequence of actions, or the element is
  missing from what the Tester can see.
- [Tester] A test no longer stops early after a delegated step succeeded. A successful `interact()`
  that left the page looking unchanged used to count as no progress at all, and three of them ended
  the test.
- [Pilot] The Pilot no longer pushes a full page of HTML into the Tester mid-test. It can still
  attach the accessibility tree, a page summary, or the UI map when recent actions failed.
- Prima now ships as its own npm package, so `npx prima-cli` runs it without installing explorbot
  first. It is the same tool as the `prima` command that comes with explorbot, built from the same
  source and released alongside it — only the package name and the binary differ.
- Terminal colour no longer depends on another package happening to provide it. `chalk` is used
  throughout the log output but had never been declared as a dependency, so a published install
  resolved it only by accident and could have lost colour, or failed to start, at any time.

## 2026-08-22

### Changes

- [Pilot] now chooses which recorded solutions a test is given. It reads the list of titles for the
  page it is on, opens the ones that match the scenario, and only those reach the Tester — when it
  plans a test, when the test lands on a new page, and when a step keeps failing.
- [Pilot] drops the list of titles from the previous page even when the new page has nothing
  recorded for it, so it never picks a solution belonging to a page the test has already left.
- A recorded solution the Pilot opened earlier is now offered back to a step only on the page it
  was recorded for. A test that picked one up on an earlier page used to carry it to every page it
  visited afterwards, presented as if it belonged there.
- [Tester] no longer reads recorded solutions at all — neither the recipes nor the list of their
  titles. A single page can hold recipes for a dozen unrelated features, and handing all of them
  over put work with nothing to do with the current scenario in front of the model. Everything it
  learns from earlier runs now arrives through the Pilot.
- [Navigator] uses the solution it was handed rather than loading every one recorded for the page.
  Where nobody hands it one — recovering a failed page visit, free sailing — it still loads them
  itself, since there is no one there to choose.
- [Driller] and [Captain] can now open a recorded solution by title in every mode, the way the
  other agents do.
- Documentation: CLAUDE.md now defines the boundary contracts between agents and data modules,
  the persisted file formats vs session artifacts, the rules for extending envelopes, per-agent
  HTML access tiers, a feature routing test, guidance on when to use regex versus AI judgment,
  and the git worktree workflow.
- New Bunosh tasks for feature worktrees: `worktree:create <feature>` opens a new branch off main
  in a sibling directory, `worktree:fetch <branch>` opens an existing branch there, both symlinking
  the main checkout's `node_modules`; `worktree:delete [branch]` removes a worktree when merged.

## 2026-08-21

### Actions report what the app said and did, not just how the page moved

A click that fired a request the server rejected used to look like a success. The page diff described
DOM and accessibility-tree movement only, so a toast reading "Operation against a key holding the wrong
kind of value" was either buried in raw markup or dropped altogether, and the rejected request surfaced
much later as a session-wide count. Every action now also carries:

- **messages** — text the app put on the page in response: toasts, alerts, banners and inline errors,
  including ones built without any accessibility markup. An action that navigated reports only what its
  live regions announced, so the content of the page that opened is not read back as a reply
- **requests** — the calls the action made to the application, each with its status, capped per action
  with rejected calls kept ahead of successful ones
- **consoleErrors** — what the page logged while the action ran

When a request comes back 400 or 500 the result leads with that, and points at the message the user was
shown, rather than leaving the model to read the click as successful and repeat it.

Elements are no longer compared across two pages. An action that navigated used to report one ARIA diff
whose halves belonged to different pages — the elements of the page left behind listed as removed next to
the elements of the page arrived at, with the chrome common to both cancelled out and nothing saying which
side was which, so elements that no longer exist read as available. Such an action now reports the move
itself, the message the app announced in transit, and its requests; the page arrived at is described in
full by the context that follows it.

The Pilot's review reads the same evidence attached to the action that caused it, narrowed to what
indicates failure: rejected requests, the first two messages, one console error. It used to get a bare
`POST /api/… → 400` with no page context, which reads as a missing value, and would send the tester back
to fill in a form that was already filled.

### Changes

- Console messages from the browser were dropped before they were ever recorded, so console errors always
  showed as none and a page that logged its own failure reported nothing.
- AI models that emit channel markers in tool names (e.g. `click<|channel|>commentary`, common with
  gpt-oss and gemma) no longer waste a turn: the provider now repairs the name to the real tool and
  executes it, instead of rejecting the call and telling the AI to retry. In a 24h CI sample this
  rejection burned 93 tool calls across 34 test traces.
- [Fisherman] A captured request rejected by the API is no longer presented as a valid request
  example. OpenAPI definitions take precedence when available, and failed responses now identify
  whether validation, authorization, routing, conflict, temporary, or server handling is needed.
- [Researcher/Planner] Similar HTML is reused only after URL-aware matching: new fingerprints
  store their source URL, candidates from other page families are filtered before the best match is
  selected, and Planner applies the same check before reusing a state hash. Legacy fingerprints
  without URL metadata remain readable for backward compatibility.
- Configuration: absolute configured directories are now respected as-is instead of being joined
  onto the project root, which produced doubled, unusable paths on Windows.
- A browser command that fails now reports a short error instead of Playwright's full retry log.
  Click, hover, key press, form and back/reset failures used to carry every wait and retry line,
  the same reason repeated once per attempt, and terminal color codes — around 850 characters for
  one disabled button. What is left is the element the locator resolved to and the reason it could
  not be acted on, so the AI reads the blocker instead of scrolling past bookkeeping.

## 2026-08-20

### Changes

- [Pilot] A test no longer burns its whole budget asking for the same test data over and over. When
  the page check that decides whether the test can go on without that data failed, nothing came back
  at all, so the request looked unanswered and was repeated until the test ran out of steps without
  ever touching the browser. The check now always answers, even when it cannot look at the page.
- [Pilot] When test data could not be prepared, the answer now says so plainly — it was not created,
  it cannot be created automatically, and the test should carry on with what the page already shows.
- A click whose command never parsed as JavaScript is now reported as a broken command, not as a
  missing element. Mismatched quotes or brackets used to be answered with advice to hunt the DOM
  with `xpathCheck()`, `see()` or `visualClick()`, so the AI searched for an element that was never
  looked up and re-emitted the same broken command. It is now told the string was invalid, that
  nothing was learned about the page, and to re-emit the same intent as valid CodeceptJS.
- `xpathCheck` that matches nothing no longer suggests broadening to a generic expression. It now
  asks for narrowing down from what is known about the target — its role, its visible text, its
  nearest labelled ancestor — one constraint at a time, instead of inviting another blind guess.

## 2026-08-18

### Changes

- Navigation that fails now says why. It used to report only where the browser ended up
  ("redirected to /users/sign_in and could not resolve"); it now names the blocker the AI reported,
  or the step that kept failing, and points at `explorbot learn "<path>"` when nothing is known
  about the page — the usual case being a login page whose credentials were never provided.
- A failed `interact` step carries that same reason instead of a bare "Failed to execute", so it
  reaches the test log instead of stopping at the navigator.
- A browser that crashes and cannot be restored now stops navigation at once. It used to spend every
  remaining attempt, and a model call with each one, against a page that was already gone.
## 2026-08-19

### `explorbot config` names the provider behind every model

Model ids alone do not say where a model is served from — `openai/gpt-oss-120b` may run through
OpenRouter, and a config can mix providers across roles. Each model is now printed next to the
provider it comes from:

```
Models
  model         groq        gpt-oss-120b
  agenticModel  anthropic   claude-sonnet-4.5
  visionModel   openrouter  google/gemma-4-31b-it
  tester        openai      gpt-5
```

`--json` carries the same information as a `providers` object keyed by role, alongside `models`.

## 2026-08-18

### `prima check` no longer reloads the page it was asked about

`check` used to navigate to the current URL before it started, which reloads the page even when the
address is unchanged. Anything the page was holding — an open dialog, a selected tab, a filled but
unsaved form — was gone before the first thing was checked. It now runs on the page already open.

### A `check` verdict is settled against a screenshot, and a disagreement is reported

Outcomes used to be settled from the run log alone, so a claim about layout, position or anything
else the page structure cannot express was judged by something that had never seen the page. Each
outcome is now settled against a screenshot of the page as the run left it. What a user can see is
the proof; the run log only says what was done.

When the two disagree, the outcome comes back as **CONTRADICTION** with both sides quoted, instead
of being resolved one way:

```
### Expected outcomes
1. PASSED       the Add connection dialog opens
2. CONTRADICTION the new connection is listed
      the assertion I.see("staging-db") found the row in the page structure; the screenshot
      shows the list still empty, so the row is in the DOM but not visible
3. not verified  the list scrolls
```

`### Artifacts` then names the html, aria and screenshot of that page on disk, so the disagreement
can be settled by opening them rather than by trusting the verdict.

That case — a row present in the markup but invisible on screen, whether hidden, collapsed,
covered or drawn off-screen — is a real defect that a PASSED would have buried behind a matching
assertion and a FAILED would have mislabelled as a broken feature.

A contradiction needs the picture to positively contradict the run — a list visibly empty, an error
where a result was expected. Simply not finding something in the picture is reported as "not
verified" instead, since a screenshot is not proof that a thing is missing.

`ok:` now follows those outcomes: false when one FAILED or CONTRADICTED. An outcome the run never
checked stays "not verified" and does not fail the command. A run that could not complete at all
says so, instead of reporting it as a failure of the application. When no screenshot backed the
outcomes — no `ai.visionModel` configured, or the vision model could not answer — the envelope
carries a `### Warning` saying so.

### Changes

- `prima do` marks an instruction it could not confirm `??` in `### Steps` instead of reporting it
  as an error. Previously an instruction whose action had landed, but which the model never got
  round to reporting, failed the whole command — a red for missing paperwork. The actions that ran
  are listed above the `??` row. Only a failed action and an instruction the page could not carry
  out fail the command now.
- `prima do` reports an AI error while it was working out which instructions were satisfied as its
  own step, rather than blaming the instruction that went unreported because of it.
- `prima verify` judges a claim from a screenshot when no assertion can express it, instead of
  answering "none ran" and stopping there.
- `prima status <hash>` returns the page details and the paths to the saved snapshot, and no longer
  reprints the whole accessibility tree that those files already hold.
- Vision that fails or is switched off mid-run is now stated in the envelope wherever it changes an
  answer, instead of quietly falling back to page structure.
- [Pilot] Settles expected outcomes against the final screenshot, treating what the page shows as
  the proof and reporting a disagreement with the run log rather than resolving it. Falls back to
  the log alone when the vision model cannot produce a verdict.
- The `EXPLORBOT_*` reference no longer follows the help of every command and boat. It is printed
  once, by `explorbot --help`, and `explorbot config` shows the variables actually in effect.

### A run streamed over `--ws` reports what it is testing, not only what it logs

`--ws <url>` (or `EXPLORBOT_WS_URL`) carried the log and the questions a run asks. It now also
announces the run's state as it changes, so a host UI can show what is happening without reading it
back out of log lines:

- the page under test — URL, path, title and heading, on every navigation
- the test in flight — scenario, status, result, priority and the plan it belongs to, as it starts
  and as it finishes
- the plan — its title and every test in it, whenever it is generated, loaded, or advances
- the screenshot just taken — its path on disk
- the research for the current page — the markdown and the file it was written to
- the end-of-session report — the analyst's markdown in full, and its file

Each arrives the same way the log already does, as `{type, ts, ...}`, and a UI renders the kinds it
recognises.
### The configuration a run uses is one command away

`explorbot config` prints what a run resolves to, instead of leaving you to reconstruct it from the
config file, the environment, and the global installation:

```bash
explorbot config                            # the current site
explorbot config https://app.example.com    # a specific site
```

```
Config
  config      /home/me/.explorbot/config.js
  url         https://app.example.com
  browser     chromium, headless
  output      /home/me/.explorbot/sites/app.example.com/output
  knowledge   /home/me/.explorbot/sites/app.example.com/knowledge
  experience  /home/me/.explorbot/sites/app.example.com/experience

Models
  model   openai/gpt-oss-20b
  tester  anthropic/claude-sonnet-4.5

Environment
  EXPLORBOT_AI_PROVIDER  openrouter
```

Every model role is listed, per-agent overrides included, next to the file they came from — or
`EXPLORBOT_* environment variables` when the run is configured from the environment. Langfuse and
Testomat.io show up when they are on.

The boats answer for their own configuration the same way: `explorbot api config`,
`explorbot docs config`, `explorbot prima config`. Inside a session, `/config`.

`--json` prints the same values as a machine-readable object, for a script that needs to know which
model a run will use or where its output will land:

```bash
explorbot config --json
```

### Langfuse tracing is switched from config, not from environment variables

Whether a run is traced is now decided by `ai.langfuse.enabled` in `explorbot.config.js`. It stays on
by default whenever `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are available, so nothing changes
for an existing setup, and setting it to `false` turns tracing off even with the keys exported.

```js
ai: {
  model: openrouter('openai/gpt-oss-20b:nitro'),
  langfuse: { enabled: false },
},
```

Keys and host are resolved once when the configuration is loaded. Code that builds an AI provider
without a loaded configuration — a test, for instance — no longer opens a telemetry connection just
because the keys happen to be in the environment.

## 2026-08-16

### Changes

- Token counters include the attempts that were retried. Only the attempt that finally succeeded
  was counted, so a run that retried its way through a flaky model reported a fraction of the
  tokens it had actually spent.
- Starting on a host other than the configured one now says so. Relative navigation still resolves
  against the base URL, so the warning names the `web.url` to set to make the two agree.
- `--session <file>` resolves against the working directory given by `-p, --path` rather than the
  directory the command was started from, so a run pointed at another project keeps its session
  file with that project.

## 2026-08-12

### Prima shows what it is doing while it does it

A prima command used to sit silent until the envelope arrived. It now writes the current activity —
the model it is asking, the browser step underway, the scenario it is testing — as a single line
that each new activity overwrites. The line is erased before the envelope is printed, so the report is the only thing left
on screen.

It is drawn on stderr and only when that is a terminal: piped or captured output stays exactly as it
was, byte for byte. With `DEBUG` set the log takes over and the line stays out of its way.

## 2026-08-11

### Prima prints its log when `DEBUG` is set

`DEBUG` in front of any prima command prints everything the run does: config and browser
attachment, every step as it executes, and the debug stream of the agents behind it. Prima carries
no logging flags of its own — `--verbose` and `--debug` are gone.

```bash
DEBUG='explorbot:*' prima do "open the account menu" "switch the theme to dark"
DEBUG='explorbot:tester' prima check "a workflow can be created"
```

### Changes

- Verbose mode turns the debug log on for real. It set the `DEBUG` variable after the logging
  library had already read it, so `explorbot --verbose` printed a fraction of what
  `DEBUG='explorbot:*'` printed in front of the same command.
- Page snapshots no longer carry variant-prefixed classes such as `dark:`, `hover:` or `md:`. Those
  classes describe how an element looks in some other state, not what it is, so the agents now read
  a smaller and less noisy page.

## 2026-08-10

### `prima report` collects a whole session into one report

Every prima command is logged to `output/prima/sessions/` as it runs. `prima report` turns that
log into an HTML and a Markdown report — each command with its steps, expected outcomes and the
proof recorded for them. It needs no browser, so the report still comes out after the session is
closed.

```bash
prima report                      # the session used most recently
prima report --pw-session my-app  # a named playwright-cli session
```

The log is written in the format the Testomat.io reporter replays, so the same file can be sent
to Testomat.io as a run:

```bash
TESTOMATIO=<apiKey> npx @testomatio/reporter replay <the path prima report prints>
```

### Changes

- [Prima] Prima no longer generates a report of its own while it runs. A `check` used to end by
  writing the session HTML and Markdown reports, which belong to an explorbot run rather than to
  a single command. Reports are produced only when `prima report` asks for one.

## 2026-08-09

### `prima check` runs a whole scenario and reports what it proved

`prima check` takes a behaviour, not a click path, and runs it the way a tester would: it drives
the page, verifies the outcome itself, and reports every step with the proof for each. Use it when
you want a verdict; use `prima do` when you already know the steps.

```bash
prima check "a workflow can be created and appears in the list" --url http://app.test
prima check "signup rejects a duplicate email" \
  --expected "an error names the email as taken" \
  --expected "no second account is created"
```

- **`--expected <outcome>`** — an outcome the run must reach; repeat the flag for several. Without
  it the scenario text is the single expected outcome. Each one comes back under
  `### Expected outcomes` as `PASSED`, `FAILED` or `not verified` — "not verified" means the run
  never checked it, which is not the same as false.
- **`--url <url>`** — open that page before starting, when the browser is not already on it.

### `prima status <hash>` reopens an earlier command

Every envelope prints a hash on its `### Instance` line. `prima status <hash>` returns the page
detail and artifact paths recorded for that command, so envelopes stay short and the full ARIA
tree, HTML and network log are one command away instead of inline.

```bash
prima status 66800d6d2c8c553
```

### Changes

- [Prima] `do` now ends at the last step you gave it. It used to keep acting after the sequence
  was finished, and could report success while a step it was asked to check never held. A step it
  could not carry out is named under `### Failure` and fails the command.
- [Prima] `do` carries the same tools a test run does, so a single call can act, look and assert
  across a long sequence rather than being split into one command per step.
- [Prima] `pw` returns the value of the expression under `### Value`. A `page.title()` or
  `locator.count()` used to run and have its answer thrown away.
- [Prima] `verify` lists every assertion it ran with its own `PASSED` or `FAILED`, plus the
  Playwright form of the ones that held, and gives no overall verdict — read the lines and decide.
- [Prima] Research output drops CSS selectors, XPaths and coordinates, which were the bulk of the
  map and are not what you act on.
- [Prima] Prima commands print the envelope and nothing else. The banner, config line, browser
  startup and disconnect chatter are hidden unless `--verbose` or `--debug` is passed.
- [Prima] `click` and `fill` are removed — describe the whole sequence to `do` instead, which
  attaches once and carries all of it.
- [Tester] A test that stops making progress is handed to final review instead of being marked
  failed on the spot. A run that had already done its work and gone quiet was reported as a
  failure; the verdict now comes from reviewing the result.
- [Tester] Console and network errors seen during a run are reported as page problems rather than
  as failed steps, so they no longer sink a test that otherwise passed.
- [Tester] An expected outcome counts as settled only when it is recorded back word for word,
  and the prompt now says so — outcomes phrased differently were silently left unaccounted for.
- Page changes report values typed into fields, under a `typed:` section, alongside what was added,
  removed and toggled. Filling a form previously showed as no change at all.
- Long field values in page snapshots are cut to an excerpt with a pointer to the full text, which
  keeps a page holding a large document readable.
- Pages are considered ready as soon as the DOM goes quiet, instead of waiting on network idle.
  Applications with a live websocket never reached network idle, so every snapshot paid the full
  timeout.
- Generated tests assert element visibility, hidden state and field values through real Playwright
  locators instead of leaving a TODO comment.

## 2026-08-07

### Prima never substitutes your target

A failed action now fails. Previously a `pw` call on a selector that did not exist could be
"healed" into clicking a different element and still report `ok: true` — so `ok: true` did not
mean your own action landed. Automatic retry along a different route is gone entirely, together
with the `--no-heal` flag that used to switch it off, and the `healed:` line and
`### Healing attempts` block in the envelope.

### Configuration

- **`ai.agents.prima.researchAfterVisits`** — how many visits to a page before `prima do` works
  from that page's stored research map instead of its accessibility tree. Default: `3`.

### Changes

- [Prima] `### Changes` now appears on every action, showing what the accessibility tree gained,
  lost or toggled — or saying `no change` outright. It previously went missing whenever the
  command also produced an answer, a research map or a verdict, so a successful click proved
  nothing.
- [Prima] Attaching to a running `playwright-cli` session works again. Prima was matching on a
  field that no release of `playwright-cli` writes, so it reported no browser while one was open
  and told you to open the session you already had.
- [Prima] Attached sessions are driven through the browser's own Playwright build, which is what
  makes reading the page work across versions.
- [Prima] New `context()` step for `do`: when the element an instruction needs is missing from the
  context it holds, it returns the page again, and drops to raw markup if asked a second time on
  the same page.
- [Prima] `network.jsonl` is listed only when requests were actually recorded, instead of always
  pointing at an empty file.
- [Navigator] `verify` now separates "this claim is false" from "no assertion can express this
  claim". A claim it cannot phrase is no longer reported as a failing check, and is no longer
  remembered as one.
- [Navigator] Verification can assert whether a control is enabled, disabled, checked, selected or
  expanded. Only presence and text could be asserted before, so state claims always failed.
- Navigation: a redirect that only adds query parameters — a session id, a workspace flag — counts
  as arriving. Reaching such a page previously burned minutes of retries and could still end in a
  failure while the page sat correctly loaded.
- Page snapshots keep every attribute on an element. A control marked `[pressed]` or `[disabled]`
  used to lose its ref, which hid exactly the controls worth acting on.
- Playwright updated to 1.62.

## 2026-08-06

### Global Installation

Explorbot can now be configured once for the whole machine instead of per project. `npx explorbot init --global` stores AI models and keys in `~/.explorbot`, and every explorbot command then works from any directory — no project, no config file to copy around.

```bash
npx explorbot init --global
npx explorbot explore https://app.example.com/login   # first visit registers the site
npx explorbot explore app.example.com/dashboard       # later runs: reference it by host
npx explorbot sites
```

Each explored site gets its own folder under `~/.explorbot/sites/<host>/` holding `knowledge/`, `experience/`, and `output/`, so what Explorbot learns about an app accumulates between runs. The folder name is the host and port of the site, lowercased, with characters invalid in directory names replaced by `_` — `localhost:3000` becomes `localhost_3000`.

Config-free runs use the same folder, so a site keeps one memory however it was started; a global run adds full project behavior on top — generated test files are saved and the Historian is on.

Precedence, highest first: `--config`, a project `explorbot.config.*`, the `EXPLORBOT_*` variables, the global config. Setting `EXPLORBOT_AI_PROVIDER` or `EXPLORBOT_AI_MODEL` therefore overrides a global installation for that one command, while a project config still wins over everything — nothing changes inside existing projects.

The per-host directory config-free runs introduced in the previous release moved from `~/.explorbot/state/<host>/` to `~/.explorbot/sites/<host>/`, and its artifacts now sit under that folder's `output/`. Delete the old `state/` directory; nothing reads it anymore.

### New CLI Options
- **`init --global`** — Set up `~/.explorbot` instead of the current directory. Opens a wizard: pick a provider, paste the API key, optionally check it with one test AI call. Plain `init` in a terminal now asks Local or Global first; the Global option is disabled once a global config exists. Passing `--config-path` or `--path`, or running outside a terminal, means Local as before.
  ```bash
  npx explorbot init                      # asks Local or Global
  npx explorbot init --global             # wizard
  npx explorbot init --global --force     # reinstall over an existing global config
  ```
- **`init --provider <name>`** — Skip the wizard and write the global config for that provider, for agents and scripts. Providers: `openai`, `anthropic`, `google`, `groq`, `mistral`, `openrouter`, `sambanova`.
  ```bash
  npx explorbot init --global --provider openrouter
  ```
- **`init --api-key <key>`** — Store the provider's API key in `~/.explorbot/.env`. Without it the key is expected in the environment; an existing stored key is never overwritten.
  ```bash
  npx explorbot init --global --provider groq --api-key gsk_...
  ```
- **`sites`** — List the sites registered in the global installation: folder name, base URL, and last run.
  ```bash
  npx explorbot sites
  ```

### Configuration
- **`ai.model`, `ai.visionModel`, `ai.agenticModel`, `ai.agents.<name>.model`** — Accept a `'provider/model-id'` string in addition to a model instance, so a config file needs no provider imports. `'openrouter'` on its own resolves to that provider's recommended model for the role. This is how the global config is written, since `~/.explorbot` has no `node_modules` to import provider packages from.
- **`action.timeout`** — Longest a single click, fill, or other page interaction may block before it is reported as failed. Default: `3000` (ms). Previously an interaction inherited `playwright.timeout`, so a click on a disabled or unreachable control could hold the test for the full 30 seconds Playwright allows by default. The limit covers the interaction only — `playwright.timeout` is restored for navigation, waits, and page capture as soon as the commands finish.

### Changes
- Every command and boat now answers a missing configuration the same way, with the three ways to set Explorbot up in order: `init --global`, `init`, or `EXPLORBOT_*` variables. Previously the message named only the project config file and the environment variables, and prima wrapped it as an internal tool error.
- A site can be given by host once it is registered, and an absolute URL keeps its fragment, so hash-routed apps can be explored at `https://app.example.com/#/login`.
- The API key typed into the global setup wizard is masked while typing.
- Added Poolside as a supported AI provider — `poolside/laguna-xs-2.1` for the token-heavy `model` role, reached through the OpenAI-compatible endpoint at `https://inference.poolside.ai/v1` with `POOLSIDE_API_KEY`. It is also selectable config-free as `EXPLORBOT_AI_PROVIDER=poolside`. Poolside serves no `visionModel` or `agenticModel`: its models take text only, and its endpoint accepts a JSON schema without enforcing it, so pair it with another provider for those two roles.
- When the vision model is unavailable, `see` and `visualClick` are now withdrawn from the tools offered to the AI instead of staying available and answering every call with an error. The AI moves to ARIA snapshots and `xpathCheck` immediately rather than spending test steps on visual tools that cannot work. The withdrawal is session-wide — Tester, Pilot, Captain, and Rerunner all stop offering them once the model has failed once.
- [Tester] A failed click now says why it failed. Disabled controls, elements hidden behind an overlay, invisible elements, a wrong container, and a genuinely absent element are reported separately, each with the next step that fits. Previously a disabled button was described as covered by an overlay, and an element missing from a wrong container was described as missing from the page — so the AI kept re-clicking instead of fixing the real cause.
- [Tester] ARIA locators must now be copied from the ARIA snapshot or UI map rather than guessed. When an element is absent from the snapshot, text or CSS is used instead of an invented role and name.
- [Tester] Container locators are now used when a target may match several elements, rather than on every interaction. Every click must still offer one fallback without a container, since a stale container fails on its own.
- Fixed an invalid example in the locator rules that suggested `role: "input"`. That is not an ARIA role and never matches; the correct role for a text field is `textbox`.

## 2026-08-04

### Prima

`explorbot prima` drives a browser that is already open, one command per process, and reports back in plain text. It is meant for coding agents that keep the browser themselves: the agent decides the next step, prima performs it and describes what changed.

```bash
playwright-cli open https://app.example.com
npx explorbot prima research
npx explorbot prima pw "({ page }) => page.click('[data-test=submit]')"
npx explorbot prima verify "the confirmation page shows an order number"
```

- **Commands** — `pw` runs a Playwright function expression built from a locator you already verified, `click` and `fill` take one action described in words, `do` runs several described steps tester-style, `go` navigates, `research` maps the page into verified locators, `ask` answers a question about the page, `verify` asserts a statement, and `browser` manages the browsers prima drives.
- **The envelope** — every page command prints `### Result`, `### Page`, `### Changes`, `### Instance`, and `### Artifacts` on stdout, and exits `0` when the envelope says `ok: true`, `1` when it does not. `used:` holds the code that actually executed, ready to paste into a test. A failure adds the error and the compact ARIA of the page, so the next locator can be picked from the output itself; the full aria, html, and network dumps are written beside it.
- **Healing** — a failed action is retried along a different route, and `healed: true` means the outcome was reached another way. `--no-heal` fails fast instead.
- **Attaching to playwright-cli** — prima never launches a browser. By default it attaches to the playwright-cli browser of the current workspace and works on the tabs already open there, so both tools drive the same session. `--pw-session <title>` picks between several open sessions, `--endpoint <ep>` attaches to a browser server directly. Stopping prima disconnects and leaves the browser open.
- **Named instances** — `prima browser start` runs a prima-owned browser when no playwright-cli session is open, and `--instance <name>` says which one a command talks to, so parallel work gets a browser each. `prima browser list` shows both kinds.
- **Without a config file** — `EXPLORBOT_AI_PROVIDER=groq npx explorbot prima go https://app.example.com` is enough to start. `pw` still works when no model is usable at all, and the commands that need one say so and point at the fallback.
- **Runtime** — prima reaches its browser over a Playwright browser-server endpoint, and that client needs the Node build: run it as `npx explorbot prima …` or through the published `prima` bin. Driving a browser by running the CLI from source under Bun does not connect.

Prima also ships as a standalone `prima` bin. See [Commands](docs/reference/commands.md#prima-boat) for the full reference.

### New CLI Options

- **`--instance <name>`** — Which named browser server to start, stop, or check. Parallel runs get a browser each instead of sharing one.
  ```bash
  explorbot browser start --instance staging
  explorbot browser status --instance staging
  explorbot browser stop --instance staging
  ```

### Configuration

- **`~/.explorbot/config.js|mjs|ts`** — Global configuration, used when the working directory has no `explorbot.config.*`. Lookup order: `--config`, the project config, the `EXPLORBOT_*` variables, then the global config.
- **`~/.explorbot/.env`** — Loaded after the working directory's `.env`, for keys that are not set yet. API keys can live there once instead of in every project.

### Environment Variables

- **`EXPLORBOT_EPHEMERAL`** — Keep no state between runs: output goes to a fresh temp directory instead of the per-host state directory. `prima --ephemeral` sets it for a single command.

### Changes

- Config-free runs now keep their output in a per-host state directory, `~/.explorbot/state/<host>/`, instead of a fresh temp directory every time — states, plans, research, and reports for the same app collect in one place. `EXPLORBOT_OUTPUT` still overrides the location, and `EXPLORBOT_EPHEMERAL=1` restores the throwaway behavior.
- Config-free runs now write experience into that state directory, so what worked on a page is remembered for the next run against the same host. Ephemeral runs still write none.
- `explorbot browser start` now stays in the foreground until Ctrl+C. Previously the process could exit as soon as it had printed the endpoint.

## 2026-07-22

### Changes
- Fixed a test being reported as started when the browser could not be recovered before it began. Browser recovery now runs before the test starts, so a failed recovery no longer leaves a started-but-never-finished test in the report.

## 2026-07-19

### Environment Variables

Explorbot can now run without an `explorbot.config.js`. Set `EXPLORBOT_AI_PROVIDER` and the configuration is built from the environment instead — for CI one-liners, demos, and coding agents driving Explorbot as a terminal command. A config file always wins when one is present, so nothing changes for existing projects.

```bash
EXPLORBOT_URL=https://app.example.com \
EXPLORBOT_AI_PROVIDER=openrouter \
EXPLORBOT_KNOWLEDGE="Log in as admin@example.com / secret123" \
  npx explorbot explore /login --max-tests 3
```

- **`EXPLORBOT_AI_PROVIDER`** — A provider name that fills every model role from that provider's recommended models, so there are no model IDs to look up and the run follows the recommendations as they change. Setting this turns on config-free mode. Providers: `openai`, `anthropic`, `google`, `groq`, `mistral`, `openrouter`, `sambanova`, each using its conventional API-key variable.
- **`EXPLORBOT_AI_MODEL`** — Pins the main `model`. With `EXPLORBOT_AI_PROVIDER` set it is the model id for that provider, used verbatim; on its own it must be `provider/model-id`, split on the first slash so `openrouter/openai/gpt-oss-120b:nitro` selects OpenRouter with model `openai/gpt-oss-120b:nitro`.
- **`EXPLORBOT_URL`** — Base URL to test. The API boat reads it as the base endpoint. Optional when the command already carries an absolute URL, as `docs collect https://…` does.
- **`EXPLORBOT_VISION_MODEL`** — Model for screenshot analysis, overriding the provider recommendation. Takes a provider name or `provider/model-id`.
- **`EXPLORBOT_AGENTIC_MODEL`** — Model for Captain and Pilot decisions, overriding the provider recommendation. Takes a provider name or `provider/model-id`. Combine providers by role, for example `EXPLORBOT_AI_PROVIDER=groq` with `EXPLORBOT_AGENTIC_MODEL=anthropic`.
- **`EXPLORBOT_OUTPUT`** — Output root for states, plans, research, and reports. Defaults to a fresh temp directory, so nothing is written to your project.
- **`EXPLORBOT_KNOWLEDGE`** — Inline knowledge text applied to every page, the quickest way to hand over credentials.
- **`EXPLORBOT_KNOWLEDGE_FILE`** — Path to a knowledge markdown file; its frontmatter is preserved, so it can target specific URLs.
- **`EXPLORBOT_API_SPEC`** — OpenAPI spec path for the API boat.

Config-free runs do not write experience and run with the Historian off, so no generated test files appear and a run leaves no state behind. Point `EXPLORBOT_OUTPUT` at a stable directory, or use a config file, when you want learning to accumulate across runs.

### Configuration
- **`experience.disabled`** — Stop writing experience files while still reading any that exist. Default: `false`.

### Changes
- Added `docs/workflow/agentic-usage.md` — driving Explorbot from a coding agent: the config-free one-liner API, and handing Explorbot a test plan the agent wrote itself (`npx explorbot test plan.md '*'`). Plan files are input only and are never rewritten, so they live in version control next to the code they cover.
- `npx explorbot --help` now lists the `EXPLORBOT_*` variables with an example, so an agent can discover the config-free mode without reading the docs.
- The recommended model IDs in `models.json` are now read at runtime, not just when regenerating the provider docs — they are what a bare provider name resolves to. `models.json` ships with the npm package.
- Documented every AI provider in `docs/basics/providers.md`, with the recommended-model block for each generated from `models.json` by `bunosh docs:sync` and verified in CI on release. Added Mistral as a supported provider — `mistral-small-latest` for the `model` and `visionModel` roles (it reads screenshots), `mistral-large-latest` for `agenticModel`.
- CodeceptJS screenshots now follow `dirs.output` instead of always landing in `output/states`.
- Bare `--session` writes to `$EXPLORBOT_OUTPUT/session.json` when that variable is set. In a temp-directory run the path is not known when the flag is parsed, so pass an explicit `--session <file>` there.

## 2026-07-17

### Changes
- Browser crash recovery now applies to every browser operation. Previously some interactions and page lookups could fail permanently when the page or browser crashed mid-session; now every action, capture, and element query automatically reattaches the page or restarts the browser and retries once before giving up.
- [Captain] The `browser` tool's `restart` action was merged into `recover` — recovering a page now escalates to a full browser restart automatically when needed, so there is no separate action to choose.
- Failed page actions that accidentally entered an iframe now return to the main page automatically. Previously only failed form actions did this; now it applies to every action, so a failed click or keypress can no longer leave the session stuck inside an iframe.
- Research no longer discards whole sections of a page when a container matches more than one element. A container only narrows down where child elements are looked up, so a selector matching every navigation bar or every card on the page is now perfectly usable — each child element inside it is still required to be unique. Previously such a section was declared broken and every element in it was sent back to the AI for repair.
- When a container matches nothing on the page, Explorbot now repairs it by looking at the elements it found inside it and working out their real wrapper, instead of asking the AI to guess a new selector. The section is fixed instantly and keeps working locators for its elements. When several sections share the same broken container and only some of them can be repaired this way, the remaining sections are still sent to the AI repair step instead of being wrongly treated as fixed.
- [Pilot] Pilot's instructions and its list of available tools now stay identical across every call in a session, with the scenario details moved to the end. Providers can reuse the prompt they already processed instead of re-reading it on each call, which lowers the cost of long test runs.
- [Planner] Planning rules and output format instructions now come before the page research, so planning more tests for the same page reuses an already-processed prompt.
- When a click matches several elements, the follow-up question that picks the right one now uses the default model instead of the more expensive agentic model.
- [Captain] Answers now finish as soon as the request is fulfilled — previously every completed request triggered one extra AI call with the full conversation context that produced nothing, roughly doubling token usage per request.
- [Captain] No longer attaches the full page HTML to every request. Only the ARIA snapshot is kept fresh in the conversation; the AI fetches HTML on demand via the context() tool when it actually needs it.
- [Captain] The slash-command tool now lists only command names instead of the full help text of every command, shrinking the prompt sent on each request.
- Research is significantly faster on pages where the AI picks an imprecise container selector. Previously, if more than 80% of the researched locators failed validation, Explorbot threw away the finished UI map and regenerated it from scratch — roughly doubling the time spent on the page. Because a single bad container marks all of its child elements broken, this triggered easily, and the re-research usually just corrected the container anyway. Broken locators now go straight to the repair step that fixes them in place, cutting research on affected pages by about a third.
- Fixed startup failing with `AI connection failed: Invalid 'max_output_tokens'` on models that reject a one-token response. The check that verifies your AI credentials at startup no longer caps the reply length, so it works with every provider regardless of their minimum.

## 2026-07-10

### Changes
- Documented the recommended CI reporting stack in `docs/workflow/ci.md` and `docs/workflow/reporting.md`: Testomat.io cloud reporter + S3 artifact storage + Historian screencasts (`ai.agents.historian.screencast`) + Analyst run overview — review a run from the Analyst summary down to the screencast of a single test. Added a Screencasts section to the reporting guide and screencast uploads to all CI pipeline examples; HTML/markdown reports documented as the local fallback, API runs covered via the same reporter with `output/requests/` logs.
- Replaced the `docs/README.md` index with a machine-readable `docs/index.json` manifest listing all 34 pages in reading order, and renamed `docs/setup/` to `docs/basics/`.
- Getting Started now closes with a glossary of every core concept — state, research, plan, test, knowledge, experience, agents, report — each in a sentence or two with a link to its guide.
- Added `docs/setup/running.md` (TUI vs headless CLI, exit-code semantics, driving Explorbot from coding agents such as Claude Code) and `docs/workflow/ci.md` (scheduled runs on GitHub Actions/GitLab/Jenkins/Azure with cached `experience/` and `output/` for stable execution).
- Rewrote the API testing and doc collection docs as journey-shaped sections, three pages each: `api-testing/` (basics — Chief/Curler concepts, config, auth via `bootstrap`; planning — specs, `api know`, styles; running-tests — index selection, Curler's toolset, request logs, `api explore`) and `doc-collection/` (basics; crawling — scope, path filters, dynamic-page collapsing; interactive-mode — interaction budgets, safety labels, screenshots). Added `web-testing/basics.md` so all three product sections open with the same concepts-and-configuration page, and reordered the docs index by user journey.
- Reorganized `docs/` by product area: `setup/` (install, prerequisites, providers), `web-testing/` (agents, researcher, page interaction, customization, hooks, planner, automated tests, rerun), `api-testing/`, `doc-writing/`, `workflow/` (pages shared by web and API testing: knowledge, test plans, planning styles, reporting), and `reference/` (commands, configuration, scripting). All cross-links and the README index updated.
- Added `docs/workflow/planning-styles.md` — the planning-styles mechanism (built-in styles, cycling, custom style files, `extract-rules`) shared by the web Planner and the API Chief.
- Corrected stale docs across the set: removed unwired researcher options (`excludeSelectors`, `includeSelectors`, `stopWords`, `maxElementsToExplore`) in favor of the real `maxExpandableClicks` and `errorPageTimeout`; fixed command docs to match the CLI (`clean [target]`, `/context:aria|html|data`, `/explore [focus]`) and added missing commands (`freesail`, `compact`, `experience`, `plans`, `add-rule`, `knows`, `test --from-plan`); corrected defaults (rerun heal iterations 3, research cache 6 hours, style cycle normal → curious → psycho, Node.js ≥ 24); fixed invalid Groq/Cerebras model IDs and the Analyst report format description.

### Changes
- Updated `@openrouter/ai-sdk-provider` to [3.0.0](https://github.com/OpenRouterTeam/ai-sdk-provider/releases/tag/3.0.0) — the first release with official Vercel AI SDK 7 support — and removed the temporary vendored PR #511 tarball (`vendor/`). Vision (screenshot analysis via the `see` tool) now works through OpenRouter on the released package.

## 2026-07-05

### Changes
- Refreshed the recommended OpenRouter model set (`openai/gpt-oss-20b:nitro`, `minimax/minimax-m2.5:nitro`) in the Getting Started and Providers docs.
- Temporarily pinned `@openrouter/ai-sdk-provider` to the AI-SDK-7 build from [OpenRouterTeam/ai-sdk-provider#511](https://github.com/OpenRouterTeam/ai-sdk-provider/pull/511) (vendored tarball) so the vision model — screenshot analysis via the `see` tool — works on AI SDK 7; the released provider targets AI SDK 6 and rejected image inputs. Remove the pin once the PR is released. See `vendor/README.md`.
- Added a contributor self-regression harness (`bunosh regression:basic`, `regression:experience`, `regression:all`) that runs Explorbot end-to-end with a real model against a bundled fixture app and checks that research, planning, and test execution (including vision) still work. See `docs/contributing/regression-tests.md`.

## 2026-06-26

### Configuration
- **`ai.agents.<agent>.reasoning`** — Reasoning effort for any agent, set the same way across providers: `'none'`, `'minimal'`, `'low'`, `'medium'`, `'high'`, `'xhigh'`, or `'provider-default'`. Replaces having to set each provider's own key under `providerOptions`. Default: `'low'` for the Researcher, provider default for other agents.
- **`ai.config.maxOutputTokens`** — Maximum output length per AI call, renamed from `ai.config.maxTokens` (Vercel AI SDK 7). The old `maxTokens` key is now ignored, so move any existing value to `maxOutputTokens`. Default: `16384`.

### Changes
- [Researcher] Runs with low reasoning effort by default, so its output budget goes to extracting the UI map instead of the model's internal thinking — this reduces "response truncated" failures on large pages. Override per agent with the new `reasoning` option.
- Upgraded to Vercel AI SDK 7. If you pin AI provider packages in your project, use `ai` v7 with `@ai-sdk/*` v4 (for example `@ai-sdk/openai`, `@ai-sdk/groq`, `@ai-sdk/anthropic`).
- ARIA diff: interactive controls that flip state (checkbox, expanded/collapsed, pressed, selected) are now reported on a dedicated `toggled` line in both directions — so the agent always sees "now checked" or "now collapsed", even when other page changes overflow the diff.
- Run report now includes a Models table listing each role, the model it used, and the tokens it consumed.
- Added SambaNova as a supported AI provider.
- Documentation restructured into `guides/`, `reference/`, and `contributing/`, with a new Getting Started guide, a Customization cookbook (login, cookie banners, modals, test data), and a refreshed README and logo.

## 2026-06-06

### Changes
- [Researcher] Deep research (`--deep`) now builds on previous runs instead of starting over. It reloads the hidden sections (dropdowns, modals, expanded panels, tabs) found last time — even in an earlier session — and replays the action that revealed each to confirm it still works. Sections that still open are reused as-is, ones whose button moved or was renamed are flagged so the AI looks for them again, and when everything still matches the slow click-through exploration is skipped entirely. Previously every deep run re-discovered hidden UI from scratch and could silently miss sections it had found before.
- [Tester] Checkboxes and other toggle controls (switches, selectable rows/items) are no longer flipped back off by accident. The Tester now sets a checkbox with the idempotent `I.checkOption` / `I.uncheckOption` commands instead of `I.click`, so selecting an already-selected checkbox keeps it selected. It also reads the page state after each click and stops re-clicking a control once it already shows the wanted result (checked, selected, or a count/label confirming success). Previously a second click on a selected checkbox could toggle it off — for example dropping a "Select 32 tests" selection back to "Select 0 tests" and saving an empty result.
- [Tester] Before filling a form that saves data (create/update), the Tester now reads each field's requirements — required, type/format, length, and placeholder/hint text — and enters values that satisfy them, instead of submitting and discovering validation errors. Search, filter, and sort forms that only change the view are skipped.

## 2026-06-04

### Changes
- [Tester] When a click or locator keeps failing on a button or link that is plainly visible on the page, the Tester now always tries clicking it by its visual appearance at least once before re-researching, switching targets, or deciding the element is unreachable. Previously it could exhaust broken locators and wrongly conclude a visible control did not exist.

## 2026-06-03

### Changes
- [Pilot] No longer clicks or interacts with the page during supervision — it only inspects, verifies, and suggests the next step for the Tester to carry out. Previously the supervisor could perform clicks and coordinate-clicks itself, so it acted as a second tester on stuck pages and let tests loop far longer than needed.
- [Pilot] Now owns asking the user for help. The "ask the user" escalation moved off the Tester and onto the Pilot, so requests for human input go through the supervisor (interactive mode only); the Tester no longer prompts the user directly.

## 2026-06-01

### Configuration
- **`ai.agents.navigator.verifyAttempts`** — How many assertion checks the Navigator runs when verifying a claim before deciding pass/fail. Lower it to make verification faster, raise it for more confidence. Default: `3`.
- **`ai.agents.navigator.verifyTimeout`** — Timeout in milliseconds for each verification assertion, so a check that won't match fails fast instead of waiting the full page timeout. Default: `1500`.

### Changes
- [Navigator] Verification is faster — it stops as soon as the outcome is decided instead of running every check, runs fewer assertions, and gives up quickly on checks that won't match rather than waiting the full timeout.
- [Navigator] Reuses an earlier verification result on the same page instead of checking the same claim again — including when the new claim is worded differently but means the same thing.
- [Pilot] A scenario whose goal was not actually performed this run no longer passes. Reaching a page, tab, or prompt is treated as a milestone, not success. Scenarios that cannot proceed because a prerequisite is missing — a required control is absent, an integration is not connected, or only a setup/empty-state prompt is shown — are now marked skipped instead of passed.
- [Reporter] Local HTML and markdown reports are no longer produced automatically — turn them on with `reporter.html: true` and `reporter.markdown: true`. The run group is no longer a hardcoded "Explorbot <date>" default. `explorbot init` now writes a `reporter` block (HTML on, markdown on, and a date-based run group) into the generated config, so report output is visible and editable instead of assumed.

## 2026-05-25

### Changes
- [Navigator] Can now stop on its own when reaching the goal requires something only the user can supply. A new `stop(reason)` tool is exposed to the Navigator's AI; the model is instructed to call it when the ARIA diff after an action indicates the application needs something the test cannot provide — for example an authentication failure, captcha, a permission the test cannot satisfy, or knowledge missing from the provided context. Until now the retry prompt told the model both "this is not a locator issue" AND "propose new solutions" in the same turn, so Navigator burned its full retry budget mutating locators that were already correct. The retry prompt is now branched into three explicit paths: the page reacted in a way only the user can resolve → call `stop()`; the page reacted in a way the AI can resolve from existing knowledge → emit the next step; the diff is empty or unrelated → propose a different locator strategy. When `stop()` is called, the reason is logged and surfaced in the interactive failure prompt so the user knows what to fix.

## 2026-05-24

### New CLI Options
- **`explorbot navigate <url>`** — Drive the AI Navigator to a URL from the shell. Exits `0` when the page is reached, `1` when navigation fails (unreachable URL, unresolved redirect, connection refused, etc.). Inherits all common options including `--session`, so the canonical "probe a URL and capture an authenticated session for downstream agents" runs as a single command. The Navigator handles redirects and login walls — it is not a plain `I.amOnPage`.
  ```bash
  explorbot navigate /login --session              # probe + save session to output/session.json
  explorbot navigate /dashboard --session auth.json
  explorbot navigate /unreachable && echo ok       # exit code reflects reachability
  ```
- [Navigator] When a click succeeds but the URL does not change to the expected target, the ARIA diff between the pre-click and post-click page is now included in the next retry prompt. The AI is instructed to read the diff and decide whether the application rejected the submit (in which case it should fix the submitted data, not the locator) or the click simply missed its target. This breaks the "9-attempt syntactic-variant loop" that used to happen when a form submit was rejected by the server — the model now has the evidence to tell the two cases apart.



### New CLI Options
- **`explorbot explore --configure <spec>`** — Reuse a saved plan, mix old picks with newly planned tests, filter by style/priority, and control sub-page behavior. Spec is a single string of `key=value` (or `key:value`) pairs joined by `;`. Keys: `new` (share of `--max-tests` reserved for new tests, also enables reuse), `from` (explicit plan file, also enables reuse), `style` (planning styles to use; also filters old picks tagged with that style), `priority` (filter both old picks and new tests to the listed priorities), `pick_by` (`priority`|`random`|`index` — order in which old tests are selected and executed), `subpages` (`none`|`same`|`new`|`both` — sub-page behavior in reuse mode). Without `new` or `from`, reuse is off and exploration runs as before.
  ```bash
  explorbot explore /checkout --max-tests 10 --configure="new:25%"
  explorbot explore /dashboard --max-tests 8 \
    --configure="new:50%;priority=critical,high;pick_by=random"
  explorbot explore /reports \
    --configure="from=output/plans/reports_v2.md;new:0%"
  explorbot explore /admin --max-tests 5 --configure="new:25%;subpages=none"
  ```
- **`explorbot explore --dry-run`** — Preview a run without executing tests. Picked old tests and newly-planned tests are marked `skipped`; the planner still runs (so you see what it would propose) but no tester actions hit the page and the plan file is not modified.
  ```bash
  explorbot explore /dashboard --max-tests 10 --configure="new:25%" --dry-run
  ```

### New TUI Commands
- **`/explore --configure <spec>`** — Same reuse spec as the CLI option above. Lets you re-run a previously saved plan, blend in fresh AI-planned scenarios, and order picks by priority/random/file index — all from inside the TUI.
  ```
  /explore --configure "new:25%"
  /explore --configure "new:50%;priority=critical,high;pick_by=random"
  /explore /admin --configure "from=output/plans/admin.md;new:0%"
  ```
- **`/explore --dry-run`** — Preview which old picks and newly-planned tests would run, without spending tester time.
  ```
  /explore --configure "new:25%" --dry-run
  ```

### Changes
- [Explore] Reuse mode prints a per-phase preview during a run: a `Picked old tests (N):` block lists the selected old picks with priority and OLD label after picking and before the tester executes, and a `Planner added N new test(s) [style=…] for <url>:` block fires after each planning round, before the new tests are run. End-of-run results table now sorts by execution time and gains an `Origin` column (OLD/NEW) when reuse was used.
- [Pilot] Provenance check tightened: the entity cited as proof of a create/edit scenario must appear by name in `<notes>` or `<session_log>` tool inputs for THIS run. A record matching the goal by text alone but missing from the session is treated as a stale leftover and the verdict is `fail`. Same when no `fillField`/`type`/`select`/`click` on a target ran.
- [Tester] When creating, editing, or deleting a named entity, the AI is now instructed to include the entity's identifier verbatim in `record({ notes: [...] })` — Pilot uses these notes to confirm provenance.
- Plan file parser: priority is now read correctly from multi-line `<!-- test \n priority: X \n -->` blocks (the format the saver actually writes). Previously every test loaded from a saved plan defaulted to `normal` priority because the parser only looked for `priority:` on the same line as the opening `<!-- test`.

## 2026-05-07

### Configuration
- **`ai.agents.tester.progressCheckInterval`** — How often (in iterations) the Pilot reviews tester progress. Default lowered from `5` to `3`, so stuck patterns are caught sooner.

### Changes
- [Reporter] Tests now end with a dedicated **Verification** step that bundles the Pilot's verdict line, the final URL, the final screenshot, and any A11Y / UX findings. Previously these were spliced into mid-test notes, making it hard to tell the verdict from incidental observations.
- [Reporter] Navigation notes now read `Navigated to <page title>` (falling back to `h1`/`h2` when the title hasn't changed) with the URL placed in the step log, so report rows are scannable instead of long URL strings.
- [Reporter] Testomat.io runs are now created with `configuration.exploratory = true` so they're tagged as exploratory in the dashboard.
- [Tester] System prompt and initial scenario block are now sent with Anthropic prompt-caching markers. The Usage panel in the TUI shows `(N cached, X%)` next to each model's token count so cache hit rate is visible at a glance.
- [Tester] When the tester returns to a URL whose UI map was already produced earlier in the session, the research call is skipped and a one-line reminder is injected instead — saves tokens and time on multi-page scenarios.
- [Pilot] When data the test needs to act on cannot be created automatically (Fisherman unavailable or precondition failed), the Pilot now uses the vision model to check whether the current page exposes a way to create that data. If it doesn't, the scenario is **skipped** with an explanation instead of being recorded as a failure.
- [Pilot] `requestVerification` on a `pass` verdict is now an English claim about the page (e.g. `New test suite "Foo" is visible in the suites list`), not CodeceptJS code. The Navigator translates the claim into assertions before they're baked into the generated spec.
- [Pilot] Recent-action history sent to the Pilot is now capped at 25 lines per page group; older lines are summarised as `[...N earlier action(s) omitted...]` so very long sessions no longer blow up the supervisor prompt.
- [Analyst] Session report rewritten: now feature-focused with `Coverage`, `What works`, `Defects`, `UX issues`, `Execution Issues` sections. Severity uses plain text tags `[High]` / `[Medium]` / `[Low]` (no emoji). The Analyst now runs on the agentic model.
- [Historian] Generated tests no longer include selectors that contain framework-generated dynamic IDs (`#ember42`, `#__next2`, etc.) — those IDs change every page load and would never match on rerun.
- [Explorer] The explore command now keeps a set of sub-pages whose exploration failed and skips them on subsequent picks, and stops after at most 30 sub-page attempts. Previously it could loop indefinitely on a candidate that kept failing.
- Experience Tracker: Skips writing actions and flows whose code uses dynamic framework IDs or `I.clickXY(...)` — captured experience is now restricted to selectors that have a chance of replaying.
- AI tools (`see`, `context`, `research`): tool outputs are now capped (4 KB ARIA, 6 KB HTML, 2 KB analysis, 4 KB research) with a `[...truncated; N chars omitted...]` marker. Stops large pages from eating the tester's context budget.
- AI tool feedback: When a click/action returns success but the URL, ARIA, and HTML are all unchanged, the tester is now told the locator likely matched a non-interactive ancestor and is instructed to re-locate (`xpathCheck`) or visually verify (`see`) before treating the call as a real success.
- I.* commands: The `faker` library (from `@faker-js/faker`) is now available inside `I.*` calls for generating test data, e.g. `I.fillField('Bio', faker.lorem.paragraphs(5))`.

## 2026-05-06

### Configuration
- **`reporter.markdown`** — Write a plain-text markdown report alongside the HTML report. Output goes to `output/reports/<mode>-<sessionName>-tests.md` (for example `explore-WiseFox42-tests.md`). Easy to paste into a PR description, chat thread, or CI summary. Default: `false` (opt-in).
- **`reporter.runGroup`** — Group successive Testomat.io runs under one heading. Default: `Explorbot YYYY-MM-DD` (today's date), so all sessions from one day appear together in the dashboard. Set to a string to override (e.g. `'Smoke Suite'`), or `null` to disable grouping. `TESTOMATIO_RUNGROUP_TITLE` from the environment, if set, takes precedence.

### Changes
- [Reporter] HTML reports are now written to a session-scoped filename (`<mode>-<sessionName>.html`, e.g. `explore-WiseFox42.html`) so successive runs no longer overwrite each other in `output/reports/`.
- [Tester] When a modal, dialog, or overlay is open above the page, the AI is told to scope all clicks, types, and locator lookups to elements inside it. Page navigation, filters, and tabs that share names with elements inside the overlay are no longer treated as actionable while it's open.
- URL matcher: Knowledge file URL patterns without a `?` now match the path even when the visited URL carries a query string. For example, the pattern `/login` now matches `/login?next=/dashboard`. Patterns that include `?` still match against the full URL with query.

## 2026-05-04

### Configuration
- **`ai.agents.analyst`** — Configures the end-of-session analyst that summarises a finished exploration into a markdown report. Set `enabled: false` to skip the report. Default: enabled.

### Changes
- **Session analysis report.** When an exploration finishes (and on TUI exit) Explorbot now prints a markdown summary clustered by root cause, with severity emoji for defects, a UX issues section, and an execution-issues section that explains in plain English why a verdict was unreliable. The same report is saved to `output/reports/<mode>-<session>.md` and, when Testomatio reporting is on, attached as the run description through the Testomatio reporter API.
- [Pilot] When a `pass` verdict has a verification assertion attached and the DOM check fails, the Pilot now asks the vision model whether the screenshot confirms the assertion. If neither the DOM nor the screenshot confirm it, the test is marked failed instead of silently continuing as before.
- [Pilot] Now told to pick verification assertions the DOM can actually express. For content the DOM can't reach (iframe text, canvas, custom widgets, Monaco/CodeMirror editors) it must target a stable landmark — the wrapping container, an ARIA role, the parent element — rather than literal text inside the widget.
- [Pilot] New-page reviews now include the last few successful tool calls so the Pilot's first reaction to a freshly loaded page is grounded in what the tester just did.
- [Researcher] Iframes are no longer treated as sections of a page. Each iframe is listed as a single row of type `iframe` inside the section that contains it, never used as a section's own container selector.
- [Captain] Dropped the always-on hint suggesting the user run `/research` after every command.
- [Navigator] Rules around `I.fillField` no longer enumerate specific editor frameworks. The guidance is now: `I.fillField` works for plain inputs, textareas, contenteditable, and rich/code editors transparently; if it doesn't, fall back to `I.type` into the focused element.
- Action: Failed CodeceptJS attempts no longer call the error's `fetchDetails()` callback before being reported. Errors propagate immediately, removing a hidden retry round-trip on every failure.
- Suggested-commands footer: Suggestions are now rendered as a column-aligned two-column block (`/command   description`) instead of stacked dim+yellow lines, so multi-suggestion blocks fit on far fewer terminal rows.
- ARIA diff output: The `removed:` section now lists each removed element by name, the same way `added:` does, with the top 10 entries shown and any overflow summarised as `+ N more interactive elements`. Previously the diff just printed a count like `removed: 2 interactive elements`, which hid which controls vanished.

## 2026-04-29

### Configuration
- **`ai.agents.historian.screencast`** — Record a `.webm` screencast for every scenario the Historian saves. Set to `true` for defaults, or pass `{ size: { width, height }, quality }` to control resolution and encoding quality. Default: `false`.

### Changes
- [Historian] Records a screencast per scenario when `historian.screencast` is enabled. Videos are saved to `output/screencasts/<plan>-<n>-<scenario>.webm` with chapter markers that show the AI's per-step explanation as the run plays back. The end-of-run output lists the screencast files alongside generated tests so users can open them directly.
- [Reporter] Test entries now carry the real wall-clock duration (`time`) and per-note durations instead of always reporting `0`. Testomat.io runs and JSON reports show actual timings.
- Long plan, scenario, or state names no longer crash file writes. Generated test files, screencasts, and state captures are now truncated with a stable hash suffix (`my_very_long_title_a1b2c3d4.spec.ts`) so they always fit within filesystem name limits.
- Playwright upgraded to 1.59. The `ariaSnapshot({ forAI: true })` call has been replaced with `ariaSnapshot({ mode: 'ai' })` to match the new API.

## 2026-04-26

### Changes
- **Generates Playwright tests.** Every run is now saved as a runnable test — Playwright (`.spec.ts`) or CodeceptJS (`.js`). Set `ai.agents.historian.framework: 'playwright'` to get Playwright output. The spec uses the actual `page.locator(...)` calls executed during the run, each action wrapped in `test.step`, with `expect(...)` assertions for what the Pilot verified. Run it with `npx playwright test`. See [Automated Tests](docs/guides/automated-tests.md).
- [Historian] Each step in the generated test is wrapped in `await test.step('<explanation>', …)` (or `Section('<explanation>')` for CodeceptJS), labelled with the AI's own description.
- [Historian] `test.beforeEach` / `Before` calls `goto(startUrl)` and replays the `wait` / `waitForElement` knowledge declared for that URL.
- [Historian] Failed scenarios become `test.skip(...)` / `Scenario.skip(...)` with a `// FAILED:` comment; unfinished ones become `test.fixme(...)` / `Scenario.todo(...)` stubs. The file always runs.
- [Historian] Duplicate `expect(...)` assertions are dropped when the Pilot re-verifies the same condition.
- [Provider] AI request timeout no longer fires while Explorbot is paused on user input (e.g. `askUser`). The 30 s timer pauses while the controller reports awaiting input and resumes after the user replies.
- [Tester] Tests that have already finished ignore late state changes, tool calls, and Pilot reviews, so the final report no longer collects post-verdict notes.
- [Pilot] Verification failures and reset allow/veto decisions are logged at substep level instead of being added to test notes.
- Next-step suggestions: every command (`plan`, `explore`, `learn`, `/plan:save`, `/add-rule`) closes with a consistent labeled block listing the artifact path and `re-run` / `run all` / `run range` / `reload` commands. Paths are printed relative to the working directory.
- Telemetry: each test run is wrapped in a single root span so all tool calls, Pilot reviews, and Historian writes group under one Langfuse trace.

## 2026-04-24

### New CLI Options
- **`explorbot clean tests`** — Added a `tests` target that wipes the generated test files under `output/tests/` without touching experience or state caches.
  ```bash
  explorbot clean tests
  ```
- **`EXPLORBOT_NO_BANNER`** — Environment variable that suppresses the `⛵ Explorbot v…` banner printed before every command. Useful when piping CLI output into another process.
  ```bash
  EXPLORBOT_NO_BANNER=1 explorbot plan /login
  ```

### New TUI Commands
- **`/clean tests`** — Inside the TUI, clean the generated test directory without touching other artifacts.
  ```
  /clean tests
  ```

### Configuration
- **`ai.agents.historian.framework`** — Selects the output format for generated test files. Set to `'playwright'` to emit real `@playwright/test` `.spec.ts` files (with `test.describe`, `test.beforeEach`, `expect()` assertions) recorded from actual Playwright calls at runtime. Default: `'codeceptjs'`.

### Changes
- **`explorbot rerun`** — Running rerun on a Playwright spec (`.spec.ts` / `.spec.js`) now exits with a clear message pointing at `npx playwright test <file>` instead of attempting to execute the file through the CodeceptJS rerunner.
- [Historian] Generated scenarios can now be emitted as Playwright tests. When `historian.framework` is `'playwright'`, each test run records real Playwright method calls (clicks, fills, presses, navigations) through the browser's tracing API and renders them as native `page.locator(...).click()` / `expect(page)...` code, instead of translating CodeceptJS steps.
- [Historian] Experience files are no longer written for failed or skipped tests. Previously every run appended steps regardless of outcome, which polluted pages with broken recipes.
- [Historian] Flow recipes are now written through an AI curation pass that drops noise steps, negative/error-verifying scenarios, and duplicates of recipes already present for the same page. Previously every session's steps were saved after a per-step usefulness filter.
- [Pilot] When deciding `pass`, the Pilot must now propose a concrete CodeceptJS assertion that proves the scenario goal. The system runs the assertion, refuses to pass if it does not match the page, and bakes the resulting `expect(...)` straight into the generated Playwright spec so generated tests always ship with real verifications.
- [Pilot] Now reviews every `reset()` call from the tester. The Pilot can veto resets that would wastefully restart after a flow already succeeded (creating duplicates) and can fail the test outright when it detects a reset loop (same failure mode after two resets). The `reset` tool description itself now warns the AI that reset is destructive and a last resort.
- [Pilot] Added detection for UI-thrashing: consecutive successful actions that only toggle layout/filters/tabs without advancing the scenario's data now trigger guidance to move toward the actual mutation or verification.
- [Navigator] Dismisses unexpected popups automatically when a click is intercepted or an element becomes unexpectedly hidden/disabled. Tries clicking outside the dialog, pressing Escape, and Cancel/Close buttons before giving up.
- [Navigator] When every proposed code block fails, Navigator now loops once more with all failures fed back to the model (and full HTML on the retry), instead of stopping after the first unsuccessful batch. Successful navigation now waits for the load state and URL transition before declaring success, which removes false positives on slow apps.
- [Navigator] Saves successful multi-step navigations as `## FLOW:` recipes in the experience file (e.g. "reach /settings/billing from /settings"), with `I.amOnPage` lines stripped, so they can be reused by later runs.
- [Navigator] Added output rules that forbid appending `I.amOnPage` after a form submission (it cancels the in-flight navigation), forbid `:has-text(...)` inside `seeElement`/`dontSeeElement` locators, and forbid emitting the same assertion in two different shapes (`I.see(text, locator)` + `seeElement(locator:has-text(text))`).
- [Navigator] Replaced the "use `I.type` for Monaco/rich text editors" guidance with the opposite rule: `I.fillField` handles plain inputs, textareas, contenteditable, and rich/code editors (Monaco, ProseMirror, CodeMirror, TipTap, Quill, Draft, Slate) transparently. `I.type` is reserved for cases with no locator at all.
- [Researcher] Loading pages are now detected and waited for instead of being classified as errors. If an ARIA progressbar/`[busy]` is visible, or the heading mentions "loading", or the body is tiny, the researcher waits up to the configured timeout (retrying up to 3 extra seconds) before continuing with a best-effort snapshot. Only real HTTP error titles (404, 500, …) still throw `ErrorPageError`.
- [Planner] When a run was started with a focus area (`--focus`/trailing positional arg), subsequent planning rounds now stay inside that feature and generate more scenarios for it, instead of switching to whichever unrelated feature had the least coverage.
- [Tester] Reset, finish, and completion reviews now run the Pilot's follow-up assertion against the page before committing the verdict, so a `pass` verdict always has an assertion attached to the generated test.
- Experience Tracker: `## FLOW` recipes are now supplied pre-formatted by the caller (Historian, Navigator). Duplicate flow bodies are skipped on write, so repeated runs no longer append identical recipes.
- State/context size: tool results stored in the conversation are now progressively compacted — older tool results drop their `htmlParts` diff, trim their ARIA diff, and remove iframe HTML, keeping only the last few raw. Large sibling runs (>50 elements of the same role) in the ARIA snapshot are collapsed to 5-at-each-side with a "N similar items omitted" placeholder, and diff html parts are capped per part and collapsed when the whole diff exceeds the budget.
- Browser: Default Playwright action timeout raised from 1 s to 3 s, reducing spurious timeouts on mid-speed apps.
- AI Provider: When a model returns an empty response because output was truncated at `maxTokens`, the provider now raises a clear context-length error naming the fix ("Increase maxTokens or use a model with higher output capacity") instead of silently returning nothing.

## 2026-04-21

### Changes
- Reporter: Testomatio run titles now describe the session instead of being empty — e.g. `Explorbot session https://app.example.com/settings focus: "billing" at 2026-04-21T09:15`. Override with the `TESTOMATIO_TITLE` env var.
- [ExploreCommand] When a planning style fails mid-run, explore now re-visits the starting page and retries the planner once before skipping that style. If the failure is an error page (404/500) exploration stops immediately instead of retrying against a broken page.
- [Researcher] When a page resolves to an error page that cannot be recovered, the researcher throws `ErrorPageError` so callers (explore, plan) halt instead of silently continuing on a dead page.
- [Researcher] If a single section (sidebar, form, header, etc.) fails during multi-section research, the researcher logs a warning and continues with the remaining sections instead of failing the whole page.
- [Historian] Generated CodeceptJS scenarios and recorded experience no longer include `I.clickXY(x, y)` steps. Coordinate clicks are not reusable across runs, so they're dropped when persisting the session.
- Fixed a crash at the start of every test (`requestStore?.onFailedRequest is not a function`) introduced by the prior release; the tester's failed-network-request listener now attaches correctly.

## 2026-04-20

### Changes
- [Planner] No longer proposes scenarios that delete, remove, or archive data the test did not itself create. Destructive scenarios must now create a disposable target first and then act on that target. The resource represented by the current page URL is treated as "under test" and is never proposed for deletion — preventing cascades where deleting the focal item breaks every later scenario that starts on the same URL.
- [Tester] Honors the same data-protection rule at execution time: refuses to delete pre-existing items and never destroys the resource owned by the current URL, in addition to the existing session-name allowlist.

## 2026-04-18

### New CLI Options
- **`explorbot compact [target]`** — Compact stored experience files. With no target, sweeps all files (merging similar URLs first, then compacting). Pass a filename or URL substring to narrow the scope. Large files run through the AI compactor; recent files get a quality-review pass that drops low-value sections.
  ```bash
  explorbot compact                                 # full sweep (merge + compact)
  explorbot compact /login                          # only files for URLs matching /login
  explorbot compact abc123.md                       # one specific file
  explorbot compact --dry-run                       # preview without running AI or writing
  explorbot compact --no-merge                      # skip the cross-URL merge step
  ```
- **`explorbot experience [filter] [index]`** — List stored experiences grouped by URL, with a short tag per file (A, B, …) and a numbered section list. Pass a URL substring to filter, or a tag like `A1` to print that section's content. Add `--recent`/`--old` to restrict to files modified within / older than 30 days.
  ```bash
  explorbot experience                              # list everything
  explorbot experience /login                       # only URLs matching /login
  explorbot experience A1                           # print section 1 of file A
  explorbot experience --recent                     # only files modified in the last 30 days
  explorbot experience --old                        # only files older than 30 days
  ```
- **`explorbot explore --focus <feature>`** — Pass a focus area up-front instead of relying on the trailing positional argument. When set, explore skips the follow-up auto-planning loop and only runs the focused plan.
  ```bash
  explorbot explore --focus checkout                # focused run only
  ```

### New TUI Commands
- **`/compact [target]`** — Same behavior as the CLI command, inside the TUI.
  ```
  /compact
  /compact /login
  /compact --dry-run
  /compact --no-merge
  ```
- **`/experience [filter] [index]`** — List or expand stored experiences inside the TUI.
  ```
  /experience
  /experience /login
  /experience A1
  /experience --recent
  ```

### Changes
- Suggested next-step output from every command is now rendered as a clearly labeled `Suggested:` block, with each item shown on its own line prefixed by `/` (TUI) or `explorbot ` (CLI). Replaces the previous one-line-per-suggestion hint format.
- [Tester] Console errors and failed network requests (HTTP 4xx/5xx responses to XHR/fetch) are now captured automatically during a test run and attached as failure notes on the task. Previously these were not surfaced.
- [Pilot] The stuck-check briefing the pilot receives now includes a count and sample of console errors and recent failed network requests, so the pilot can reason about backend/JS failures when deciding whether to reset, retry, or stop.
- Experience Tracker: Experience files now use `## FLOW: <title>` for multi-step recipes and `## ACTION: <title>` for single-step snippets. Titles are normalized to lowercase-first imperative phrases. When read for AI prompts, sections are rendered as `## HOW to <title> (multi-step|single-step)` so the model sees natural instructional phrasing. Previous formats (`SUCCEEDED:` / `Successful Flow:`) are no longer written.
- Experience Tracker: New table-of-contents API lets callers list stored experience grouped by file tag and expand any section by tag + index, without having to read raw files.
- Experience Compactor: The compaction flow now runs three passes — strip non-useful sections (empty, dynamic-locator, verification-only titles), AI quality review for files modified within the last 30 days, and AI compaction for anything still over the size threshold. Cross-URL merging across similar URLs is part of the default full sweep and can be skipped with `--no-merge`. Progress is logged per file.

## 2026-04-17

### Configuration
- **`ai.agents.researcher.focusSections`** — List of CSS selectors that narrow research to a specific element when present on the page. If any selector matches, the researcher maps only that element instead of the whole page — useful for apps that open a focused panel (modal, drawer, detail view) on top of the main layout.
  ```javascript
  ai: {
    agents: {
      researcher: {
        focusSections: ['[role="dialog"]', '.drawer-open', '#focused-panel'],
      },
    },
  }
  ```

### Changes
- [Tester] Detects modals and dialogs that appear mid-test and extends the page UI map with their controls — including overlays that don't expose `role="dialog"` (a "Close X" button is enough to recognize them), so the next tool call has selectors for the overlay.
- [Researcher] New overlay analysis appends a section for each newly opened dialog/modal under the page's "Extended Research" heading and caches the result, so revisiting the same page skips the work.
- ExploreCommand: The "Generated:" hints printed at the end of an explore session now list only the test files written during this run, not every file already sitting in `output/tests/`.
- [Researcher] When the model's response gets truncated by context limits, the researcher now retries by splitting research into one request per section (focus, main, sidebar, etc.) and merging the results, instead of a single focused-retry prompt.
- [Researcher] Honors the new `focusSections` config — if any configured CSS selector is present on the page, the researcher limits its UI map to that element rather than the full page.
- [Tester] Past experience is no longer inlined into every tester turn. Instead, a compact table of contents (file tags plus section headings) is injected, and the agent fetches specific sections on demand via the new `learn_experience` tool. Cuts tester token usage on pages with accumulated experience.
- [Pilot] Receives the same experience table of contents when tools are enabled and can pull full sections via `learn_experience`.
- [Captain] The interactive web mode now exposes the `learn_experience` tool alongside `see`, `context`, and `visualClick`, so TUI-driven sessions can read past experience on demand.
- [Planner] Rewrote the `normal`, `curious`, and `psycho` planning styles to rank scenarios by outcome strength: **data change > state change > UI-only**. Normal style now asks for complete commit flows over "form appears" checks, curious style treats an untested control as covered only when the scenario built around it reaches a data or state change (and refuses to merge a variation with a dismissal ending), and psycho style now attacks every reachable control in the same scenario with a different strange value instead of isolating one control per scenario.
- Experience Tracker: New `getExperienceTableOfContents` / `getExperienceSection` API backs the TOC-based experience flow; sections are addressed by a short file tag (A, B, ...) and a 1-based section index.

## 2026-04-15

### CLI Changes
- Removed redundant aliases: `sail`, `add-knowledge`, `bosun`, `rules:add`. Use `start`, `learn`, `drill`, `add-rule` instead (both on the CLI and inside the TUI).
- **Replaced `extract-styles` with `extract-rules <agent>`** — extracts the full built-in rules tree for an agent, including any planning styles under the `styles/` subdirectory, into `./rules/<agent>/`. Styles are just rules in a subdirectory, so there is now a single extraction command.
  ```bash
  explorbot extract-rules planner              # extracts rules + styles to ./rules/planner/
  explorbot extract-rules planner -d ./my-rules # custom target directory
  ```
- The `explore` command description no longer labels it as "legacy command".

### TUI
- Task pane can now be scrolled with **Ctrl+Up / Ctrl+Down** from anywhere, including while the input prompt is active.
- `/test N` and `explorbot test N` now refer to the test's displayed index in the task pane (counted over all enabled tests, including finished ones), so `/test 1` always runs the test labeled "1." regardless of which tests have already completed.

### Changes
- [Planner] `explorbot plan` now prints a summary of already-implemented automated tests for the target URL and the new scenarios it generated, each with priority. Suggested next-step commands include `rerun` entries pointing at the existing test files so users can re-run automated coverage alongside running new tests.
- [Planner] Existing automated tests for the current URL are now passed to the AI as an explicit `<existing_automated_tests>` block, so newly generated scenarios no longer duplicate tests that are already implemented.
- [Planner] Automated test discovery now uses `@codeceptjs/reflection` to parse test files and match them to the current URL via the `Before` hook's `I.amOnPage(...)`, replacing the previous directory-wide scenario scan.
- [Planner] Re-running `/plan` now preserves the displayed indices of existing tests. Previously, finished tests were moved to the end of the list and newly generated scenarios took over their numbers; tests now keep their original position and new ones are appended.
- [Navigator] Added strict navigation constraints: must stay on the same origin, must never rewrite or spoof the URL via `executeScript`/history API/location tricks, and must treat redirects to `/login`, `/sign_in`, `/auth`, etc. as an authentication requirement — logging in with credentials from knowledge or asking the user — rather than an obstacle to bypass.
- [Tester] The `form` tool now suggests `I.pressKey("Enter")` as an alternative submission path when a plain `click()` would otherwise be used.
- [Rerunner] Automatically loads the Testomatio CodeceptJS reporter plugin during rerun sessions, so rerun results are reported to Testomatio when configured. Bash tool execution logs now include the trace directory for easier debugging.

## 2026-04-13

### New CLI Commands
- **`explorbot runs [file]`** — List generated test files or preview steps for a specific file.
  ```bash
  explorbot runs                                    # list all test files
  explorbot runs output/tests/suite.js              # preview steps without executing
  ```
- **`explorbot rerun <file> [index]`** — Re-run generated tests with AI-powered auto-healing. When a step fails, the Rerunner agent diagnoses the issue and fixes it.
  ```bash
  explorbot rerun output/tests/suite.js             # run all tests in file
  explorbot rerun output/tests/suite.js 3           # run test #3 only
  explorbot rerun output/tests/suite.js 1-5         # run tests 1 through 5
  explorbot rerun output/tests/suite.js 1,3,7       # run specific tests
  ```

### New TUI Commands
- **`/runs [file]`** — List generated test files or preview steps for a specific file.
  ```
  /runs
  /runs output/tests/suite.js
  ```
- **`/rerun <file> [index]`** — Re-run generated tests with AI auto-healing inside the TUI session.
  ```
  /rerun output/tests/suite.js
  /rerun output/tests/suite.js 3
  /rerun output/tests/suite.js 1-5
  ```

### Configuration
- **`ai.agents.rerunner`** — Configure the Rerunner agent. Available options: `healLimit` (max heal attempts), `ariaSnapshotLimit`, `recipes` (custom heal recipes). Default: built-in defaults.

### Changes
- [Rerunner] New agent that re-runs generated test files, detects failures, and auto-heals broken steps using AI
- [Planner] Now detects scenarios that already exist in generated test files and skips them — avoids duplicating tests across planning sessions
- [Pilot] Smarter precondition handling — skips creating test data when the scenario itself creates items or when data already exists on the page
- [Historian] Generated test files now include knowledge-based setup (wait times, waitForElement) in the Before hook
- [Historian] Can rewrite test files with healed steps from the Rerunner
- After exploration finishes, generated test file paths and rerun commands are printed

## 2026-04-09

### New CLI Options
- **`--focus <feature>`** — Focus test planning on a specific feature. Replaces the positional `[feature]` argument on the `plan` command.
  ```bash
  explorbot plan /login --focus authentication
  explorbot plan /dashboard --focus "user profile"
  ```

### New TUI Commands
- **`/plan --focus <feature>`** — Focus test planning on a specific feature area.
  ```
  /plan --focus authentication
  /plan --focus "form validation"
  ```

### Configuration
- **`dynamicPageRegex`** — Custom regex to identify dynamic URL segments (e.g., IDs) in your application. When set, URLs matching this pattern are treated as template parameters during plan deduplication. Default: none (built-in patterns for numeric IDs, UUIDs, ULIDs, and hex IDs are always active).

### Changes
- [Planner] Pages with similar content are now detected and skipped during planning, even when URLs differ — prevents duplicate plans for pages like `/users/123` and `/users/456`
- [Planner] Dynamic URL segment detection expanded to recognize UUIDs, ULIDs, hex IDs, and short mixed alphanumeric segments
- [Researcher] Element annotation now uses ARIA snapshot refs (`e3`, `e15`) instead of numeric indices for more stable element tracking
- [Tester] Form tool now auto-recovers when a command accidentally navigates into an iframe — switches back to the main frame automatically

## 2026-04-07

### Configuration
- **`web.url`** — Simplified way to set the application URL. Replaces `playwright.url` for common use cases. Explorbot resolves `web.url` to `playwright.url` automatically. Default: none.
- **`api.bootstrap`** — Async hook function called before API tests start. Receives `{ headers, baseEndpoint }` context, can return updated headers. Default: none.
- **`api.teardown`** — Async hook function called after API tests finish. Receives same context as bootstrap. Default: none.

### Changes
- [Planner] Duplicate scenario prevention improved — all existing test titles are now listed explicitly when expanding plans
- [Curler] `verifyStructure` tool now returns the actual response shape on success, helping write correct `verifyData` assertions
- [Curler] `verifyData` tool now uses `response` variable instead of `data` for clarity — `response` is the full parsed JSON body
- API tester now falls back to `explorbot.config.*` files when no `apibot.config.*` is found, allowing a single shared config

## 2026-04-06

### New CLI Commands
- **`explorbot learn [url] [description]`** — Add domain knowledge for URLs. Replaces `knows:add`.
  ```bash
  explorbot learn                                    # interactive mode
  explorbot learn /login "Use admin credentials"     # add directly
  ```
- **`explorbot clean [target]`** — Clean specific file categories instead of generic `--type` flag. Available targets: `states`, `research`, `plans`, `experiences`, `output`. Without a target, cleans `output` and `experiences`.
  ```bash
  explorbot clean                  # clean output + experiences (default)
  explorbot clean states           # clean page state files only
  explorbot clean research         # clean research cache only
  explorbot clean plans            # clean test plans only
  ```

### New TUI Commands
- **`/learn [note]`** — Add knowledge for the current page. Replaces `/know`. Without arguments, opens interactive form.
  ```
  /learn
  /learn Test user: test@example.com
  ```
- **`/clean [target]`** — Clean files by category. Supports same targets as CLI: `states`, `research`, `plans`, `experiences`, `output`.
  ```
  /clean
  /clean research
  ```

### Changes
- Knowledge files now support variable interpolation: `${env.VARNAME}` for environment variables and `${config.path}` for values from `explorbot.config.js`. This keeps secrets out of knowledge files.
- Page state files (HTML, ARIA, screenshots, logs) are now stored in `output/states/` subdirectory instead of directly in `output/`.
- Dead loop detection is now more sensitive — detects repeated navigation patterns earlier.
- [Researcher] Research summary now separates main and extended research sections, and hides empty sections.
- npm publish workflow added for automated package releases on version tags.

## 2026-04-02

### Configuration
- **`api.baseEndpoint`** — Base URL for API requests used by the Fisherman agent. Default: same as `playwright.url`.
- **`api.spec`** — Array of OpenAPI spec file paths or URLs. Fisherman uses these to learn request formats before making API calls.
- **`api.headers`** — Custom headers to include in all API requests (e.g., API keys, auth tokens).
- **`ai.agents.fisherman`** — Configuration for the Fisherman agent. Set `enabled: true` to activate without full API config.

### Changes
- [Fisherman] New agent that prepares test data via API requests before tests run. Automatically discovers endpoints from captured XHR traffic or OpenAPI specs, authenticates using browser cookies, and creates items needed by test scenarios.
- [Pilot] Now calls `precondition()` before each test to declare what data must exist. When Fisherman is available, data is created automatically via API; otherwise preconditions are noted for manual setup.
- [Captain] Completes commands faster — after a successful action, if the page diff confirms the goal, finishes immediately instead of running extra verification steps.
- [Navigator] Rules for output format, multiple locators, and verification actions moved from inline code to external markdown rule files under `rules/navigator/`.
- [Researcher] Rules for UI map tables, section maps, screenshot maps, and list element indexing moved to external rule files under `rules/researcher/`.
- [Planner] When a feature focus is specified, all proposed scenarios must relate directly to it. Feature directive is now injected into the system message for stronger adherence.
- [Explorer] Automatically captures XHR/fetch write requests (POST, PUT, PATCH, DELETE) from the browser. Captured requests are saved to `output/requests/` and used by Fisherman to discover API endpoints and auth headers.
- Explore command now saves multi-plan output correctly — each sub-page plan is preserved as a separate suite in the saved markdown file, and results table shows which plan each test belongs to.
- TUI autocomplete redesigned — now shows descriptions alongside commands, displays argument hints after typing a command, supports fuzzy/substring matching, and uses cursor-aware replacement instead of replacing the full input line.
- TUI input now supports Ctrl+A/E (home/end of line), Ctrl+W (delete word back), Ctrl+U/K (delete to line start/end), Ctrl+Delete (delete word forward), and Escape to dismiss autocomplete.

## 2026-03-31

### New CLI Commands
- **`explorbot plan:load <planfile> [index]`** — Display a saved plan file as a table, or view details of a specific test by index.
  ```bash
  explorbot plan:load plan.md            # show all tests in table
  explorbot plan:load plan.md 3          # show details for test #3
  ```
- **`explorbot shell <url> <command>`** — Navigate to a URL, execute a single CodeceptJS command, and exit. Useful for quick one-off browser interactions.
  ```bash
  explorbot shell /login "I.see('Welcome')"
  explorbot shell /dashboard "I.click('Settings')"
  ```

### New TUI Commands
- **`page.*` commands** — Execute raw Playwright page commands directly in TUI alongside existing `I.*` commands.
  ```
  page.click('.my-button')
  page.fill('#email', 'test@example.com')
  await page.locator('.item').count()
  ```

### Configuration
- **`ai.agents.researcher.errorPageTimeout`** — Seconds to wait for an error page to recover before giving up. Researcher retries with exponential backoff during this window. Default: `10`. Set to `0` to disable.
- **`reporter.html`** — Force HTML report generation even when Testomatio is configured. When set, reports are generated to both Testomatio and local HTML. Default: `false`.

### Changes
- [Researcher] Error pages now trigger a retry with exponential backoff instead of immediately returning an error — pages that load slowly or redirect are given time to recover
- [Researcher] Cached research results are now clearly marked as potentially stale, prompting refresh when issues are noticed
- [Researcher] UI map now requires every element with an `eidx` attribute to be included, even icon-only elements without text
- [Researcher] Sections can no longer be named "Focus" or "Focused" — they must describe their content (e.g., "Detail", "Modal", "Form")
- [Researcher] New "Focused section" detection — automatically identifies the user's primary interaction area (dialogs, main content) using AI declaration, ARIA analysis, and visual fallback. Focused sections are marked in research output.
- [Researcher] Deep analysis prioritizes expandable elements from the focused section and deduplicates expanded sections with the same container
- [Researcher] Deep analysis skips hover probing for coordinate-based clicks where hover would miss the target
- [Pilot] Verdict review now provides concrete guidance when requesting continuation — tells Tester exactly what to verify, retry, or complete next
- [Pilot] Session log now includes executed code, targeted element HTML, and skipped fallback attempts for each action — enabling detection of wrong-element clicks
- [Pilot] New detection rules for logically wrong successes: mismatched executed vs intended commands, text sent to wrong elements, and unrelated ARIA changes after actions
- [Pilot] Navigation awareness — compares current URL to start URL and flags suspicious outer-page or outer-site navigation
- [Pilot] Already-achieved state detection — recognizes when the scenario goal is already met and adapts instead of repeating the same action
- [Pilot] Complex component guidance — instructs Tester on search-and-select dropdown sequences and generic trigger mismatches
- [Pilot] Removed standalone verification via Navigator — continuation guidance now directs Tester to verify within the test flow
- [Planner] Focused research sections are highlighted to concentrate test generation on the user's primary interaction area first
- [Planner] Previously tested flows are now presented with discovery annotations, and curious style avoids re-proposing covered flows
- [Planner] Normal style now considers re-testing important previously tested flows for regression coverage with input variations
- [Tester] Click tool now enforces that all commands in the fallback array target the same element — mixing different elements in one click call is rejected
- [Tester] File paths in `<available_files>` are now relative to the project directory instead of absolute
- [Tester] Removed standalone final review — all test verdicts now go through Pilot
- [Tester] Major page changes (50+ ARIA elements added/removed) trigger a suggestion to check iframe content and HTML parts
- Click disambiguation now tries `elementIndex` option first before falling back to XPath, improving reliability with framework-rendered lists
- Explore command now shows test index numbers and source plan names in the results table, and prints the saved plan path with a re-run command
- Plan file loading improved — searches current directory before falling back to plans directory, and auto-appends `.md` extension
- [Explorer] Playwright `page.*` commands are now supported in the action executor alongside CodeceptJS `I.*` commands
- [Explorer] CodeceptJS steps and store listeners are now properly initialized, enabling `step.opts()` for element index selection

## 2026-03-29

### New CLI Options
- **`--max-tests <count>`** — Limit the number of tests to run during exploration or freesail. Stops after the specified count is reached.
  ```bash
  explorbot explore /dashboard --max-tests 5
  explorbot freesail /app --max-tests 10
  ```
- **`-a, --append`** — Add tests to an existing plan file instead of replacing it. Loads the saved plan before generating new scenarios.
  ```bash
  explorbot plan /login -a
  explorbot plan /login --append
  ```

### New CLI Commands
- **`explorbot extract-styles <agent>`** — Extract built-in planning styles to `rules/<agent>/styles/` for customization. Edit the generated markdown files to change how the Planner generates test scenarios.
  ```bash
  explorbot extract-styles planner              # extracts to rules/planner/styles/
  explorbot extract-styles planner -d ./styles  # custom target directory
  ```
- **`explorbot add-rule [agent] [name]`** — Create a rule file for an agent. Opens an interactive TUI form when called without arguments.
  ```bash
  explorbot add-rule researcher check-tooltips
  explorbot add-rule tester wait-for-toasts --url '/admin/*'
  explorbot add-rule                              # interactive mode
  ```

### New TUI Commands
- **`/rules:add`** (alias: `/add-rule`) — Create a rule file for an agent interactively from TUI.
  ```
  /add-rule researcher check-tooltips
  /rules:add tester slow-forms
  ```
- **`/explore --max-tests <n>`** — Limit the number of tests during exploration.
  ```
  /explore --max-tests 5
  ```
- **`/freesail --max-tests <n>`** — Limit the number of tests during autonomous exploration.
  ```
  /freesail --max-tests 10
  /freesail --deep --max-tests 20
  ```

### Configuration
- **`ai.agents.<name>.rules`** — Load markdown rule files per agent from `rules/<agent>/` directory. Supports URL-pattern matching for page-specific rules. Default: `[]`.
- **`ai.agents.planner.styles`** — Now takes an array of style names (e.g., `['normal', 'curious', 'psycho']`) instead of a key-value map. Styles are loaded from `rules/planner/styles/` as markdown files.
- **`reporter.enabled`** — Enable HTML test reports without requiring Testomatio. Generates reports to `output/reports/`. Default: `false` (enabled automatically when `TESTOMATIO` env var is set).

### Changes
- [Tester] Pilot can now extend test execution up to 2 additional rounds when the initial iteration limit is reached but the test is not yet complete
- [Tester] Tests are stopped after 5 consecutive empty AI responses instead of running until max iterations
- [Pilot] "Skipped" verdict now also covers systematic execution failures (repeated LLM errors, tool crashes unrelated to the scenario)
- [Pilot] Only the last few actions before finish/stop are considered verification evidence — older verify results are ignored
- [Pilot] Test summaries no longer start with "scenario goal achieved/not achieved" — they describe what happened
- [Pilot] Prefers exploring the current page before suggesting navigation to another page
- [Planner] Default style order changed to normal → curious → psycho (curious now runs before psycho)
- [Planner] Tests that create, update, or delete data are prioritized over UI-only interactions (view switching, filtering, pagination)
- [Planner] Experience flows are deduplicated and trimmed before planning — removes empty sections and limits blockquotes per section
- [Planner] `/plan --append` removed from TUI (use CLI `explorbot plan -a` instead)
- [Researcher] Similar pages reuse cached research via HTML fingerprint matching, skipping re-analysis when the page structure hasn't changed
- [Researcher] Error pages are detected early and short-circuited without running the full research pipeline
- [Researcher] Container CSS validation improved — multi-part selectors like `div.static nav` are simplified to their first segment; bare tag selectors are rejected
- [Navigator] Delayed redirects are now detected — waits 1 second and rechecks after initial navigation appears to fail
- [Historian] Test steps are verified by AI before saving to experience — filters out unstable locators, duplicates, and trivial navigation
- [Historian] Generated CodeceptJS code is saved for all test results (not just successful ones)
- [Reporter] HTML reports generated locally when `reporter.enabled` is true, even without a Testomatio account
- [Reporter] Last screenshot is attached to the final test step in reports
- Click and form tools now auto-disambiguate when multiple elements match — uses AI to pick the correct element by XPath
- Planning styles moved from hardcoded code to `rules/planner/styles/` markdown files — extract and edit them with `explorbot extract-styles planner`

## 2026-03-22

### New CLI Commands
- **`explorbot api plan <endpoint>`** — AI-powered API testing. Generate test plans for API endpoints and execute them.
  ```bash
  explorbot api init                          # initialize API testing project
  explorbot api plan /users                   # generate test plan for endpoint
  explorbot api plan /users --style curious   # use a specific planning style
  explorbot api test plan.md                  # run tests from plan
  explorbot api test plan.md 1-3             # run specific tests
  explorbot api know /users "CRUD endpoint"  # add API knowledge
  ```

### New TUI Commands
- **`/debug`** — Toggle debug output on/off during a session.
  ```
  /debug
  ```

### Configuration
- **`ai.model`** — Now accepts Vercel AI SDK model instances directly (e.g., `groq('gpt-oss-20b')`) instead of requiring separate `ai.provider` and `ai.model` string. This enables mixing providers for different agents.
- **`experience.maxReadLines`** — Default increased from `50` to `100`.

### Changes
- [Provider] Simplified configuration — pass model instances directly instead of separate provider function and model string. `ai.provider` is no longer required. Each agent can use a model from a different provider
- [Provider] Multi-level context reduction on overflow — progressively trims tagged content, then compacts middle messages, instead of a single trim attempt
- [Tester] New `back()` tool to navigate to the previous page when accidentally navigated to a wrong page
- [Tester] New `exitIframe()` tool to leave iframe context instead of calling `I.switchTo()` directly
- [Tester] Captain can now interrupt running tests to pass, fail, or skip them via supervisor mode
- [Tester] Click failures now show error-specific suggestions (element not found vs timeout/overlay) and list matched elements when multiple are found
- [Tester] Visual confirmation from `see()` is now valid evidence for test results
- [Tester] `verify()` checks per-assertion duplicates instead of blocking all verifications after the first one
- [Tester] Pilot review triggers after 3 consecutive failures instead of only at fixed iteration intervals
- [Tester] Experience from previous sessions is now included in test execution context
- [Pilot] New "skipped" verdict for tests where the feature does not exist on the page
- [Pilot] Session log now groups actions by URL with page headings for clearer context
- [Pilot] Visual analysis from screenshots is now considered strong evidence for UI state
- [Pilot] Scenario goal takes priority over individual milestones when deciding pass/fail
- [Planner] Automatically discovers and plans tests for related sub-pages after the main page
- [Planner] Scenarios already tested in previous planning rounds are skipped (session deduplication)
- [Planner] Stricter test independence — workflows are never split into multiple tests
- [Researcher] UI map now includes `eidx` column for element index references
- [Researcher] Elements with hover interactions (tooltips, popovers, submenus) are now detected and marked
- [Researcher] Deep analysis filters expandable elements using AI when there are many candidates, and probes elements for hover-triggered UI
- [Historian] Detects retry patterns in test sessions and saves successful resolutions to experience automatically
- [Captain] Refactored with idle mode — includes bash tool, file access, and diagnostic capabilities
- [Explorer] Tests can now be marked as "skipped" with proper event reporting
- TUI: New plan pane shows completed and active plan progress with pass/fail/skip counts
- TUI: Skipped tests shown in yellow with strikethrough in task list
- Rules: `I.moveCursorTo` documented for triggering hover effects (tooltips, dropdown menus, preview cards)
- Rules: Popup dismissal now uses `I.clickXY(0, 0)` instead of `I.click('//body')`

## 2026-03-17

### New CLI Options
- **`--style <style>`** — Set the planning style when generating test plans. Available styles control how aggressively scenarios are invented.
  ```bash
  explorbot plan /login --style curious
  explorbot plan /dashboard --style psycho
  ```

### New CLI Commands
- **`explorbot test <planfile> [index]`** — Run specific tests by index, range, or all. Replaces the old `--all` and `--test` flags with a positional argument.
  ```bash
  explorbot test plan.md 1           # run first test
  explorbot test plan.md 1-3         # run tests 1 to 3
  explorbot test plan.md 1,3,5       # run specific tests
  explorbot test plan.md *           # run all pending tests
  explorbot test plan.md all         # same as *
  ```

### New TUI Commands
- **`/plan --style <style>`** — Set planning style from TUI.
  ```
  /plan --style curious
  /plan authentication --style psycho
  ```
- **`/plan --clear`** — Clear the current plan and immediately create a new one (combines `/plan:clear` + `/plan`).
  ```
  /plan --clear
  /plan --clear authentication
  ```
- **Plan Editor: `Del` key** — Remove a test from the plan in the plan editor (Ctrl+E).

### Configuration
- **`playwright.waitForAction`** — Delay in ms after each Playwright action. Default: `500`.
- **`ai.agents.planner.styles`** — Custom planning styles as a key-value map of style name to approach prompt.

### Changes
- [Planner] Planning now cycles through multiple styles (normal, curious, psycho) during exploration to generate diverse test scenarios
- [Planner] Coverage analysis runs after each planning session, automatically exploring sub-pages with low coverage
- [Pilot] Now actively plans test execution before Tester starts, providing step-by-step guidance
- [Pilot] Reviews new pages during test execution, giving Tester updated guidance when navigating
- [Pilot] Verdict review is now synchronous — Pilot immediately decides pass/fail/continue instead of deferring
- [Pilot] Can request additional verification from Navigator when evidence is insufficient
- [Tester] Removed standalone `type()` and `select()` tools — use `form()` for all text input, dropdown selection, and file uploads
- [Tester] Screenshots are now automatically captured when actions cause page changes (ARIA diff or URL change)
- [Tester] `finish()` now delegates verification entirely to Pilot instead of running its own verify step
- [Researcher] Visual analysis now extracts page purpose and primary actions from annotated screenshots
- [Historian] ARIA diffs are condensed before sending to discovery analysis, reducing token usage
- Vision model failures are now handled gracefully — `see()` and `visualClick()` auto-disable for the session instead of failing repeatedly
- `verify()` prevents duplicate verifications on the same page state
- Context parameter (container) is now the preferred approach for all interaction commands (`I.fillField`, `I.selectOption`, `I.attachFile`)
- New verification commands documented: `I.seeInField()` and `I.dontSeeInField()` for checking input field values
- `.env` file is now automatically loaded from the working directory
- `explorbot plan` CLI now prints a summary with test list and example run commands
- Test duration is tracked and displayed in the exploration results table

## 2026-03-07

### Configuration
- **`files`** — Map of description-to-path entries for custom files to use in file upload tests. Default: `{}`.

### Changes
- [Tester] File upload support — Explorbot can now upload files using `I.attachFile()`. Built-in sample files (PNG, PDF, DOCX, XLSX, ZIP, MP4, MP3) are provided automatically. Custom files can be added via `files` config.
- [Tester] Automatically resets on 404/Not Found pages and records server errors (500, 503) before resetting.
- [Tester] Finish verification now requires assertions to prove that test actions actually changed the page, rejecting verifications of pre-existing state.
- [Pilot] Detects trivial verifications where the asserted state existed before the test started and rejects them.
- [Pilot] Uses `xpathCheck` proactively on first element-not-found failure instead of waiting for repeated failures.
- [Pilot] Verification details now include assertion pass ratio (e.g., "2 of 3 assertions passed").
- [Navigator] Verification now requires majority of assertions to pass (not just one) for multi-assertion checks.
- [Navigator] Assertions are now required to reference the specific item or value being verified, preventing false positives from generic locators.
- Type tool now detects when text was not actually entered (no page change after fillField) and suggests click-then-type fallback.
- Type and pressKey tools now check that an element is focused before attempting input, with clear error messages when nothing is focused.
- TUI task list auto-scrolls to the currently running test.
- Fixed Ctrl/Meta key combinations inserting characters in TUI input.

## 2026-03-06

### New CLI Options
- **`explorbot test <planfile>`** — Execute tests from a saved plan file without launching TUI.
  ```bash
  explorbot test plan.md --all              # run all pending tests
  explorbot test plan.md --test 3           # run test #3 only
  explorbot test plan.md --grep "login"     # run tests matching pattern
  ```

- **`explorbot browser start|stop|status`** — Manage a persistent browser server that survives across explorbot sessions. Commands automatically reuse it instead of launching a new browser each time.
  ```bash
  explorbot browser start --show     # launch visible browser
  explorbot browser start            # launch headless
  explorbot browser stop             # stop the server
  explorbot browser status           # check if running
  ```

### New TUI Commands
- **`/plan --append`** — Add more tests to an existing plan instead of replacing it.
  ```
  /plan --append
  /plan authentication --append
  ```
- **`/plan`** now warns if a plan already exists and suggests `--append`, preventing accidental overwriting.

- **`/plan-edit`** — Edit test plan interactively in TUI (enable/disable tests, reorder).
  ```
  /plan-edit
  ```

### Configuration
- **`ai.agenticModel`** — Model used for agentic tasks (Captain, Pilot verdict review). Falls back to default model. Default: none.
- **`ai.agents.<name>.providerOptions`** — Pass provider-specific options per agent. Default: `{}`.

### Changes
- [Researcher] Refactored into a 5-stage pipeline: Research → Test → AI Fix → Visual Analysis → Backfill. Broken locators are now fixed by continuing the same AI conversation (reusing context), instead of spawning new conversations per section
- [Researcher] Locator testing now captures exact match counts ("0 elements", "3 elements") instead of just pass/fail, giving AI better information for fixing
- [Researcher] XPath column removed from research prompts — AI no longer generates XPath locators. XPaths are backfilled automatically from the DOM only for elements with broken CSS and no ARIA
- [Researcher] Code split into mixins: locators, coordinates, deep-analysis, cache, parser, research-result
- [Captain] Now has diagnostic tools: inspect test sessions (logs, tool calls, ARIA states, pilot analysis), run TUI commands, read/write files, evaluate browser JS, manage tabs
- [Captain] Uses agentic model when configured, with richer system prompt covering diagnostic workflows
- [Captain] Max steps increased from 10 to 15
- [Pilot] Verdict review now weighs final observable state over intermediate failures — a test passes if the end state proves the goal, even when some steps failed
- [Pilot] "Continue" decisions now explain why the verdict was rejected and suggest untried approaches; feedback is sent back to Tester's conversation
- [Planner] Simplified page analysis for visited pages — uses URL+title instead of extracting ARIA elements, reducing token usage
- [Planner] Removed HTML content from planning prompt context, relying on research output instead
- [Planner] `getPendingTests()` now respects `test.enabled` flag
- [Test Command] `/test N` now selects from visible (enabled, unfinished) tests instead of all pending tests
- HTML diff now returns container-scoped parts instead of a single subtree — each changed area includes the CSS selector of its nearest stable container, helping the tester understand WHERE on the page changes occurred
- [Tester] Page diff suggestion now instructs AI to use container selectors from htmlParts as context when clicking
- ARIA snapshot capture and iframe HTML extraction now handle browser errors gracefully instead of crashing
- [Explorer] Browser error recovery (frame detached, target closed, session closed) added to locator count, eidx lookup, and container queries
- [Observability] Nested spans now work correctly when tracing is not fully initialized — allows sub-operations to appear in Langfuse traces
- Unexpected popup dismissal rule added to shared rules — agents now try clicking outside, pressing Escape, or clicking Cancel/Close when popups appear unexpectedly

## 2026-02-25

### Configuration
- **`ai.agents.researcher.sections`** — Pre-defined list of expected page sections. Researcher identifies these sections on each page, and planner proposes tests in this order. Sections: `focus` (modal, drawer, popup), `list` (items, table, cards), `detail` (selected item preview), `panes` (split screen), `content` (main area), `menu` (toolbar, context actions, filters), `navigation` (top bar, sidebar, breadcrumbs). Configurable to reorder or limit sections.

### Changes
- [Planner] New priority levels: `critical`, `important`, `high`, `normal`, `low` (replaced `high`/`medium`/`low`/`unknown`)
- [Planner] Tests are now proposed following research section order instead of being re-sorted by priority — content and detail sections are tested before menus and navigation
- [Planner] Maximum test count increased from 7 to 12, allowing broader coverage on feature-rich pages
- [Planner] Tests are distributed across different feature areas — no more than 2 tests per area, every Extended Research section with actions gets at least one test
- [Planner] When expanding a plan, only newly added tests are shown (not the full list repeated)
- [Planner] Plan files now include `<!-- plan updated on ... -->` timestamp comment when expanded
- [Researcher] Expandable element clicks are now wrapped in error handling to prevent a single failed click from stopping deep analysis
- [Researcher] Added `navigation` section type, separated from `menu` — `menu` is now page-local actions (toolbar, filters, dropdowns), `navigation` is site-wide navigation (top bar, sidebar, breadcrumbs)

## 2026-02-24

### New CLI Options
- **`explorbot freesail [startUrl]`** — Continuously explore and test pages autonomously. Explorbot navigates to new pages, researches them, runs tests, then moves on — indefinitely.
  ```bash
  explorbot freesail /admin           # start exploring from /admin
  explorbot freesail /dashboard --deep    # depth-first: explore nearby pages first
  explorbot freesail /app --shallow       # breadth-first: spread across many pages
  explorbot freesail /app --scope /admin  # only explore pages under /admin
  ```
- **`--deep`** — Depth-first exploration: prioritize newly discovered pages close to the current URL.
- **`--shallow`** — Breadth-first exploration: pick the globally least-visited page next.
- **`--scope <prefix>`** — Restrict autonomous navigation to URLs starting with the given prefix.

### New TUI Commands
- **`/freesail`** (alias: `/freeride`) — Start autonomous exploration from the current page inside TUI.
  ```
  /freesail
  /freesail --deep
  /freesail --shallow
  /freesail --scope /admin
  ```

### Changes
- [Researcher] Page sections are now visually marked with dashed colored borders on screenshots, with a Legend box in the bottom-right corner mapping colors to section names
- [Researcher] Missing elements are now detected and filled in before screenshot analysis, resulting in more complete visual data
- [Researcher] Broken section containers are fixed by AI before taking the annotated screenshot, so more sections appear in the visual output
- [Researcher] Screenshot file path is now printed after research completes for easy review
- [Context] `context --visual` now shows section container borders and legend when cached research is available
- [Pilot] Now makes the final pass/fail decision for tests — reviews Tester's verdict against actual evidence before accepting it
- [Pilot] Provides richer state context to diagnose failures: focused element, active form fields, disabled buttons, modal status, and open tabs
- [Pilot] Only uses tools when Tester has repeated failures, reducing unnecessary API calls
- [Navigator] Autonomous navigation now tracks visit counts per page and prefers least-visited pages instead of skipping all visited pages
- [Navigator] Validates that navigation targets are actual URL paths, preventing navigation to invalid destinations
- [Planner] Prioritizes testing features from Extended Research sections (modals, dropdowns, panels) that have no coverage yet
- [Tester] Deletion scenarios are now scoped — only items created by previous tests can be deleted, preventing accidental data loss
- File upload tests are no longer planned or attempted (Explorbot cannot upload files)
- [Quartermaster] A11y violation reports now include the affected HTML element for easier identification

## 2026-02-23

### New CLI Options
- **`--visual`** / **`--screenshot`** — Annotate interactive elements on screenshot with colored labels showing their index numbers, and print the screenshot file path.
  ```bash
  explorbot context /dashboard --visual
  explorbot context /login --screenshot
  ```

- **`--verbose`** / **`--debug`** on `research` — Print detailed debug logs during research (previously only available for `start` and `drill`).
  ```bash
  explorbot research /dashboard --verbose
  explorbot research /login --debug
  ```

- **`--incognito`** on `research` — Run research without reading or writing experience files (previously only available for `start` and `drill`).
  ```bash
  explorbot research /dashboard --incognito
  ```

### Changes
- [Researcher] Buttons, links, inputs and other interactive elements are annotated with `eidx` markers and highlighted with colored labels on screenshots, making it easier to see what was discovered
- [Researcher] Elements that AI missed during research are now automatically detected and listed in an "Other Elements" section
- [Researcher] Automatically retries research when page structure can't be parsed correctly
- `--session` no longer defaults to `output/session.json` — must be explicitly provided or used as a boolean flag

## 2026-02-18

### New CLI Options
- **`--session [file]`** — Save/restore browser session (cookies, localStorage, sessionStorage) to a JSON file. On next run the session is restored automatically, skipping login or setup steps.
  ```bash
  explorbot start /login --session                # uses default output/session.json
  explorbot start /dashboard --session auth.json  # custom session file
  explorbot research /app --session               # works with research command too
  explorbot context /app --session                # works with context command too
  ```

- **`--fresh`** — Start planning from scratch, ignoring any existing plan file for this page.
  ```bash
  explorbot plan /login authentication --fresh
  ```

- **`--no-fix`** — Skip locator fix cycle during research (useful for debugging).
  ```bash
  explorbot research /dashboard --no-fix
  ```

### New TUI Commands
- **`/plan --fresh`** — Re-plan from scratch, discarding the existing plan for current page.
  ```
  /plan --fresh
  /plan authentication --fresh
  ```

- **`/research --no-fix`** — Run research without the locator validation/fix cycle.
  ```
  /research --no-fix
  /research /dashboard --no-fix
  ```

### Configuration
- **`ai.agents.researcher.retries`** — Number of times researcher retries when >80% of locators are broken. Default: `2`.
- **`experience.maxReadLines`** — Maximum lines to read from each experience entry, truncating long entries. Default: `50`.

### Changes
- [Researcher] Now validates all locators against the live page after research, retrying automatically when most locators are broken
- [Researcher] Validates section container CSS selectors and removes broken ones
- [Researcher] Re-prompts AI when response cannot be parsed into the expected table format
- [Planner] Plans now auto-load from existing plan files instead of always starting fresh
- [Planner] Improved duplicate detection: groups existing tests by feature keywords to prevent re-proposing similar scenarios
- [Planner] Extended Research sections (modals, dropdowns, panels) are now treated as separate feature areas for planning
- [Pilot] New `ATTACH_SUMMARY` context option for lightweight page overview without full UI map
- State Manager: Detects modal/dialog appearance as a state change even when page hash hasn't changed
- Experience Tracker: Truncates long experience entries to configurable line limit
- Locator rules updated: `:contains()` replaced with `:has-text()` for Playwright compatibility
- Locator rules updated: icon-only buttons/links now use partial href and SVG icon class selectors instead of requiring text
- Click tool now auto-wraps plain text arguments as `I.click("text")` commands
