---
name: code-audit
description: Regular code maintenance pass for Explorbot — removes unused imports/params/locals and dead code, simplifies combined types, orders exports before private helpers, converts function-valued consts to hoisted declarations, and turns loose function groups into classes. Use when asked for code cleanup, maintenance, lint debt, "unused params", or a periodic code audit. Prompts are out of scope — use prompt-audit for those.
user_invocable: true
---

# Code audit

Periodic structural cleanup of TypeScript sources. Behavior must not change: every fix is a removal, a move or a reshape.

## Arguments

- `/code-audit` — whole repo (`src`, `bin`, `boat`)
- `/code-audit src/ai` — one area. Prefer this: a full run yields hundreds of findings; work area by area, one commit each.

## Step 1: Baseline

Record what is broken before touching anything, so pre-existing failures are not blamed on the audit:

```bash
bun test tests/unit 2>&1 | grep -E '^\(fail\)' > $SCRATCHPAD/baseline-fails.txt
bunx tsc --noEmit -p . 2>&1 | grep 'error TS' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort > $SCRATCHPAD/baseline-tsc.txt
```

`$SCRATCHPAD` stands for the session scratchpad directory. Never `git stash` (shared across worktrees).

## Step 2: Detect

```bash
bun .claude/skills/code-audit/structure-check.ts [paths] [--check=unused,order,hoisting,types,combined-types,loose-functions]
```

Only git-tracked files are scanned. `biome lint` does not report unused code in this repo — the `unused` check runs `tsc --noUnusedLocals --noUnusedParameters`.

## Step 3: Fix, by check

### unused
- Imports: `bunx biome lint --only=correctness/noUnusedImports --write --unsafe <paths>`, then restore every `import React from 'react'` it removed (CLAUDE.md forbids removing it) and revert `explorbot.config.example.ts` (its imports are alternatives for users).
- Unused destructured callback/tuple items: drop the name (`([, value])`, `async () =>`). Do not prefix with `_` unless a later positional arg is needed.
- Unused binding with a side-effecting initializer (`new Reporter()`, `await race(...)`, `startNote()`): keep the call, drop the binding.
- Unused param: remove it from the signature **and every caller**. Re-run the check — callers often expose a new unused variable; follow the chain to its end.
- Tool `execute({ ... })`: only drop the unread name from the destructuring. Never touch `inputSchema` — it is prompt text the model reads.
- Never use replace-all on a pattern like `({ reason })` — the same text appears in tools that do read it. Edit each site.
- Field written but never read, function never called: delete it with its assignments.

### order
Exported classes/functions first, private module-level helpers below them. Move the helper; do not rename or rewrite it.

### hoisting
Module-level `const fn = (...) => {}` becomes `function fn(...) {}` so it can live below its callers. Skip consts that capture closure state at module load or are reassigned, and React components declared as `const X: React.FC`.

### types
Interfaces and type aliases go at the end of the file. Exported types stay exported — only position changes.

### combined-types
- Intersection of 3+ types, union of object literals: check the class hierarchy first — a subtype already satisfies its supertype, narrow with `instanceof`. No new union types.
- Same inline object type repeated in one file: name it once at the end of the file. If it crosses modules, it is a module-to-module contract — an interface is allowed; otherwise keep it local.
- Do not introduce types for data used inside one module only.

### loose-functions
A file of exported functions doing the same kind of work (a transport, a converter, a store) becomes a class; modules playing the same role share a base class. Unrelated utilities in `src/utils/` stay functions — report, don't force.

## Step 4: Stop and ask

Do not remove on your own — list these in the report and ask:
- Dead chains crossing 3+ files or reaching a public export (`src/index.ts`, package API).
- A param whose removal would make a tool input field unused.
- Whole files that became unreferenced.
- Anything in `src/ai/` prompts, `rules/`, tool descriptions — that is prompt-audit's domain and needs approved wording.

## Step 5: Verify

```bash
bun run format && bun run lint
bunx tsc --noEmit -p . 2>&1 | grep 'error TS' | sed -E 's/\([0-9]+,[0-9]+\)//' | sort | diff $SCRATCHPAD/baseline-tsc.txt -
bun test tests/unit
bun test tests/integration
```

- The tsc diff must show no new lines in tracked files (ignore `dist*/` and `node_modules`).
- Test failures must match `baseline-fails.txt` exactly.
- Run the `code-duplication-detector` agent on the diff.

## Step 6: Report

- Counts per check: fixed / skipped.
- Removed dead chains, one line each (`Planner.plan(completedPlans)` — plumbed from ExploreCommand, never read).
- Step 4 questions.
- Test result vs baseline.

Do not commit unless asked. When committing, run `/changelog` first.
