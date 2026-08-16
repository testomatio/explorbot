# Global Configuration Mode

**Date:** 2026-08-03
**Status:** Approved in brainstorming, pending spec review

## Problem

Explorbot requires a project directory with `explorbot.config.js`, or a stack of `EXPLORBOT_*` environment variables on every invocation. The env-var mode is deliberately stateless: output goes to a temp directory, experience is never written, the Historian is off. A coding agent that wants to explore a site it visited yesterday starts from zero.

The prima boat spec (`2026-08-01-prima-boat-design.md`) already commits to a global user config and per-host persistent state under `~/.explorbot`. This spec defines that mechanism for the whole tool — core commands and every boat — plus the `init --global` command that sets it up.

## Goals

- `explorbot init --global` configures AI models and keys once, in `~/.explorbot`.
- Any explorbot command run from any directory uses that config when no project config exists.
- Each explored site gets a persistent subfolder under `~/.explorbot/sites/` with knowledge, experience, and output — full project semantics, so learning accumulates across runs.
- Sites auto-register on first visit; later runs reference them by bare host.
- All boats (prima, api-tester, doc-collector) inherit the mechanism with no boat changes.
- Cross-platform through `os.homedir()` alone — no XDG/Library/AppData branching.

## Non-Goals

- No per-setting merging between config sources. A config file wins wholesale, as documented today.
- No site aliases, environments (staging/prod), or a central `sites.json`.
- No changes to the env-var config-free mode; it remains the last resort with its current stateless behavior.

## Directory Layout

```
~/.explorbot/
├── config.js          # global AI config (models, keys, agent settings)
├── .env               # API keys and EXPLORBOT_* vars
└── sites/
    ├── app.example.com/
    │   ├── site.json  # { url, createdAt, lastRunAt }
    │   ├── knowledge/
    │   ├── experience/
    │   └── output/    # states, plans, reports, tests
    └── localhost_3000/
        └── ...
```

Folder names derive from the target URL's host and port, lowercased, with characters invalid in directory names replaced by `_` (so `localhost:3000` → `localhost_3000`).

## Config Resolution Ladder

All changes live in core `ConfigParser` (`src/config.ts`); boats inherit them because they obtain AI config and dirs through it.

**Env loading.** `loadConfig()` loads `~/.explorbot/.env` first, then cwd `.env`. Nearest wins on duplicate keys.

**Config lookup.** `findConfigFile()` gains one rung after the existing project paths: `~/.explorbot/config.js|mjs|ts`. First hit wins. The full order per invocation:

1. Project config in cwd (existing paths, including `config/` and `src/config/`).
2. Global config `~/.explorbot/config.*` → **global mode**.
3. `EXPLORBOT_*` env-built config (existing behavior, unchanged: temp output, experience off, Historian off).
4. Nothing → error, now also suggesting `explorbot init --global`.

Precedence is wholesale, never per setting. A project config wins over everything; the `EXPLORBOT_*` variables win over the global config, so a machine-wide installation never silently overrides what a command asked for. `EXPLORBOT_URL` and command-line URLs still apply in global mode because the URL is per-invocation there. The prima spec's "first hit wins per setting" line is amended to this wholesale rule.

**Global mode.** Active when the loaded config path is the global one:

- `dirs` resolve to `~/.explorbot/sites/<host>/{knowledge,experience,output}`; `getProjectRoot()` returns the site dir. States, plans, reports, and generated tests land there.
- Full project semantics: experience read and write enabled, Historian on, reporter as configured.
- A `dirs` section in the global config is ignored; the site layout is fixed.
- A `web.url` in the global config is a load-time error — the global config is site-agnostic; the URL comes per command or from a registered site.

## Site Resolution & Auto-Registration

In global mode the target site comes from the command's URL argument, else `EXPLORBOT_URL`. One argument carries both site and path:

- **Absolute URL** (`https://app.example.com/login`) — host+port become the site folder. First visit auto-registers: creates `sites/<host>/` with `site.json` and the three subdirs. Every run updates `lastRunAt`.
- **Bare reference** (`app.example.com/login`, `localhost_3000`) — the token before the first `/` is matched against registered sites by folder name or by the host of their `site.json` URL; the rest is the path. Unknown reference → error listing registered sites and suggesting an absolute URL to register a new one.
- **Leading-slash path** (`/login`) — needs a base URL from `EXPLORBOT_URL`; otherwise error listing registered sites.

`explorbot sites` lists registered sites — folder name, base URL, last run — via a `SitesCommand` class in `src/commands/`.

## `explorbot init` — Local or Global

Plain `explorbot init` in an interactive terminal first asks which installation to set up:

```
? Where should explorbot be initialized?
❯ Local    — creates the config file in the current directory
  Global   — initializes explorbot to run from anywhere on this machine
```

- **Local** runs the existing project flow, unchanged.
- **Global** runs the global wizard below.
- When a global config already exists, the Global option is disabled and labeled `(already installed)`; reinstalling requires `explorbot init --global --force`.
- Outside a TTY (agents, CI), plain `init` skips the chooser and runs the local flow exactly as today. `--global` skips the chooser and goes straight to the global wizard; any other init flag (`--config-path`, `--path`) implies local.

### The global wizard

An interactive React Ink wizard (same interaction pattern as `explorbot learn`):

1. Pick a provider from the supported list (`PROVIDERS` in `src/config.ts`).
2. Enter the API key (stored in `~/.explorbot/.env` under the provider's conventional variable).
3. Optionally validate the key with a single test AI call.
4. Writes `~/.explorbot/config.js` with provider code and the recommended model IDs from `models.json` snapshotted in — no `web.url`, no `dirs` — plus a comment pointing at the providers doc for later edits.

Prints next steps: `explorbot explore https://your-app.example.com` from anywhere.

Non-interactive path for agents: `explorbot init --global --provider <name> [--api-key <key>]` skips the wizard; the key may also come from the environment. `--force` overwrites an existing global config, mirroring project `init`. Logic lives in the init command class in `src/commands/`; the CLI handler stays thin.

The local flow itself is unchanged.

## Boats

No boat changes. AI config, dirs, and project root flow through core `ConfigParser`:

- **prima** — its spec's `state/<host>` layout is renamed to `sites/<host>`; its Config-Free Operation section now defers to this spec.
- **api-tester** — the site folder derives from the endpoint host (`EXPLORBOT_URL` / absolute endpoint).
- **doc-collector** — from the absolute URL argument of `docs collect`.

Boat-specific config files (`docbot.config.js`, apibot) stay project-local; their options all have defaults, so global-mode runs use those.

## Testing

Unit tests only — nothing here prompts a model except the wizard's optional key validation:

- Ladder order: project config beats global; global beats env-built; env-built error message names `init --global`.
- Env file order: global `.env` loaded, cwd `.env` overrides.
- Global mode dir resolution: site dirs, project root, `dirs`-ignored and `web.url`-error rules.
- Host sanitization: ports, case, invalid characters.
- Auto-registration: folder + `site.json` created once, `lastRunAt` updated.
- Bare-reference resolution: folder name, host match, unknown-reference error listing sites.
- Non-interactive `init --global --provider` writes both files; `--force` semantics.
- Init chooser: Global option disabled when the global config exists; non-TTY plain `init` falls back to the local flow.

## Decisions Log

- Global config is a rung in core `ConfigParser`'s lookup, not a flag and not env-only — boats inherit for free.
- Site folders live under `~/.explorbot/sites/<host>/`, each with `site.json` meta enabling bare-host references and `explorbot sites`.
- Global mode runs with full project semantics (experience on, Historian on) — the point is memory across runs.
- Config file beats env vars wholesale, consistent with existing docs; prima spec's per-setting wording amended.
- `init --global` is an interactive wizard with a `--provider` non-interactive escape for agents.
- Plain `init` opens a Local/Global chooser in interactive terminals; Global shows `(already installed)` and is disabled once configured.
- `web.url` in global config errors; `dirs` in global config is ignored.
