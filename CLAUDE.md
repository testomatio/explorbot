# Explorbot - Claude Assistant Documentation

Explorbot is a Bun application that performs automated exploratory testing of web applications using AI. It combines intelligent web navigation with automatic failure recovery to test web applications without pre-written test scripts.

## Project Goal

Build a fully autonomous web testing system that can interact with any web page without human intervention.

**Main Goal**: Explorbot should work for hours on different pages of a web application, inventing and testing scenarios autonomously.

### Core Principles

- **General-purpose, not site-specific** — Explorbot must not be fine-tuned for any specific website. All solutions should be universal.
- **Rely on common web patterns** — CRUD interfaces, ARIA roles, URL conventions, React patterns, semantic HTML. These are the building blocks.
- **Never hardcode locators** — If an element can't be found, solve it through better strategies, not by adding specific selectors to source code.
- **State-based navigation** — All pages have states (URL + headings) used as anchor points for understanding where we are.
- **Adaptive scenarios** — Guess test scenarios from UI. If a scenario doesn't work, adapt and try alternatives.

### What This Means in Practice

When implementing features or fixing bugs:

1. Solutions must work across different websites, not just the one being tested
2. Prefer ARIA selectors and semantic locators over CSS/XPath
3. Use state hashing and history to detect loops and progress
4. Let AI invent scenarios based on what it sees, not predefined scripts
5. Build recovery mechanisms that learn from failures

## Code Style

**Do not write comments unless explicitly specified**

Instead of if/else try to use premature exit from loop

Example:

```js
// bad example
if (!isValid()) {
  //...
} else {
  // ...
}

// good example
if (!isValid()) {
  // ...
  return;
}
```

Safely use ?. operator, instead of multiple && && checks
Do not use try/catch inside try/catch

When updating do the smallest change possible
Avoid repetitive code patterns
Avoid ternary operators!
Never use `...(condition ? { key: value } : {})` spread pattern — use a plain `if` statement instead
Avoid creating extra functions that were not explicitly set
Private methods must be placed after public methods
Avoid `=== null` / `=== undefined` comparisons when not needed — prefer shorter `if (...)` or `if (!...)` when applicable
Use dedent when formatting prompts
Use `mdq()` from `src/utils/markdown-query.ts` for all markdown manipulation (find sections, replace tables, extract text). Never do manual line-splitting/counting on markdown.
Put types into the end of file
Introduce new types and interfaces only for module-to-module collaboration, do not add types when dealing inside one module

DUPLICATING CODE IS A SIN YOU WILL BURN IN ROBOT HELL FOR THAT! Always look if this code was already written and doesn't need to be reintroduced again
RUN code deduplication agent after each major change

## Prompts & Rules — General, Not Example-Driven

Prompts, tool descriptions, and rules must be GENERAL. They describe how things work, not what just went wrong.

- **NEVER hardcode examples from a debug session, user message, or recent bug into a prompt, tool description, or rule.** If the user reports "the AI did X with input Y", the fix is never to add Y as a counter-example in the prompt. Describe the underlying principle instead.
- **NEVER add programmatic validators that target a specific failure the user just reported.** Do not bypass AI judgment with hardcoded regexes, keyword lists, or pattern matchers derived from the bug. Fix the prompt so the model understands the distinction generally.
- Examples in prompts must illustrate the general shape of correct usage (taken from the tool's purpose), never the specific wrong input a user mentioned.
- When a user reports model confusion between two tools/commands, sharpen each tool's description to state its purpose and boundaries in general terms — do not enumerate the user's failing example.

Applies to: `src/ai/rules.ts`, every `tool({ description })` / `inputSchema` describe text, system prompts in agent files, any dedent-block feeding an AI call.

## Separation of Concerns

Follow separation of concerns principle when implementing new features:

- logic for AI agents should be inside agent classes
- shared logic for html/aria should be added to corresponding files in util/ dir
- TUI and tsx should contain only logic of TUI interaction, all business logic must be moved to corresponding agents
- tools only contain tool definitions, result parsing, etc
- CLI commands in `bin/explorbot-cli.ts` must delegate to command classes from `src/commands/` — never duplicate command logic inline in the CLI
- All reusable command logic MUST live in a command class in `src/commands/` — the CLI handler should only do minimal setup (create ExplorBot, call command.execute(), stop) with zero business logic
- avoid using `And` in a function name, if you use it probably you need 2 functions

## Boundaries: Agents vs Data

Two tiers. **Data parts** are deterministic memory — they answer "what is true" from what was stored, using structural matching (URL, glob, hash) only. **Agents** exercise judgment — they turn context into decisions via AI.

### Data contracts

| Module | Does | Must never do |
|---|---|---|
| **StateManager** | Where am I / where have I been: states, transitions, hashes, loop detection, events | Call AI; interpret semantics ("this is a login page"); execute actions |
| **KnowledgeTracker** | Load/filter human facts by URL pattern; expose hints verbatim | Judge relevance semantically; act on hints; be written mid-run outside learn/drill flow |
| **ExperienceTracker** | Store/retrieve lessons per state hash; dedup blocks | Rank by meaning; compact itself (ExperienceCompactor's job); change behavior directly |
| **Config** | Resolve immutable settings once at startup | Change mid-run; hold site-specific values; be read by agents directly (injected instead) |

Shared invariant: matching in the data tier is **structural, never semantic**. If matching requires understanding content, that judgment belongs to an agent whose result gets *stored* back into a tracker.

### Agent contracts

One verb each; a responsibility that can't be phrased as the verb doesn't belong there:

- Researcher **describes**, Navigator **moves**, Planner **proposes**, Pilot **guides**, Tester **executes**, Driller **drills**, Historian **records sessions**, Analyst **reports**, ExperienceCompactor **compacts**, Quartermaster **audits a11y**, Captain **commands**

Negative contract (all agents):

- May persist artifacts to disk, but must not **expose filesystem operations as AI tools** — `readFile`/`writeFile`/`bash` tools belong to Captain alone
- Must not instantiate CodeceptJS/Playwright — all browser interaction through Explorer/Action
- Must not read config/env — dependencies arrive via `createAgent`

### HTML access

Full page HTML bodies are expensive and noisy — only agents whose verb requires reading raw structure get them:

| Tier | Agents | What they get |
|---|---|---|
| Standing full HTML | Researcher, Navigator, Driller | `<page_html>` / `combinedHtml()` in every context injection |
| No HTML | Planner, Captain, Historian, Analyst, ExperienceCompactor, Quartermaster | ARIA snapshots, UI maps, research summaries; node snippets ≤100 chars allowed |

Do not add HTML access to a new agent. If an agent seems to need raw HTML, the real fix is a better derivative (UI map, focused snippet, research note) produced by Researcher — not widening this table.

Glue tiers: **Tools** = schema + result parsing only, delegating every real operation to an agent or data module in one call. **Explorer/Action** = the only thing that moves the browser. **TUI/remote** = render pipes, never compute business meaning.

## Data Envelope Formats

All persisted formats share one rule: **envelope keys (YAML frontmatter, HTML comments) are closed vocabularies read deterministically by code before any AI runs; body structure is owned by exactly one writer module and parsed via `mdq()`.**

| Format | Location & owner | Envelope | Body grammar |
|---|---|---|---|
| Knowledge | `knowledge/*.md`, KnowledgeTracker | `url`/`path`, `wait`, `waitForElement`, `noExperienceReading/Writing` | Free prose facts |
| Experience | `experience/<stateHash>.md`, ExperienceTracker | sparse frontmatter: `url`, `title`, optional `root` (region scoping selector — record loads only while a matching region is open) | `## FLOW:` / `## ACTION:` h2 blocks; bullets + ```js``` + `Solution:` line; h3 forbidden under blocks |
| Test plan | `output/plans/*.md`, test-plan-markdown.ts | `<!-- test ... -->` comment: `priority`, `style`; scenario heading, `url:` line, bullets as steps | Notes/results appended by runner |

These are **data formats**: written and read back inside the runtime loop (knowledge/experience steer every run; plans are consumed by the runner and rerun).

**Artifacts** are session outputs for humans and external tools — stored when a session ends, never read back by agents mid-run:

| Artifact | Location & owner | Format |
|---|---|---|
| Session report | `output/reports/<mode>-<name>.md`, session-analyst.ts | fixed h2 sections: Coverage / What works / Defects / UX issues / Execution Issues |
| Generated tests | `output/tests/*.js`, historian | runnable CodeceptJS only — rerun consumes it as a new run's input, not as internal state |
| Screenshots / screencast | `output/…`, action.ts / historian | PNG / video files |

Artifacts follow looser rules than data formats: no envelope checklist applies. The only invariants are their owners (one writer each) and that generated tests stay runnable CodeceptJS.

The research cache (`output/research/<hash>.md`, researcher/cache.ts — hash-keyed, TTL'd, free markdown with `.fingerprint` sidecar) is neither: it is run-state ephemera, not an interface — treat it as internal-only.

Adding a new item to an envelope — all four must hold:

1. Read by code deterministically. If only the model reads it, it's prompt context, not an envelope item.
2. Scoped to URL/state. Global values belong in config or knowledge body.
3. Optional with a default — old files on disk must survive.
4. Single writer module.

Never add: executable content in envelopes; site-specific locators anywhere (violates core principle); new magic message prefixes in notes (`Pilot:`, noise prefixes are a closed set owned by `test-plan-markdown.ts`); new block types inside experience FLOW/ACTION bodies (a new h2 block type following the imperative-title pattern is fine); non-CodeceptJS constructs in generated tests.

## Feature Routing Test

When a feature request arrives, ask in order:

1. New fact to remember? → data layer / envelope extension (checklist above).
2. New judgment? → existing agent if the verb fits; otherwise new agent via `createAgent`.
3. New verb for the model? → tool schema delegating in one call.
4. New transport/UI? → adapter at existing seam (`LogDestination`, input callback).
5. Site-specific anything? → never code; redirect to `knowledge/`.
6. None of the above → reject.

## Regex vs AI Judgment

Regex answers questions about **form** — how something is *written*. AI answers questions about **meaning** — what something is *for*.

| | Regex / structural | AI judgment |
|---|---|---|
| Input has a spec or closed vocabulary | yes (URLs, globs, YAML keys, `<!-- test -->`, ARIA role names) | no — open-ended: element labels, page prose, LLM-generated text |
| Identical input must yield identical output | required: hashing, dedup, loop detection, cache keys | acceptable variance |
| Failure mode | loud (no match → visible miss) | silent & confident (wrong but plausible) |
| Wrong-answer cost | corrupts stored data → must be deterministic | recoverable via next action → AI tolerable |
| Role in pipeline | filter/gate reducing volume | decider among filtered candidates |

Decision procedure (ask in order):

1. Closed grammar? → regex/table. No exceptions.
2. Repeats must be reproducible (state hash, dedup, loop detection)? → deterministic, always.
3. Wrong answer verifiable downstream (act and observe)? → AI allowed: generate-then-verify.
4. Reducing volume before an AI call? → deterministic prefilter; narrows but never decides.
5. Anything else (intent, similarity, "what is this page for")? → AI. Web surface forms vary infinitely while meanings stay stable, so only semantics generalize.

Litmus tests:

- **Spec sentence:** can you state the rule without examples? "Match the path segment after the host" → regex. "Looks like a primary action button" → needs examples → AI.
- **Two sites:** would the same rule survive on different markup? If it only works because one site writes forms a certain way, it's memorized accident, not grammar → AI.

Escalation ladder — deterministic first, AI as cache-miss, persistence converts judgment back into structure:

```
regex/table lookup
  └─ miss or ambiguous → AI judgment
       └─ resolved → persist to experience/knowledge
            └─ next run hits the deterministic path again
```

Guardrail: composes with "Prompts & Rules — General, Not Example-Driven". A regex is legitimate only when it encodes a convention existing independently of any single failure (ARIA attributes, URL anatomy, envelope formats). A regex written because "the model once did X with input Y" is a memorized bug — reject it like a hardcoded locator.

## Architecture Overview

```
ExplorBot (DI Container)
    ├── AIProvider ─────────────> Conversation
    │
    ├── Explorer ───────────────> CodeceptJS ──> Playwright
    │       │
    │       └── StateManager
    │              ├── KnowledgeTracker
    │              └── ExperienceTracker
    │
    └── Agents (via createAgent factory)
            ├── Researcher
            ├── Navigator
            ├── Planner
            ├── Pilot ←──────────┐
            ├── Tester ──────────┘ (Pilot supervises Tester)
            ├── Driller -> Navigator - drill components to learn interactions
            ├── Captain
            ├── Historian
            ├── Analyst — end-of-session report (markdown)
            ├── ExperienceCompactor
            └── Quartermaster (optional)
```

### Key Layers

| Layer                    | Responsibility                      |
| ------------------------ | ----------------------------------- |
| **ExplorBot**            | DI container, TUI, user interaction |
| **AIProvider**           | AI model access via Vercel AI SDK   |
| **Explorer**             | CodeceptJS/Playwright integration   |
| **StateManager**         | Page state tracking, history        |
| **Knowledge/Experience** | Domain hints and learning           |
| **Agents**               | AI-driven task execution            |

## Dependency Injection

**IMPORTANT: ExplorBot is the DI container. All agents MUST be created through ExplorBot factory methods (`agentXxx()`). Never instantiate agents directly.**

`ExplorBot` (`src/explorbot.ts`) acts as service locator with factory-based DI:

```typescript
createAgent<T>(factory: (deps: { explorer, ai, config }) => T): T
```

Pattern for agent creation with lazy initialization and caching:

```typescript
agentResearcher(): Researcher {
  return (this.agents.researcher ||= this.createAgent(({ ai, explorer }) =>
    new Researcher(explorer, ai)
  ));
}
```

- Uses nullish coalescing assignment (`||=`) for singleton behavior
- Agents receive dependencies via constructor injection
- `agents` Record caches instances

## AI Provider & Conversation

### Provider (`src/ai/provider.ts`)

Wraps Vercel AI SDK for model access:

- `chat()` — generate text responses
- `generateWithTools()` — execute with tool calling (max 5 roundtrips)
- `generateObject()` — structured output with Zod schema validation
- `processImage()` — vision model support
- `startConversation()` — create conversation with system message
- `invokeConversation()` — execute conversation with optional tools
- `getModelForAgent()` — get agent-specific model or fall back to default

Includes retry logic with exponential backoff and Langfuse OTEL telemetry.

### Conversation (`src/ai/conversation.ts`)

Manages multi-turn AI interactions:

- Message history tracking
- Auto-trimming of tagged content
- Tool execution extraction
- Conversation cloning

## Explorer & Browser Automation

### Explorer (`src/explorer.ts`)

Bridges ExplorBot with CodeceptJS:

- Initializes CodeceptJS container (`codeceptjs.container.create()`)
- Manages Playwright integration via `playwrightHelper`
- Provides `actor` (CodeceptJS I interface) to agents
- Creates `Action` instances for command execution
- Manages StateManager and KnowledgeTracker

### Action (`src/action.ts`)

Executes CodeceptJS commands:

- `execute(code)` — runs I.\* commands
- Captures page state (HTML, ARIA, screenshot)
- Updates StateManager with ActionResult
- Records experience for learning

## State Management

### StateManager (`src/state-manager.ts`)

Tracks page state and navigation:

- `WebPageState` — URL, title, HTML, ARIA snapshot, headings
- `StateTransition` — records movement between states
- `updateState()` — updates state after actions
- `isInDeadLoop()` — detects stuck navigation
- `getRelevantKnowledge()` — filters knowledge by current state
- `getRelevantExperience()` — retrieves experience for current state

### State Change Events

```typescript
stateManager.onStateChange(event => {
  // React to navigation
});
```

## Knowledge & Experience

### KnowledgeTracker (`src/knowledge-tracker.ts`)

Loads domain knowledge from markdown files in `./knowledge/`:

```markdown
---
url: /login
wait: 1000
waitForElement: '.form-loaded'
---

Credentials: admin@example.com / secret123
```

- URL pattern matching (exact, glob, regex)
- Provides hints for navigation (wait, waitForElement)
- Loaded and cached with 30-second refresh

### ExperienceTracker (`src/experience-tracker.ts`)

Records successes and failures in `./experience/`:

- `saveFailedAttempt()` — records failed interactions
- `saveSuccessfulResolution()` — records working solutions
- `saveSessionExperience()` — records entire sessions
- `getRelevantExperience()` — retrieves for current page

Both use markdown files with YAML formatter and respect `noExperienceReading`/`noExperienceWriting` flags from knowledge.

## Agents

All agents implement the `Agent` interface. Task-executing agents (Tester, Captain) extend `TaskAgent` base class.

- Researcher — analyze pages, identify UI elements
- Navigator → ExperienceCompactor — execute navigation, resolve errors
- Planner — generate test scenarios
- Pilot — supervise test execution, detect stuck patterns, request user help
- Tester → Researcher, Navigator, Pilot, Historian*, Quartermaster* — execute tests with AI tools
- Driller -> Navigator - drill page components to learn interactions
- Captain → Historian*, Quartermaster* — handle user commands in TUI
- Historian — save test sessions, generate code, report to Testomatio
- Analyst — end-of-session markdown report; clusters defects/UX/execution issues, writes `output/reports/<mode>-<sessionName>.md`, sets the Testomatio run description
- ExperienceCompactor — compress experience files
- Quartermaster — a11y testing (optional)

\* injected via setter

### Pilot

Pilot supervises test execution. It maintains a separate conversation from Tester to analyze progress from a higher level.

**Why separate conversations:**

- Tester conversation is heavy — ARIA context every iteration
- Pilot conversation is light — only tool execution summaries
- Pilot can use expensive models (Claude, GPT-4) without token cost explosion
- Separation allows Pilot to see patterns without drowning in page details

**What Pilot does:**

- Detects stuck patterns (loops, repeated failures, no ariaDiff changes)
- Decides what context Tester needs next (requests ATTACH_ARIA, ATTACH_SUMMARY, ATTACH_UI_MAP)
- Asks user for help when automated recovery fails (interactive mode)
- Suggests alternative approaches, reset, or stop

**Information flow:**

- Tester calls Pilot every N iterations
- Pilot receives: current URL, goal, recent tool executions (success/fail + ariaDiff)
- Pilot returns: guidance text + attached context (ARIA/summary/UI map if requested)

## Tester Loop & Tools

### Tester Execution Loop (`src/ai/tester.ts`)

The `test()` method runs an AI-driven loop:

```
┌─────────────────────────────────────────────────────────────┐
│  1. Initialize: state, conversation, navigate to startUrl   │
├─────────────────────────────────────────────────────────────┤
│  2. LOOP (max 30 iterations):                               │
│     ├─ Get current ActionResult                             │
│     ├─ Check for dead loop                                  │
│     ├─ Re-inject context if URL/state changed               │
│     ├─ Prepare instructions for next step                   │
│     ├─ Analyze progress (periodically)                      │
│     ├─ provider.invokeConversation(tools, maxRoundtrips=5)  │
│     ├─ Track tool executions                                │
│     ├─ Handle assertions results                            │
│     └─ Check if test finished                               │
├─────────────────────────────────────────────────────────────┤
│  3. Post-loop:                                              │
│     ├─ finalReview() — AI evaluates results                 │
│     ├─ historian.saveSession() — save CodeceptJS code       │
│     └─ quartermaster.analyzeSession() — A11y analysis       │
└─────────────────────────────────────────────────────────────┘
```

Key behaviors:

- Context is re-injected when URL changes (triggers research) or state changes
- Progress is analyzed periodically to detect stuck tests
- Dead loop detection stops tests cycling through same states

### Tools (`src/ai/tools.ts`)

Tools are Vercel AI SDK `tool()` definitions that AI calls during test execution.

**CodeceptJS Tools** (page interaction):
| Tool | Purpose |
|------|---------|
| `click` | Click elements with multiple fallback commands |
| `type` | Fill input fields (I.fillField, I.type) |
| `select` | Select dropdown options |
| `pressKey` | Keyboard interactions |
| `form` | Execute multiple CodeceptJS commands in batch |

**Agent Tools** (AI-powered):
| Tool | Purpose |
|------|---------|
| `see` | Visual analysis via screenshot |
| `context` | Get fresh HTML/ARIA snapshot |
| `verify` | AI-powered assertion |
| `research` | Get UI map from Researcher |
| `visualClick` | Coordinate-based click fallback |
| `askUser` | Request user help (interactive mode) |

**Test Flow Tools** (in tester.ts):
| Tool | Purpose |
|------|---------|
| `reset` | Navigate back to initial page |
| `stop` | Abort test (scenario incompatible) |
| `finish` | Complete test successfully (with verification) |
| `record` | Document findings and notes |

### Tool Execution Flow

```
AI decides to call tool (e.g., click)
    │
    ▼
Tool captures previous state (ActionResult)
    │
    ▼
Tool creates Action, attempts command(s)
    │
    ▼
Tool captures new state
    │
    ▼
Tool returns result with pageDiff
    │
    ▼
AI analyzes pageDiff, decides next action
```

Each tool returns:

- `success: boolean`
- `pageDiff` — what changed (URL, ARIA, HTML)
- `suggestion` — hint for next action
- `code` — executed CodeceptJS code

## TUI

Application is built via React Ink with interactive TUI

```
[
  <LogPane>
  (everything what is done by explorbot logs here)
]
[
  <ActivityPane> / <InputPane><AutocompletePane>

  when application performs action => ActivityPane is shown describing current actions
  when no action is performing, user input is shown
  provides auto completion when / or I is typed
]
[
  <StateTransitionPane>
  [prints which page we on right now]
]
```

DO NEVER REMOVE FROM COMPONENTS:

```
import React from 'react';
```

### User Input in TUI

There are application commands available in TUI

* /research [uri] - performs research on a current page or navigate to [uri] if uri is provided
* /plan <feature> - plan testing feature starting from current page
* /navigate <uri_or_state> - move to other page. Use AI to complete navigation
* /drill [--knowledge <path>] [--max-components <n>] - drill all components on page to learn interactions

There are also CodeceptJS commands available:

- I.amOnPage() - navigate to expected page
- I.click() - click a link on this page
- I.see - ...
  ... etc (all codeceptjs commands)

## Remote log destination (`src/remote.ts`)

`--ws <url>` (or `EXPLORBOT_WS_URL`) streams a run to a host UI over one WebSocket. Explorbot dials **out**, so the same code covers a child process the host spawned and a CI bot connecting from elsewhere.

One class in one file, and nothing in explorbot knows about it. `remote` (the singleton in `src/remote.ts`) plugs into the two extension points that already exist:

- `addDestination()` on the logger — `Remote` **implements `LogDestination`**, so it registers *itself* alongside the console and the file. It gets the entry the logger already built, so the `LogType` reaches the UI as the frame's `level` and each kind is styled there instead of scraped out of flattened text. `html` is dropped, ANSI stripped, content capped.
- `executionController.setInputCallback()` — every ask in the codebase already goes through the controller, so the host answers the Pilot's `askUser`, the Navigator's login prompt and `drill_ask` without any of them knowing where the answer came from. Installing it is also what stops a TTY-less child hanging on the readline fallback.

**Run state travels on the same logger**, as `tag('data').log(kind, payload)` — a payload, not a message, so it goes only to the extra destinations, never to the console, the file or the log pane. Remote sends it on as the frame `kind` with `payload` as the frame body, so a call site decides what the UI sees and remote stays a pipe: `state` (`state-manager.ts`, the page under test), `test` and `plan` (`test-plan.ts`), `screenshot` (`action.ts`, the file just written), `research` (`ai/researcher/cache.ts`, the markdown and its file) and `report` (`ai/session-analyst.ts`, the analyst's markdown).

Consequently `isInteractive()` (`src/ai/task-agent.ts`) is **`INK_RUNNING || executionController.hasInputCallback()`** — "somebody can answer", asked of the controller rather than of any particular front end.

**There are no frame types.** A frame is `{type, ts, ...whatever}`; `send(type, data)` puts data on the wire and the UI renders what it recognises. Neither side validates the other's shape, so either can start sending more at any time. It queues while disconnected, reconnects with backoff, and `remote.close(exitCode)` flushes before exit (called from `showStatsAndExit`).

`remote.registerOption(program)` adds the flag through a Commander `preAction` hook, so it covers every command including the mounted `api`/`docs` subcommands and the standalone `boat/*` bins.

## Command Line Usage

Explorbot uses the `explorbot` CLI command (defined in `bin/explorbot-cli.ts`):

### Interactive exploration with TUI:

```bash
explorbot start [path]           # start TUI, optionally at path
explorbot start /login           # start at /login path
explorbot start --config ./custom-config.js
explorbot start --verbose        # or --debug
explorbot start --session        # persist session to output/session.json
explorbot start --session auth.json  # custom session file
```

### Generate test plan:

```bash
explorbot plan <path> [feature]  # generate plan and exit
explorbot plan /login            # plan tests for login page
explorbot plan /login authentication  # plan with focus on authentication
```

### Drill page components:

```bash
explorbot drill <url>                    # drill all components on page
explorbot drill /components --max-components 10  # limit to 10 components
explorbot drill /login --knowledge /login  # save to knowledge file
```

### Show resolved configuration:

```bash
explorbot config              # models, config file, paths, EXPLORBOT_* in effect
explorbot config https://app.example.com   # for a specific site
explorbot api config          # same for the API boat, also docs/prima
```

### Initialize project configuration:

```bash
explorbot init
explorbot init --config-path ./explorbot.config.js
explorbot init --force  # overwrite existing config
```

### Add domain knowledge:

```bash
explorbot learn              # interactive mode
explorbot learn /login "Use admin credentials"  # add directly
```

### Clean generated files:

```bash
explorbot clean  # clean artifacts only
explorbot clean --type experience
explorbot clean --type all
```

### List generated tests:
```bash
explorbot runs                               # list all generated test files with indices
explorbot runs output/tests/suite.js         # dry-run specific file (show steps)
```

### Re-run generated tests:
```bash
explorbot rerun output/tests/suite.js        # run all tests in file with AI healing
explorbot rerun output/tests/suite.js 3      # run test #3 only
explorbot rerun output/tests/suite.js 1-5    # run tests 1 through 5
explorbot rerun output/tests/suite.js 1,3,7  # run specific tests
explorbot rerun output/tests/suite.js --session  # with session persistence
```

## Configuration

Explorbot uses `explorbot.config.js` or `explorbot.config.ts` for configuration.

Example configuration:

```javascript
export default {
  ai: {
    model: groq('gpt-oss-20b'), // Vercel AI SDK model instance
    visionModel: groq('llama-scout-4'),
    agenticModel: groq('qwen3-32b'),
    langfuse: {
      enabled: true,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
    },
    agents: {
      tester: { model: groq('gpt-oss-20b') },
      navigator: { model: groq('gpt-oss-20b') },
      pilot: { stepsToReview: 5 },
    },
  },
  playwright: {
    browser: 'chromium',
    show: false,
    args: [],
  },
  dirs: {
    knowledge: 'knowledge',
    experience: 'experience',
    output: 'output',
  },
};
```

## Build

Run `bun run format` after each code change
After big changes run linter: `bun run lint:fix`
Before each commit run `/changelog` skill to update CHANGELOG.md
**Never use NodeJS**
This application is only Bun

### Git Worktrees

Feature branches live in sibling worktrees at `../explorbot-<branch>`, each sharing the main checkout's `node_modules` through a symlink:

```bash
bunosh worktree:create <feature>  # new branch off main in ../explorbot-<feature>
bunosh worktree:fetch <branch>    # existing branch fetched into ../explorbot-<branch>
bunosh worktree:delete [branch]   # remove a worktree by branch name or path, prompts when no name given
```

## CI

`.github/workflows/regression.yml` runs Explorbot end-to-end against real AI models. It costs real tokens and up to 150 minutes of runner time per run, so it is gated behind a deliberate human action: the `regression` label on a PR, or a manual dispatch.

**Never start a regression run.** Do not add or re-add the `regression` label, do not `gh workflow run regression.yml`, do not re-run its jobs, and do not approve the `regression` environment gate. Only the user decides when it runs, and it runs once per decision — pushing more commits to a labelled PR does not re-trigger it.

If a change needs regression coverage, say so and let the user apply the label.

`.github/workflows/test.yml` (format, lint, unit, integration, build) is cheap and runs automatically on every push and PR — that is the feedback loop to rely on.

## Dependencies and Requirements

- **Runtime**: Bun only (Node.js is NOT supported)
- **AI Providers**: OpenAI, Anthropic, Groq, Cerebras (via Vercel AI SDK)
- **Browser Automation**: Playwright with CodeceptJS wrapper
- **TUI Framework**: React Ink for terminal interface
- **Observability**: Langfuse via OpenTelemetry

## Testing and Linting

```bash
bun run format       # Format code with Biome
bun run lint:fix     # Fix linting issues
bun run check:fix    # Run all Biome checks and fixes
```

### Agent Integration Tests

AI agent calls are tested via `@copilotkit/aimock` — a real HTTP mock server pointed at by the real `Provider`. Tests duck-type-mock Explorer/StateManager/downstream agents, and inspect actual prompts via aimock's Journal (`mock.getLastRequest()`).

Tests live in `tests/integration/`. Canned UI maps in `test-data/ui-maps/` (fictional apps only — no real product data). See `docs/contributing/ai-integration-tests.md` for principles and `tests/integration/planner.test.ts` as the reference implementation.
