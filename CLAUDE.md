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

**Do not write comments unless explicilty specified**

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
Avoid repetetive code patterns
Avoid ternary operators!
Avoid creating extra functions that were not explicitly set
Use dedent when formatting prompts

DUPLICATING CODE IS A SIN YOU WILL BURN IN ROBOT HELL FOR THAT! Always look if this code was already wirtten and doesn't need to be reintroduced again

## Separation of Concerns

Follow separation of concerns principle when implementing new features:

- logic for AI agents should be inside agent classes
- shared logic for html/aria should be added to corresponding files in util/ dir
- TUI and tsx should contain only logic of TUI interaction, all business logic must be moved to corresponding agents
- tools only contain tool definitions, result parsing, etc

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
            ├── Tester
            ├── Captain
            ├── ExperienceCompactor
            └── Quartermaster (optional)
```

### Key Layers

| Layer | Responsibility |
|-------|----------------|
| **ExplorBot** | DI container, TUI, user interaction |
| **AIProvider** | AI model access via Vercel AI SDK |
| **Explorer** | CodeceptJS/Playwright integration |
| **StateManager** | Page state tracking, history |
| **Knowledge/Experience** | Domain hints and learning |
| **Agents** | AI-driven task execution |

## Dependency Injection

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

- `execute(code)` — runs I.* commands
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
stateManager.onStateChange((event) => {
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
waitForElement: ".form-loaded"
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

Both use markdown files with YAML frontmatter and respect `noExperienceReading`/`noExperienceWriting` flags from knowledge.

## Agents

| Agent | File | Dependencies | Purpose |
|-------|------|--------------|---------|
| Researcher | `src/ai/researcher.ts` | Explorer, Provider | Analyze pages, identify UI elements |
| Navigator | `src/ai/navigator.ts` | Explorer, Provider, ExperienceCompactor | Execute navigation, resolve errors |
| Planner | `src/ai/planner.ts` | Explorer, Provider | Generate test scenarios |
| Tester | `src/ai/tester.ts` | Explorer, Provider, Researcher, Navigator, Tools | Execute tests with AI tools |
| Captain | `src/ai/captain.ts` | ExplorBot | Handle user commands in TUI |
| ExperienceCompactor | `src/ai/experience-compactor.ts` | Provider, ExperienceTracker | Compress experience files |
| Quartermaster | `src/ai/quartermaster.ts` | Provider, StateManager | A11y testing (optional, config-enabled) |

All agents implement the `Agent` interface. Task-executing agents (Tester, Captain) extend `TaskAgent` base class.

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

There are also CodeceptJS commands availble:

* I.amOnPage() - navigate to expected page
* I.click() - click a link on this page
* I.see - ...
... etc (all codeceptjs commands)

## Command Line Usage

Explorbot uses the `explorbot` CLI command (defined in `bin/explorbot-cli.ts`):

### Interactive exploration with TUI:
```bash
explorbot explore
explorbot explore --from https://example.com/login
explorbot explore --path ./my-project
explorbot explore --config ./custom-config.js
explorbot explore --verbose  # or --debug
```

### Initialize project configuration:
```bash
explorbot init
explorbot init --config-path ./explorbot.config.js
explorbot init --force  # overwrite existing config
```

### Add domain knowledge:
```bash
explorbot add-knowledge  # or explorbot knows
explorbot add-knowledge --path ./knowledge
```

### Clean generated files:
```bash
explorbot clean  # clean artifacts only
explorbot clean --type experience
explorbot clean --type all
```

Note: Non-interactive mode is planned but not yet implemented.

## Configuration

Explorbot uses `explorbot.config.js` or `explorbot.config.ts` for configuration.

Example configuration:
```javascript
export default {
  ai: {
    provider: groq,  // Vercel AI SDK provider
    model: 'gpt-oss-20b',
    visionModel: 'llama-scout-4',
    langfuse: {
      enabled: true,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
    },
    agents: {
      tester: { model: 'gpt-oss-20b' },
      navigator: { model: 'gpt-oss-20b' },
    },
  },
  playwright: {
    browser: 'chromium',
    show: false,
    args: []
  },
  dirs: {
    knowledge: 'knowledge',
    experience: 'experience',
    output: 'output',
  }
}
```

## Build

Run `bun run format` after each code change
After big changes run linter: `bun run lint:fix`
**Never use NodeJS**
This application is only Bun

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
