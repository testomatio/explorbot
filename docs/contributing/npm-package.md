# Building and Publishing the npm Package

Explorbot develops on Bun but ships to npm as a Node.js-compatible package. This page covers how the build works and how to publish it.

## Prerequisites

- Bun (for development and running the build)
- Node.js >= 24 (for verifying the build output)
- npm account with publish access to `explorbot` package

## How the Build Works

The source is TypeScript with `.ts` imports (enabled by `allowImportingTsExtensions` in `tsconfig.json`). Bun runs these natively, but Node.js needs compiled `.js` files.

The build runs the TypeScript compiler (`tsc`) with a dedicated `tsconfig.build.json`:

1. **TypeScript compilation** - Compiles `src/`, `bin/`, and `boat/` to `dist/`, preserving the directory structure.
2. **Import rewriting** - `rewriteRelativeImportExtensions` rewrites `.ts` imports to `.js` in the output (a TypeScript 5.7+ feature).
3. **Asset copying** - Copies `rules/` and `assets/sample-files/` into `dist/` so runtime path resolution works.
4. **Shebang replacement** - Replaces `#!/usr/bin/env bun` with `#!/usr/bin/env node` in the CLI entry point.

### Build Configuration

**`tsconfig.build.json`** extends the base `tsconfig.json` with:

| Option | Value | Purpose |
|--------|-------|---------|
| `noEmit` | `false` | Enable output (base config has `true`) |
| `outDir` | `dist` | Compilation output directory |
| `rewriteRelativeImportExtensions` | `true` | Rewrite `.ts` → `.js` in imports |
| `declaration` | `false` | No `.d.ts` files (CLI tool, not library) |
| `sourceMap` | `false` | No source maps in the published package |
| `skipLibCheck` | `true` | Skip type checking of dependencies |

The build skips type checking (`--noCheck` flag) because Bun is more permissive than `tsc` strict mode. Bun enforces type safety during development.

### Package Structure

After the build, the npm package contains:

```
dist/
├── bin/explorbot-cli.js    # CLI entry point (#!/usr/bin/env node)
├── src/                    # Compiled application code
├── boat/                   # Compiled API tester module
├── rules/                  # Agent rule files (markdown)
└── assets/sample-files/    # Sample files for testing
```

Key `package.json` fields:

```json
{
  "bin": { "explorbot": "./dist/bin/explorbot-cli.js" },
  "main": "dist/src/index.js",
  "files": [
    "dist/",
    "src/**/*.ts",
    "src/**/*.tsx",
    "bin/**/*.ts",
    "boat/api-tester/src/**/*.ts",
    "boat/doc-collector/src/**/*.ts",
    "boat/doc-collector/bin/**/*.ts",
    "boat/doc-collector/package.json",
    "rules/",
    "assets/sample-files/"
  ],
  "engines": { "node": ">=24.0.0" }
}
```

Besides `dist/`, the package ships the raw TypeScript sources — Bun resolves them directly via the `bun` condition in `exports`.

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

- **No type declarations** - The package ships no `.d.ts` files, since it is a CLI tool, not a library.

## CI/CD

The `test.yml` workflow verifies the npm build on every push. On Node.js 24 it runs `bun run build:npm`, then the Node smoke tests: `node --test tests/node/*.mjs`. The `publish.yml` workflow additionally checks `node dist/bin/explorbot-cli.js --help` before publishing.

The `publish.yml` workflow publishes to npm when you push a version tag (`v*` or a bare `1.2.3`-style tag). It overwrites the package version from the tag; tags containing `beta`, `alpha`, `pre`, or `rc` publish to the `beta` dist-tag instead of `latest`.
