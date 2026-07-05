# Getting Started

Explorbot explores your web app, plans tests, and runs them — no test scripts. This guide gets you from zero to your first test in about ten minutes.

The path is short: install, configure, tell it how to log in, then point it at one feature and let it work.

## 1. Install

```bash
npm i explorbot --save
npx playwright install
```

You need Node.js 24+ (or Bun), an AI provider key, and a modern terminal — iTerm2, WARP, Kitty, Ghostty, or Windows Terminal with WSL. For the full compatibility checklist, see [Prerequisites](./reference/prerequisites.md).

## 2. Configure

Create the config files:

```bash
npx explorbot init
```

This writes `explorbot.config.js`, an `.env` file for your keys, and an `output/` folder.

Open `.env` and add your provider key:

```bash
OPENROUTER_API_KEY=sk-...
```

Then open `explorbot.config.js` and set your app's base URL — the host only, no path:

```javascript
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default {
  web: {
    url: 'http://localhost:3000',
  },
  ai: {
    model: openrouter('openai/gpt-oss-20b:nitro'),
    visionModel: openrouter('google/gemma-4-31b-it'),
    agenticModel: openrouter('minimax/minimax-m2.5:nitro'),
  },
};
```

Explorbot uses three models. Pick each one for speed and cost:

| Model | Config key | Used by | Pick |
|-------|-----------|---------|------|
| `model` | `ai.model` | Tester, Navigator, Researcher — they read HTML and ARIA on every step | a fast, cheap model (e.g. `openai/gpt-oss-20b:nitro`) |
| `visionModel` | `ai.visionModel` | screenshot analysis | a vision model (e.g. `google/gemma-4-31b-it`) |
| `agenticModel` | `ai.agenticModel` | Captain and Pilot — they read short action logs and make the big decisions | a smarter model (e.g. MiniMax 2.5, Grok Fast) |

Captain and Pilot barely use tokens, so a smarter `agenticModel` improves results for almost no extra cost. OpenRouter is the simplest start — one key, many models. To use OpenAI, Anthropic, Groq, or others, see [Providers](./reference/providers.md). For every config option, see [Configuration](./reference/configuration.md).

## 3. Tell Explorbot how to log in

Most apps need a login. Give Explorbot the credentials once, and it signs in on its own:

```bash
npx explorbot learn "/login" "Use credentials: admin@example.com / secret123"
```

This saves a knowledge file under `knowledge/`. Explorbot reads it whenever it opens the login page. Use `*` as the URL pattern for knowledge that applies to every page.

To skip the login on later runs, add `--session`. Explorbot logs in once and restores the saved cookies next time:

```bash
npx explorbot start /login --session        # logs in, saves the session
npx explorbot start /dashboard --session    # restores it, skips login
```

Keep real secrets in environment variables, and handle cookie banners, modals, and test data the same way — see [Customization](./guides/customization.md).

## 4. Pick one feature to test

Don't point Explorbot at your homepage. Start it on a single focused feature — a page with a clear, visible CRUD interface it can work with. Good first targets:

- `/admin/projects`
- `/posts`
- `/admin/users`
- any list-and-edit or settings page

A page where you can create, edit, and delete items gives Explorbot an obvious job and a clear way to tell whether it worked.

## 5. Run

```bash
npx explorbot start /admin/projects
```

The browser runs hidden by default. Add `--show` to watch it:

```bash
npx explorbot start /admin/projects --show
```

When the terminal UI opens, type `/explore`. Explorbot researches the page, plans tests, runs them, and repeats. To go one step at a time:

```
/research    # analyze the current page
/plan        # propose test scenarios
/test        # run the next test
```

## What you get

Every run is saved to `output/`:

- `output/tests/` — runnable Playwright or CodeceptJS tests you can commit and run in CI.
- `output/plans/` — the test scenarios in markdown.
- `experience/` — what Explorbot learned, reused on the next run.

## Next steps

- [Customization](./guides/customization.md) — login, cookie bars, modals, and test data.
- [Commands](./guides/commands.md) — every command, in the terminal and on the CLI.
- [Knowledge](./guides/knowledge.md) — teach Explorbot more about your app.
