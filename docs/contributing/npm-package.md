# Building and Publishing the npm Package

Explorbot develops on Bun but ships to npm as a Node.js-compatible package. This page covers how the build works and how to publish it.

## Prerequisites

- Bun (for development and running the build)
- Node.js >= 18 (for verifying the build output)
- npm account with publish access to `explorbot` package

## How the Build Works

The source is TypeScript with `.ts` imports (enabled by `allowImportingTsExtensions` in `tsconfig.json`). Bun runs these natively, but Node.js needs compiled `.js` files.

The build runs the TypeScript compiler (`tsc`) with a dedicated `tsconfig.build.json`:

1. **TypeScript compilation** - Compiles `src/`, `bin/`, and `boat/` to `dist/`, preserving the directory structure.
2. **Import rewriting** - `rewriteRelativeImportExtensions` rewrites `.ts` imports to `.js` in the output (a TypeScript 5.7+ feature).
3. **Type declarations** - `scripts/build-types.ts` emits `.d.ts` files for the library API (see [Type Declarations](#type-declarations)).
4. **Asset copying** - Copies `rules/` and `assets/sample-files/` into `dist/` so runtime path resolution works.
5. **Shebang replacement** - Replaces `#!/usr/bin/env bun` with `#!/usr/bin/env node` in the CLI entry point.

### Build Configuration

**`tsconfig.build.json`** extends the base `tsconfig.json` with:

| Option | Value | Purpose |
|--------|-------|---------|
| `noEmit` | `false` | Enable output (base config has `true`) |
| `outDir` | `dist` | Compilation output directory |
| `rewriteRelativeImportExtensions` | `true` | Rewrite `.ts` → `.js` in imports |
| `declaration` | `false` | The JS build emits no `.d.ts`; declarations are built separately (see below) |
| `sourceMap` | `true` | Source maps for debugging |
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
  "bin": { "explorbot": "./dist/bin/explorbot-cli.js" },
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/src/index.d.ts",
      "bun": "./src/index.ts",
      "import": "./dist/src/index.js"
    }
  },
  "files": ["dist/", "src/**/*.ts", "src/**/*.tsx", "..."],
  "engines": { "node": ">=24.0.0" }
}
```

Explorbot is both a CLI (`bin`) and a library (`exports`). The `.` entry point is `src/index.ts`, a side-effect-free barrel that re-exports the public API (`ExplorBot`, `Plan`, `Test`, and their types). The `exports` conditions are ordered so each consumer gets the right entry: `types` (the emitted `.d.ts`) for type-checking, `bun` (the TypeScript source) under Bun, and `import` (the compiled JS) under Node.js. This is why the source `src/**` files ship alongside `dist/`.

## Building Locally

```bash
# Build the npm package
bun run build:npm

# Verify the CLI works on Node.js
node dist/bin/explorbot-cli.js --help

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

## Known Limitations

- **Worker in `src/ai/researcher/cache.ts`** - Creates a Worker from a `.ts` URL, which is Bun-specific. This feature does not work on Node.js.
- **Type declarations are transform-generated** - Declarations come from a transformed copy of the source (see [Type Declarations](#type-declarations)), not from `tsc --declaration` directly, because the mixin-based agents can't emit declarations as written. The published `.d.ts` types are exact; the workaround only concerns how they're produced.

## CI/CD

The `test.yml` workflow verifies the npm build on every push. It runs `bun run build:npm`, then `node dist/bin/explorbot-cli.js --help` across Node.js 18, 20, 22, and 24.

The `publish.yml` workflow publishes to npm when you push a version tag (`v*`).
