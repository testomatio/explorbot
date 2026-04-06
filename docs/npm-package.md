# Building and Publishing the npm Package

Explorbot uses Bun as its development runtime but is published to npm as a Node.js-compatible package. This document explains how the build works and how to publish.

## Prerequisites

- Bun (for development and running the build)
- Node.js >= 18 (for verifying the build output)
- npm account with publish access to `explorbot` package

## How the Build Works

The source code is written in TypeScript with `.ts` imports (enabled by `allowImportingTsExtensions` in `tsconfig.json`). Bun runs these natively, but Node.js requires compiled `.js` files.

The build uses TypeScript compiler (`tsc`) with a dedicated `tsconfig.build.json`:

1. **TypeScript compilation** - Compiles `src/`, `bin/`, and `boat/` to `dist/` preserving the directory structure
2. **Import rewriting** - `rewriteRelativeImportExtensions` rewrites `.ts` imports to `.js` in the output (TypeScript 5.7+ feature)
3. **Asset copying** - Copies `rules/`, `assets/sample-files/`, and `prompts/` into `dist/` so runtime path resolution works
4. **Shebang replacement** - Replaces `#!/usr/bin/env bun` with `#!/usr/bin/env node` in the CLI entry point

### Build Configuration

**`tsconfig.build.json`** extends the base `tsconfig.json` with:

| Option | Value | Purpose |
|--------|-------|---------|
| `noEmit` | `false` | Enable output (base config has `true`) |
| `outDir` | `dist` | Compilation output directory |
| `rewriteRelativeImportExtensions` | `true` | Rewrite `.ts` → `.js` in imports |
| `declaration` | `false` | No `.d.ts` files (CLI tool, not library) |
| `sourceMap` | `true` | Source maps for debugging |
| `skipLibCheck` | `true` | Skip type checking of dependencies |

Type checking is skipped during build (`--noCheck` flag) because Bun is more permissive than `tsc` strict mode. Type safety is enforced by Bun during development.

### Package Structure

After building, the npm package contains:

```
dist/
├── bin/explorbot-cli.js    # CLI entry point (#!/usr/bin/env node)
├── src/                    # Compiled application code
├── boat/                   # Compiled API tester module
├── rules/                  # Agent rule files (markdown)
├── assets/sample-files/    # Sample files for testing
└── prompts/                # Prompt templates
```

Key `package.json` fields:

```json
{
  "bin": { "explorbot": "./dist/bin/explorbot-cli.js" },
  "main": "dist/src/index.js",
  "files": ["dist/", "rules/", "assets/sample-files/", "prompts/"],
  "engines": { "node": ">=18.0.0" }
}
```

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

Publishing is automated via GitHub Actions (see below), but can also be done manually:

```bash
# Bump version
npm version patch  # or minor, major

# Build and publish (prepublishOnly runs build:npm automatically)
npm publish
```

## Known Limitations

- **Worker in `src/ai/researcher/cache.ts`** - Creates a Worker with a `.ts` URL, which is Bun-specific. This feature won't work on Node.js.
- **No type declarations** - The package doesn't ship `.d.ts` files since it's a CLI tool, not a library.

## CI/CD

The `test.yml` workflow verifies the npm build on every push by running `bun run build:npm` followed by `node dist/bin/explorbot-cli.js --help` across Node.js 18, 20, 22, and 24.

The `publish.yml` workflow automatically publishes to npm when a version tag (`v*`) is pushed.
