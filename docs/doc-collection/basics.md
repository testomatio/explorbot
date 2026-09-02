# Doc Collection Basics

Explorbot can document your web app for you. The doc collector opens the app in a browser, crawls it page by page, and has AI describe each page: its purpose, screenshots of its sections, and what a user can do there. The result is a browsable markdown spec.

This is useful when you need:

- documentation for an app that has none
- onboarding material for a new team member
- a machine-readable spec of your app to feed into agents or test planning

The output is honest about what it knows: every capability is marked as either proven (backed by visible UI) or assumed.

## How it works

The collector starts at the path you give it. For each page it:

1. Navigates to the page and captures its state.
2. Runs the [Researcher](../web-testing/researcher.md) to map sections and interactive elements.
3. Asks AI to write the page documentation from that research.
4. Saves a markdown file plus screenshots, and queues links found on the page.

It repeats this until the queue is empty or the page budget is spent. Only same-origin links are followed.

## Configure

The collector runs on your regular Explorbot setup — the AI provider and browser come from `explorbot.config.js` (see [configuration](../reference/configuration.md)). Crawl behavior lives in a separate file: `docbot.config.ts` (`.js` and `.mjs` work too).

Generate a starter config:

```bash
npx explorbot docs init
```

Three options matter for a first run:

```ts
export default {
  docs: {
    maxPages: 100, // how many pages to document
    output: 'docs', // subfolder inside your output dir
    screenshot: true, // capture page and section screenshots
    ignoreErrors: true, // skip pages that fail instead of stopping the crawl
  },
};
```

If no `docbot.config` file exists, these defaults apply. `docs init` refuses to overwrite an existing file unless you pass `--force`.

One more option worth knowing early: `prompt` adds your own instructions to the AI that writes page docs — for example `prompt: 'Focus on billing workflows'`.

## First run

```bash
npx explorbot docs collect /                       # start from the home page
npx explorbot docs collect /admin --max-pages 20   # start deeper, smaller budget
npx explorbot docs collect https://staging.example.com/app  # full URL: its origin becomes the base URL for this run
```

Useful flags:

- `--max-pages <count>` — override the configured page budget for this run
- `-s, --show` — watch the browser while it crawls
- `--session [file]` — reuse a saved login session; needed for apps behind authentication. See [--session](../reference/commands.md#--session).
- `--docs-config <path>` — load a `docbot.config` from another location
- `-c, --config <path>`, `-p, --path <dir>`, `--verbose` — same as in other Explorbot commands

When the run finishes it prints how many pages were documented, how many were skipped, and where the spec index is.

## Output files

```
output/docs/
├── index.md         # state map and index of everything documented
├── state-diagram.mmd # raw Mermaid state-transition artifact (reusable by other agents)
├── pages/           # one markdown file per page
└── screenshots/     # full-page and section captures
```

`index.md` opens with run stats and a Mermaid state-transition map, then lists every page with its purpose and capabilities. Page nodes in the diagram link to their documentation. Transient dialogs, modals, tabs, and expanded screen areas appear as child states when interactive collection observes them. Pages that were skipped are listed at the bottom with reasons.

`state-diagram.mmd` is the same state-transition map as a standalone Mermaid file (no markdown fences), so other agents can embed or post-process it without re-rendering `index.md`.

## Use the spec in Explorbot

Pass the generated directory or its `index.md` to any Explorbot web command:

```bash
npx explorbot start / --spec output/docs
npx explorbot plan /admin/users --spec output/docs
npx explorbot explore / --spec output/docs
```

You can also set `dirs.spec: 'output/docs'` in `explorbot.config.js` to use it by default. Explorbot selects documentation for the current URL instead of loading the whole site spec into every prompt. Proven capabilities and observed transitions are supporting context; possible capabilities remain explicitly unverified until the live UI confirms them.

The format is not tied to Docbot. See [Application Specs](../workflow/application-spec.md) to create or generate a compatible bundle with another tool.

Each page file follows the same shape:

```markdown
# /admin/users

Title: User Management

## Purpose

Lists all user accounts and provides entry points for managing them.

## User Can

- user can search users by name -> list of items
  Proof: Search input above the users table.
  ![user can search users by name](../screenshots/admin_users_can_1.png)

## User Might

- user might export the user list -> all items
  Signal: Toolbar shows an unlabeled download icon.

## Screenshots

![Page screenshot](../screenshots/admin_users_page.png)

## Navigation

- Create user: /admin/users/new
- Audit log: /admin/audit
```

`User Can` lists capabilities proven by visible UI, each with its evidence. `User Might` lists capabilities the UI suggests but research could not fully confirm. Links to other pages are collected in their own `Navigation` section and never counted as capabilities. Pages where research found almost nothing are skipped rather than padded with guesses.

## Next steps

- The crawl visited too much, too little, or the wrong pages — tune it in [Choosing What to Crawl](./crawling.md).
- Document what pages do, not only what they show — enable [Interactive Mode](./interactive-mode.md).
