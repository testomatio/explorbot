# Documentation Collection

`doc-collector` crawls pages and generates a lightweight spec:

- `output/docs/spec.md`
- `output/docs/pages/*.md`
- `output/research/*.md`

Each page is summarized as:

- `Purpose`
- `User Can`
- `User Might`

## Commands

### `explorbot docs collect <path-or-url>`

Start from a relative path or a full URL:

```bash
explorbot docs collect /users/sign_in
explorbot docs collect /docs/openapi#tag/project-analytics-tags --max-pages 20
explorbot docs collect https://teleportal.ua/ua/serials/stb/kod --path explorbot-testing --show --session --max-pages 20
```

Supported options:

| Option | Description |
|--------|-------------|
| `--max-pages <count>` | Limit documented pages |
| `-c, --config <path>` | Path to `explorbot.config.*` |
| `--docs-config <path>` | Path to `docbot.config.*` |
| `-p, --path <path>` | Working directory |
| `-s, --show` | Show browser window |
| `--headless` | Run headless |
| `--incognito` | Do not record experiences |
| `--session [file]` | Save or restore browser session |
| `-v, --verbose` | Verbose logging |
| `--debug` | Debug logging |

If you pass a full URL, its origin is used as the runtime base URL for that run.

### `explorbot docs init`

Create a starter `docbot.config.ts`:

```bash
explorbot docs init
explorbot docs init --path explorbot-testing
explorbot docs init --path explorbot-testing --force
```

### Standalone CLI

```bash
bun boat/doc-collector/bin/doc-collector-cli.ts collect /users/sign_in --max-pages 20
```

## Config

The collector loads `docbot.config.js`, `docbot.config.mjs`, or `docbot.config.ts`. If none exists, defaults are used.

```ts
export default {
  docs: {
    maxPages: 100,
    output: 'docs',
    screenshot: true,
    collapseDynamicPages: true,
    scope: 'site',
    includePaths: [],
    excludePaths: [],
    deniedPathSegments: ['callback', 'callbacks', 'logout', 'signout', 'sign_out', 'destroy', 'delete', 'remove'],
    minCanActions: 1,
    minInteractiveElements: 3,
    // prompt: 'Add domain-specific guidance here',
  },
};
```

| Option | Default | Description |
|--------|---------|-------------|
| `maxPages` | `100` | Maximum pages to document |
| `output` | `'docs'` | Output folder inside `output/` |
| `screenshot` | `true` | Allow screenshot-assisted research |
| `prompt` | unset | Extra instructions for the Documentarian |
| `collapseDynamicPages` | `true` | Collapse dynamic URLs like `/users/123` and `/users/456` into one crawl key |
| `scope` | `'site'` | Crawl breadth mode |
| `includePaths` | `[]` | Only allow matching paths |
| `excludePaths` | `[]` | Exclude matching paths |
| `deniedPathSegments` | built-in list | Block terminal or destructive endpoints |
| `minCanActions` | `1` | Minimum proven actions before a page is considered low-signal |
| `minInteractiveElements` | `3` | Minimum interactive elements before a page is considered low-signal |

## Scope Modes

### `site`

Crawl across the whole current origin.

### `subtree`

Stay inside the starting path and its descendants.

Start page:

```text
/pages/stb/kod
```

Allowed:

- `/ua/serials/stb/kod`
- `/ua/serials/stb/kod/2026`
- `/ua/serials/stb/kod/2025/seriya-12`

Blocked:

- `/ua/serials`
- `/ua/show`
- `/ua/person/...`

### `section`

Softer boundary than `subtree`: keep the same scope root, its descendants, and closely related slug variations.

## Notes

- same-origin only
- visited pages are tracked through the state manager
- dead loops are stopped
- next targets are discovered from links and research navigation
- low-signal pages can be skipped

## Related Docs

- [commands.md](./commands.md) - terminal command reference
- [configuration.md](./configuration.md) - main Explorbot configuration
- [researcher.md](./researcher.md) - researcher behavior
