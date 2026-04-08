# Explorbot

**The vibe-testing agent for web applications.**

![Explorbot Terminal UI](https://github.com/testomatio/explorbot/blob/main/assets/screenshot.png)

Explorbot explores your web app like a curious human would — clicking around, filling forms, finding bugs, and learning as it goes. No test scripts required. Just point it at your app and let it work.

```bash
npx explorbot start https://your-app.com
```

Explorbot is your first assitant in testing.
It will do its best to use your application with no babysitting. It will use application and provide you valuable feedback.

## Use Cases

* Autonomously test web application or its parts
* Discover test scenarios and get automated tests for them
* Write manual test cases from exploring website
* 24h/7d of monkey-testing for web application that can reveal hidden errors
* Quick-test for MVPs and prototypes

Explorbot can start testing features which were not covered by unit tests or browser tests.

## Demo

![Explorbot in action](https://github.com/testomatio/explorbot/blob/main/assets/demo.gif)

## Requirements

- NodeJS 24+ or **Bun**
- **AI provider API key** — OpenRouter recommended; Groq, Cerebras, OpenAI, Anthropic, or others via [Vercel AI SDK](https://sdk.vercel.ai/providers)
- **Modern terminal** — iTerm2, WARP, Kitty, Ghostty. WSL if running on Windows
- **Compatible web app** — Check [docs/prerequisites.md](docs/prerequisites.md) to verify your app works with Explorbot

## Quick Start

**1. Install dependencies**

```bash
npm i explorbot --save
npx playwright install
```

**2. Initialize config**

```bash
npx explorbot init
```

**3. Edit `explorbot.config.js`** — set your app URL and AI provider:

> [!IMPORTANT]
> **Explorbot uses three types of models:**
>
> | Type | Config key | Purpose | Recommendation |
> |------|-----------|---------|----------------|
> | **model** | `ai.model` | Standard model for HTML/ARIA processing. Used by Tester, Navigator, Researcher. Should be fast and cheap — these agents are token-hungry. | e.g. `openai/gpt-oss-20b` |
> | **visionModel** | `ai.visionModel` | Screenshot analysis. Used when agents need to visually inspect the page. | e.g. `meta-llama/llama-4-scout-17b-16e-instruct` |
> | **agenticModel** | `ai.agenticModel` | Exceptional decision making. Used by Captain and Pilot — agents that read compact action logs and make high-level decisions. Benefits from a smarter model. | Strong agentic models but fast (MiniMax 2.5, Grok Fast, Qwen, …) |
>
> See [OpenRouter](https://openrouter.ai/rankings#performance) for latency-focused model picks.

This example uses **OpenRouter** (one API key, many providers). Any Vercel AI SDK provider works; see [docs/providers.md](docs/providers.md).

```javascript
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default {
  web: {
    url: 'https://your-app.com',
  },
  ai: {
    model: openrouter('openai/gpt-oss-20b'),
    visionModel: openrouter('meta-llama/llama-4-scout-17b-16e-instruct'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
};
```

> [!TIP]
> Captain and Pilot barely use tokens (just action summaries), so a smarter `agenticModel` costs very little while significantly improving test quality. You can also override any agent's model individually via `ai.agents.<name>.model`.

**4. Add knowledge** (optional but recommended)

If your app requires authentication, tell Explorbot how to log in:

```bash
# Interactive mode
npx explorbot learn

# Or via CLI
npx explorbot learn "/login" "Use credentials: admin@example.com / secret123"
```

> [!TIP]
> Use `--session` to persist browser cookies and localStorage between runs. Log in once, and Explorbot will restore the session on next start:
> ```bash
> npx explorbot start /login --session          # saves to output/session.json
> npx explorbot start /dashboard --session      # restores session, skips login
> npx explorbot start /app --session auth.json  # custom session file
> ```

> [!NOTE]
> Use `*` as URL pattern to add general knowledge that applies to all pages. See [docs/knowledge.md](docs/knowledge.md) for more.

**5. Run**

```bash
npx explorbot start /admin/users
```

Start from a small functional area of your app (admin panel, settings, any CRUD section) so Explorbot can quickly understand its business purpose and context.

Browser runs headless by default — use `--show` to see it:

```bash
npx explorbot start /settings --show
```

Requires a modern terminal (iTerm2, WARP, Kitty, Ghostty, Windows Terminal). On Windows, use WSL.

## How It Works

Explorbot explores websites, analyzes their UI, and proposes tests — which it can then execute. It controls its own browser through CodeceptJS → Playwright (no MCP involved).

![Explorbot Architecture](assets/architecture.png)

Run `/explore` in TUI or use `explorbot explore` from CLI to watch the cycle: research → plan → test → repeat.

**Supporting components:**

* **Pilot** — supervises Tester from a separate conversation: reviews action logs, detects stuck patterns, makes final pass/fail decisions. Uses `agenticModel` since it only processes compact summaries, not raw HTML
* **Historian** — saves sessions as CodeceptJS code, learns from experience
* **Quartermaster** — analyzes pages for A11y issues (axe-core + semantic)
* **Reporter** — sends test results to Testomat.io

## Basic Usage

Once in the terminal UI:

```
/explore              # Full cycle: research → plan → test
/research             # Analyze current page
/plan                 # Generate test scenarios
/test                 # Run next test
/navigate /settings   # Go to a page
```

You can also run CodeceptJS commands directly:

```
I.click('Login')
I.fillField('email', 'test@example.com')
I.see('Welcome')
```

See [docs/commands.md](docs/commands.md) for all commands.

> [!NOTE]
> Most TUI commands also have CLI equivalents that run headless and exit. For example, `explorbot research <url>` and `explorbot plan <path>` work without launching TUI. See [docs/commands.md](docs/commands.md) for the full mapping.

## What You Get

| Output | Location | Description |
|--------|----------|-------------|
| Test files | `output/tests/*.js` | CodeceptJS tests you can run independently |
| Test plans | `output/plans/*.md` | Markdown documentation of scenarios |
| Experience | `./experience/` | What Explorbot learned about your app |

## Two Ways to Run

**Interactive mode** — Launch TUI, guide exploration, get real-time feedback:

```bash
npx explorbot start https://your-app.com
```

**Autonomous mode** — Non-interactive testing and planning:

```bash
npx explorbot explore /admin/users
```

**Freesail mode** — Fully autonomous, continuous exploration across multiple pages:

```bash
npx explorbot freesail /admin              # explore and test pages indefinitely
npx explorbot freesail /app --deep         # depth-first: explore nearby pages first
npx explorbot freesail /app --shallow      # breadth-first: spread across many pages
npx explorbot freesail /app --scope /admin # restrict to URLs under /admin
```

Freesail navigates to a page, researches it, runs tests, then moves on to the next least-visited page — repeating until stopped. Also available as `/freesail` in TUI.

## API Testing

Explorbot also tests REST APIs. Add an `api` section to your config and point it at your API:

```javascript
export default {
  web: {
    url: 'http://localhost:3000',
  },
  ai: {
    model: openrouter('openai/gpt-oss-20b'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
  api: {
    baseEndpoint: 'http://localhost:3000/api/v1',
    spec: ['http://localhost:3000/api/openapi.json'],
    headers: {
      'Authorization': 'Bearer <token>',
    },
  },
};
```

```bash
npx explorbot api explore /users          # full cycle: plan + test all styles
npx explorbot api plan /users             # generate test plan only
npx explorbot api test plans/users.md *   # run all tests from a plan
```

The API tester uses two agents — **Chief** (plans test scenarios across styles: normal, curious, psycho, hacker) and **Curler** (executes HTTP requests and verifies responses). Both use `agenticModel` by default.

See [docs/api-testing.md](docs/api-testing.md) for setup, authentication hooks, and full command reference.

## Core Philosophy

**Strategic decisions are deterministic** — The workflow (research → plan → test) is predictable and consistent.

**Tactical decisions are AI-driven** — How to click that button, what to do when a modal appears, how to recover from errors.

**Cheap workers, smart managers** — Tester, Navigator, and Researcher are token-hungry agents that chew through HTML and ARIA on every step. They run on the fast, cheap `model`. Captain and Pilot are the decision-makers — they read only compact action logs and make high-level choices. Set `agenticModel` to a smarter model for better results at negligible extra cost.

**Explorbot learns from its failures** — It uses previous experience interacting with a web page for faster and better decisions on next runs.

**Explorbot needs your knowledge** — You adjust Explorbot prompts by passing suggestions, UI explanations, and domain knowledge as text files, which are loaded when the corresponding page is opened.

When tuned, Explorbot **can run autonomously for hours** navigating a web application and trying different scenarios. You don't need to watch it. The more Explorbot runs, the more it learns and the more complex scenarios it can test.


## Teaching Explorbot

* **Knowledge** (`./knowledge/`) — Tell Explorbot about your app: credentials, form rules, navigation quirks. See [docs/knowledge.md](docs/knowledge.md).
* **Rules** (`./rules/`) — Customize agent behavior with markdown files. Add page-specific instructions, override planning styles, or tune how agents work on different parts of your app. See [docs/configuration.md](docs/configuration.md#rules).
* **Experience** (`./experience/`) — Explorbot learns automatically from successful interactions and saves what works.

## Further Reading

- [docs/prerequisites.md](docs/prerequisites.md) — Application compatibility checklist
- [docs/commands.md](docs/commands.md) — Terminal command reference
- [docs/api-testing.md](docs/api-testing.md) — API testing setup and commands
- [docs/knowledge.md](docs/knowledge.md) — Knowledge system and URL patterns
- [docs/providers.md](docs/providers.md) — AI provider configuration
- [docs/agents.md](docs/agents.md) — Agent descriptions and capabilities
- [docs/planner.md](docs/planner.md) — Planner agent: planning styles and customization
- [docs/scripting.md](docs/scripting.md) — Building custom autonomous scripts
- [docs/observability.md](docs/observability.md) — Langfuse tracing and debugging
- [docs/page-interaction.md](docs/page-interaction.md) — How agents interact with pages

## FAQ

**Can I run it in Cursor? or Claude Code?**
No, Explorbot is a separate application designed for constant testing. Cursor, Codex, or Claude Code are coding agents — not relevant here.

> However, Explorbot can be used as subagent or terminal command which is controlled by coding agent.

**Can I bring Cursor or OpenAI Subscription?**
No Cursor and OpenAI subscription can't be used. Mostly because their models are slow for Explorbot's usage. We recommend using pay-per-token via Groq and OpenRouter.

**I want to use Opus!!!**
Opus is great for coding. But for testing we need a simpler model that can safely consume lots of HTML tokens. Opus must be used for sophisticated decision-making, while explorbot needs to collect knowledge from webpages and do it fast.

**Is that expensive?**
No. With fast open models (e.g. `openai/gpt-oss-20b` on OpenRouter or Groq), expect roughly **~$1/hour of continuous run**, depending on provider and traffic.

**Does Explorbot have MCP?**
Not yet.

**Can I build my own agents with it?**
Yes, use the programmatic API. See [docs/scripting.md](docs/scripting.md).

**Ok, but I can do the same in Cursor with Playwright MCP!**
Good luck running it on CI!

## Development

* Clone this repository
* Use **Bun** to run TS and TSX with no building
* Create a sample project under `example` directory:

```
./bin/explorbot-cli.ts init --path example
```

* Run your commands using `--path example`

```
./bin/explorbot-cli.ts start --path example
```

## License

Explorbot is licensed under the [Elastic License 2.0 (ELv2)](LICENSE).

**Free for commercial use** — you can use Explorbot to test any application, including commercial products, without paying a license fee. You can modify it, self-host it, and integrate it into your workflow.

The only restriction: you may not offer Explorbot itself as a hosted/managed service (i.e., resell it as a product). This license is used by Elastic, Grafana, and other open-source companies.

Explorbot is built by [Testomat.io](https://testomat.io).

---

Explorbot learns as it explores. The more it tests your app, the better it gets at testing your app. That's vibe-testing.
