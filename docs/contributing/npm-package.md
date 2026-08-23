# Building and Publishing the npm Package

Explorbot develops on Bun but ships to npm as a Node.js-compatible package. This page covers how the build works and how to publish it.

## Prerequisites

- Bun (for development and running the build)
- Node.js >= 24 (for verifying the build output)
- npm account with publish access to `explorbot` and `prima-cli`, for publishing by hand; releases go out over OIDC (see [Trusted Publishing and Provenance](#trusted-publishing-and-provenance))

## How the Build Works

The source is TypeScript with `.ts` imports (enabled by `allowImportingTsExtensions` in `tsconfig.json`). Bun runs these natively, but Node.js needs compiled `.js` files.

The build runs the TypeScript compiler (`tsc`) with a dedicated `tsconfig.build.json`:

1. **TypeScript compilation** - Compiles `src/`, `bin/`, and `boat/` to `dist/`, preserving the directory structure.
2. **Import rewriting** - `rewriteRelativeImportExtensions` rewrites `.ts` imports to `.js` in the output (a TypeScript 5.7+ feature).
3. **Type declarations** - `scripts/build-types.ts` emits `.d.ts` files for the library API (see [Type Declarations](#type-declarations)).
4. **Asset copying** - Copies `rules/` and `assets/sample-files/` into `dist/` so runtime path resolution works.
5. **Shebang replacement** - Replaces `#!/usr/bin/env bun` with `#!/usr/bin/env node` in every CLI entry point declared in `bin`: `dist/bin/explorbot-cli.js` and `dist/boat/prima/bin/prima-cli.js`.

### Build Configuration

**`tsconfig.build.json`** extends the base `tsconfig.json` with:

| Option | Value | Purpose |
|--------|-------|---------|
| `noEmit` | `false` | Enable output (base config has `true`) |
| `outDir` | `dist` | Compilation output directory |
| `rewriteRelativeImportExtensions` | `true` | Rewrite `.ts` → `.js` in imports |
| `declaration` | `false` | The JS build emits no `.d.ts`; declarations are built separately (see below) |
| `sourceMap` | `false` | No source maps in the published package |
| `skipLibCheck` | `true` | Skip type checking of dependencies |

The build skips type checking (`--noCheck` flag) because Bun is more permissive than `tsc` strict mode. Bun enforces type safety during development.

### Package Structure

After the build, the npm package contains:

```
dist/
├── bin/explorbot-cli.js    # CLI entry point (#!/usr/bin/env node)
├── src/                    # Compiled application code (.js) + type declarations (.d.ts)
│   ├── index.js            # Library entry point
│   └── index.d.ts          # Library type declarations
├── boat/                   # Compiled API tester module
├── rules/                  # Agent rule files (markdown)
└── assets/sample-files/    # Sample files for testing
```

### Type Declarations

`declaration: true` doesn't work directly on this codebase: the Researcher agent is built from generic mixin factories (`WithDeepAnalysis(Base)` etc.) that return anonymous classes with `private` members, which TypeScript can't serialize into a `.d.ts` (`TS4094`). Rather than refactor those hot-path agents, `scripts/build-types.ts` generates declarations from a transformed copy of the source:

1. Copies `src/` into a temporary tree, rewriting every `private`/`protected` class modifier to `public` at its exact AST position (members are preserved; only the visibility keyword changes, which removes `TS4094`).
2. Runs `tsc --emitDeclarationOnly` over the copy into `dist/src/`.
3. Rewrites `.ts`/`.tsx` module specifiers to `.js` in the emitted `.d.ts` so they resolve for consumers.
4. Deletes the temporary tree.

The transform touches only the intermediate copy — the shipped `.js` keeps its real `private`/`protected` visibility. The `.d.ts` types are exact (unions, option shapes, and return types are all preserved), so Node.js/TypeScript consumers get full type-checking. Bun consumers resolve the TypeScript source directly via the `bun` export condition.

Key `package.json` fields:

```json
{
  "bin": {
    "explorbot": "./dist/bin/explorbot-cli.js",
    "prima": "./dist/boat/prima/bin/prima-cli.js"
  },
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "bun": "./src/index.ts",
      "import": "./dist/src/index.js"
    }
  },
  "files": [
    "dist/",
    "src/**/*.ts",
    "src/**/*.tsx",
    "bin/**/*.ts",
    "boat/api-tester/src/**/*.ts",
    "boat/doc-collector/src/**/*.ts",
    "boat/doc-collector/bin/**/*.ts",
    "boat/doc-collector/package.json",
    "boat/prima/src/**/*.ts",
    "boat/prima/bin/**/*.ts",
    "boat/prima/package.json",
    "boat/prima/README.md",
    "rules/",
    "assets/sample-files/",
    "models.json"
  ],
  "engines": { "node": ">=24.0.0" }
}
```

The package ships two commands, `explorbot` and `prima` for the [prima boat](../reference/commands.md#prima-boat). Prima is also mounted as a subcommand, so `npx explorbot prima <command>`, `npx -p explorbot prima <command>` and the standalone [`prima-cli`](#publishing-prima-cli) package all reach the same code.

Explorbot is both a CLI (`bin`) and a library (`exports`). The `.` entry point is `src/index.ts`, a side-effect-free barrel that re-exports the public API (`ExplorBot`, `Plan`, `Test`, and their types). The `exports` conditions are ordered so each consumer gets the right entry: `types` (the emitted `.d.ts`) for type-checking, `bun` (the TypeScript source) under Bun, and `import` (the compiled JS) under Node.js. This is why the source `src/**` files ship alongside `dist/`.

## Building Locally

```bash
# Build the npm package
bun run build:npm

# Verify the CLIs work on Node.js
node dist/bin/explorbot-cli.js --help
node dist/boat/prima/bin/prima-cli.js --help

# Check what would be published
npm pack --dry-run
```

## Publishing

GitHub Actions publishes automatically (see below), but you can also publish manually:

```bash
# Bump version
npm version patch  # or minor, major

# Build and publish (prepublishOnly runs build:npm automatically)
npm publish
```

## Publishing prima-cli

Prima ships three ways, all the same code:

| | |
|---|---|
| `npx prima-cli` | its own package |
| `npx explorbot prima` | subcommand of the explorbot CLI |
| `npx -p explorbot prima` | the `prima` bin explorbot installs |

Prima is compiled into `dist/` by the same `tsc` run as everything else; only the packaging differs. `bun run build:prima` (`scripts/build-prima-npm.ts`) runs after `build:npm` and stages a second package:

```
dist-prima/
├── package.json            # boat/prima/package.json + version and dependencies from the root manifest
├── README.md               # boat/prima/README.md, the npm page
└── dist/
    ├── boat/prima/
    ├── src/
    ├── models.json
    ├── rules/
    └── assets/sample-files/
```

The `dist/` layout is copied, not flattened: `config.js` reads `../models.json`, `rules-loader.js` reads `../../rules`, and `tester.js` reads `../../assets/sample-files`. Dependencies are copied verbatim from the root manifest rather than pruned to prima's closure — pruning saves little next to playwright and codeceptjs, and breaks on the first moved import. Edit `boat/prima/package.json` for the package name, bin, keywords or engines.

`publish-prima.yml` publishes it when a GitHub release is **published**, so a draft ships nothing. The version is the release tag with `prima-` and a leading `v` stripped: `0.2.6`, `v0.2.6` and `prima-v0.2.6` all publish `prima-cli@0.2.6`. A `prima-v*` tag is how prima ships on its own — `publish.yml` ignores it. A pre-release release, or a version containing `beta`, `alpha`, `pre` or `rc`, goes to the `beta` dist-tag.

Before publishing, the workflow packs the staged package, installs the tarball into an empty directory and runs it there with an empty `HOME` — a real consumer install, which is what catches a missing file, dependency or asset. It skips a version already on the registry, so a failed run can be re-run.

To check it locally:

```bash
bun run build:npm && bun run build:prima
npm pack ./dist-prima --pack-destination /tmp
cd $(mktemp -d) && npm init -y && npm install --ignore-scripts /tmp/prima-cli-*.tgz
./node_modules/.bin/prima-cli --help
```

## Trusted Publishing and Provenance

Both packages publish over OIDC, with no npm token in the repository. npm checks GitHub's identity token against a trusted publisher registered on the package, then attaches a provenance attestation. No `--provenance` flag is needed; trusted publishing does it.

The workflows are already set up for this: `id-token: write`, `ubuntu-latest`, and `npm@latest` for the npm 11.5.1+ requirement. The rest is per package on npmjs.com, because a trusted publisher names one package and one workflow file — `explorbot`'s does not cover `prima-cli`. The package has to exist before it can be configured, which is why a new one is claimed with a manual publish first.

On the package's **Settings** tab, under **Trusted Publisher**, choose **GitHub Actions**:

| Field | `explorbot` | `prima-cli` |
|---|---|---|
| Organization or user | `testomatio` | `testomatio` |
| Repository | `explorbot` | `explorbot` |
| Workflow filename | `publish.yml` | `publish-prima.yml` |
| Allowed actions | `npm publish` | `npm publish` |
| Environment name | empty | empty |

The workflow filename is a basename, and it is the field that differs — pointing `prima-cli` at `publish.yml` fails every release. Leave the environment empty unless the publish job gains an `environment:` key; a mismatch fails the publish.

To check a publish was attested:

```bash
npm view <package>@<version> dist.attestations
```

A `slsa.dev/provenance/v1` predicate means it worked. Nothing printed means the version went out unattested. `npm audit signatures` checks an installed tree.

Once no workflow needs a token, revoke the package's automation tokens and set its publishing access to require two-factor authentication and disallow tokens.

## Known Limitations

- **Type declarations are transform-generated** - Declarations come from a transformed copy of the source (see [Type Declarations](#type-declarations)), not from `tsc --declaration` directly, because the mixin-based agents can't emit declarations as written. The published `.d.ts` types are exact; the workaround only concerns how they're produced.

## CI/CD

The `test.yml` workflow verifies the npm build on every push. On Node.js 24 it runs `bun run build:npm`, then the Node smoke tests: `node --test tests/node/*.mjs`. The `publish.yml` workflow additionally checks `node dist/bin/explorbot-cli.js --help` before publishing.

The `publish.yml` workflow publishes `explorbot` when you push a version tag (`v*` or a bare `1.2.3`-style tag). It overwrites the package version from the tag; tags containing `beta`, `alpha`, `pre`, or `rc` publish to the `beta` dist-tag instead of `latest`. `publish-prima.yml` publishes `prima-cli` when a GitHub release is published. Both go out over OIDC and with provenance — see [Publishing prima-cli](#publishing-prima-cli) and [Trusted Publishing and Provenance](#trusted-publishing-and-provenance).
