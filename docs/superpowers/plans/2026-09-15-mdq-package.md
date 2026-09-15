# mdq Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `src/utils/markdown-query.ts` into `src/utils/mdq/` as a publish-ready package that can both query and update markdown, then add a jq-like CLI.

**Architecture:** Two classes in two files. `query.ts` owns the selector grammar, the token index, `MarkdownDoc` and `Selection`. `edit.ts` holds pure functions that take source text plus ranges and return new source text; it imports types from `query.ts` type-only and never touches a class value, which keeps the split acyclic. Reads narrow to a `Selection`; writes return a `MarkdownDoc`, so edits chain.

**Tech Stack:** TypeScript, Bun, `marked` ^16.2.0 (markdown), `yaml` ^2.8.3 (frontmatter), `vitest` API via `bun test`, Commander (CLI only).

**Spec:** `docs/superpowers/specs/2026-09-14-mdq-package-design.md`

## Global Constraints

- **Two dependencies only.** `marked` and `yaml`. No imports from anywhere else in explorbot — not `src/utils/`, not `src/commands/`, nothing. This is what makes the package extractable.
- **Repo style rules** (from `CLAUDE.md`, all enforced in review):
  - No comments unless explicitly requested.
  - No ternaries. No `...(cond ? {k:v} : {})` spread.
  - Prefer early return over `if/else`.
  - Types and interfaces at the **end** of the file.
  - Private methods after public methods.
  - Use `?.` rather than chained `&&`.
- `bun run format` after each code change; `bun run lint:fix` after each task.
- **Never run the regression workflow** and never add the `regression` label.
- Bun only. Never Node.

## Baseline facts (measured 2026-09-15, do not re-derive)

- `bun test tests/unit/markdown-query.test.ts` → **110 pass, 0 fail**. This suite is the regression net for all 54 call sites; it must stay green at every task boundary.
- `bunx tsc -p tsconfig.json --noEmit` → **1004 errors repo-wide**. A clean `tsc` is not achievable and is not the goal. Only the scoped check in Task 3 matters.
- Of those 1004, the files this plan touches own exactly **2**, both pre-existing and unrelated to mdq:
  ```
  src/ai/researcher/locators.ts(247,41): error TS2339: Property 'playwrightLocatorCount' does not exist on type 'Explorer'.
  src/ai/researcher/locators.ts(247,65): error TS7006: Parameter 'page' implicitly has an 'any' type.
  ```
  These two are the expected output of the Task 3 scoped check. **Three or more means the migration is incomplete.**
- CI runs `tsc` with `--noCheck`. A green CI proves nothing about types here.

## File Structure

| File | Responsibility |
|---|---|
| `src/utils/mdq/query.ts` | Selector grammar, token index (frontmatter-aware), `MarkdownDoc`, `Selection`, sugar layer, error classes |
| `src/utils/mdq/edit.ts` | Pure edits over `(source, ranges)`: splicing, whitespace normalization, table/list renderers, entry and frontmatter rewriting |
| `src/utils/mdq/cli.ts` | CLI argument handling and output formatting (Task 10) |
| `src/utils/mdq/README.md` | Public documentation (Task 9) |
| `src/utils/markdown-query.ts` | Re-export shim so all 54 existing call sites keep working |
| `bin/mdq.ts` | Thin CLI entry delegating to `cli.ts` (Task 10) |
| `tests/unit/mdq/*.test.ts` | Test suites, one per concern |

---

### Task 1: Scaffold the package with a frontmatter-aware token index

Move the parser to its new home and teach it the one thing it gets wrong today: a leading `---` block is frontmatter, not a setext heading.

**Files:**
- Create: `src/utils/mdq/query.ts`
- Create: `src/utils/mdq/edit.ts`
- Create: `tests/unit/mdq/frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `buildTokenIndex(source: string): MatchedRange[]` — ranges are absolute offsets into `source`, frontmatter excluded
  - `splitFrontmatter(source: string): { raw: string; body: string; offset: number }`
  - `interface MatchedRange { token: Token; start: number; length: number; trailing?: { start: number; length: number }; innerTokens?: MatchedRange[] }`

The `trailing` field is new and load-bearing: `marked` emits `space` tokens as siblings (a `paragraph` raw is `"para"` with no newline, followed by a separate `space` raw of `"\n\n"`), so every write verb needs to know where a node's separator lives.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mdq/frontmatter.test.ts
import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../../../src/utils/mdq/edit.ts';
import { buildTokenIndex } from '../../../src/utils/mdq/query.ts';

describe('splitFrontmatter', () => {
  it('splits a leading yaml block from the body', () => {
    const src = '---\nurl: /login\nwait: 1000\n---\n\n# Title\n';
    const fm = splitFrontmatter(src);
    expect(fm.raw).toBe('url: /login\nwait: 1000');
    expect(fm.body).toBe('\n# Title\n');
    expect(fm.offset).toBe(src.length - fm.body.length);
  });

  it('returns no frontmatter when the document does not open with ---', () => {
    const fm = splitFrontmatter('# Title\n\n---\n');
    expect(fm.raw).toBe('');
    expect(fm.offset).toBe(0);
  });

  it('treats an unterminated --- as body, not frontmatter', () => {
    const fm = splitFrontmatter('---\nnot closed\n');
    expect(fm.raw).toBe('');
    expect(fm.offset).toBe(0);
  });
});

describe('buildTokenIndex', () => {
  it('excludes frontmatter so it is never lexed as a setext heading', () => {
    const ranges = buildTokenIndex('---\nurl: /login\n---\n\n# Title\n');
    expect(ranges.filter((r) => r.token.type === 'heading')).toHaveLength(1);
    expect(ranges.every((r) => r.start >= 20)).toBe(true);
  });

  it('keeps offsets absolute so slicing the original source works', () => {
    const src = '---\nurl: /x\n---\n\n# Title\n';
    const ranges = buildTokenIndex(src);
    const heading = ranges.find((r) => r.token.type === 'heading');
    expect(src.slice(heading.start, heading.start + heading.length)).toBe('# Title\n');
  });

  it('records the trailing space token of a paragraph', () => {
    const src = 'para\n\n# Next\n';
    const ranges = buildTokenIndex(src);
    const para = ranges.find((r) => r.token.type === 'paragraph');
    expect(para.length).toBe(4);
    expect(para.trailing).toEqual({ start: 4, length: 2 });
  });

  it('leaves trailing undefined for a node with no following space', () => {
    const ranges = buildTokenIndex('# Only\n');
    expect(ranges[0].trailing).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/frontmatter.test.ts`
Expected: FAIL — cannot resolve `src/utils/mdq/query.ts`

- [ ] **Step 3: Create query.ts with the index**

Copy `src/utils/markdown-query.ts` to `src/utils/mdq/query.ts` verbatim first, then apply these three changes.

Create `src/utils/mdq/edit.ts` holding the frontmatter grammar. It lives here from the
start so that later tasks add to this file rather than moving code between the two —
`query.ts` imports the value, `edit.ts` only ever imports types back, so the split stays
acyclic:

```ts
export function splitFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith('---')) return { raw: '', body: source, offset: 0 };
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { raw: '', body: source, offset: 0 };
  return { raw: match[1], body: source.slice(match[0].length), offset: match[0].length };
}
```

Replace the body of `buildTokenIndex`:

```ts
export function buildTokenIndex(source: string): MatchedRange[] {
  const { body, offset } = splitFrontmatter(source);
  const tokens = marked.lexer(body);
  const ranges: MatchedRange[] = [];
  let cursor = offset;

  for (const token of tokens) {
    const raw = (token as any).raw || '';
    if (token.type === 'space') {
      const previous = ranges[ranges.length - 1];
      if (previous) previous.trailing = { start: cursor, length: raw.length };
      cursor += raw.length;
      continue;
    }
    ranges.push({ token, start: cursor, length: raw.length });
    cursor += raw.length;
  }

  return ranges;
}
```

Note this also stops `space` tokens from appearing as matchable ranges, which they never should have been.

`query.ts` imports it and re-exports for convenience:

```ts
import { splitFrontmatter } from './edit.ts';

export { splitFrontmatter };
```

Add to the type block at the **end** of `edit.ts`:

```ts
export interface FrontmatterSplit {
  raw: string;
  body: string;
  offset: number;
}
```

and extend the existing `MatchedRange` at the end of `query.ts`:

```ts
export interface MatchedRange {
  token: Token;
  start: number;
  length: number;
  trailing?: { start: number; length: number };
  innerTokens?: MatchedRange[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mdq/frontmatter.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Format, lint and commit**

```bash
bun run format && bun run lint:fix
git add src/utils/mdq/query.ts src/utils/mdq/edit.ts tests/unit/mdq/frontmatter.test.ts
git commit -m "feat(mdq): frontmatter-aware token index"
```

---

### Task 2: Port the public API behind a shim, behaviour unchanged

Get every existing call site running against the new file with **zero behaviour change**. Writes still return `string` here — flipping them is Task 3. This task is the safety net for everything after it.

**Files:**
- Modify: `src/utils/mdq/query.ts`
- Modify: `src/utils/markdown-query.ts` (becomes a shim)
- Create: `tests/unit/mdq/query.test.ts` (moved from `tests/unit/markdown-query.test.ts`)
- Delete: `tests/unit/markdown-query.test.ts`

**Interfaces:**
- Consumes: `buildTokenIndex`, `splitFrontmatter`, `MatchedRange` from Task 1
- Produces: `mdq(source: string): MarkdownQuery`, class `MarkdownQuery`, `parseQuery`, all existing methods unchanged

- [ ] **Step 1: Move the test file and repoint its import**

```bash
git mv tests/unit/markdown-query.test.ts tests/unit/mdq/query.test.ts
```

Change line 2 of the moved file from:

```ts
import { mdq, parseQuery } from '../../src/utils/markdown-query.ts';
```

to:

```ts
import { mdq, parseQuery } from '../../../src/utils/mdq/query.ts';
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `bun test tests/unit/mdq/query.test.ts`
Expected: FAIL — `mdq` / `parseQuery` are not yet exported from `query.ts`, or section tests fail because `expandSectionRanges` still assumes `space` tokens are present

- [ ] **Step 3: Restore the full API in query.ts**

Everything from the original `markdown-query.ts` below `buildTokenIndex` — `matchText`, `entryKey`, `getTokenText`, `getHeadingDepth`, `isSectionSelector`, `getSectionDepth`, `selectorToTokenType`, `computeSections`, `extractListItems`, `applyIndexSlice`, `expandSectionRanges`, `executeSegments`, `class MarkdownQuery`, `mdq` — carries over unchanged, except:

`computeSections` must extend a section's range to include the last inner node's trailing space, since `space` tokens are no longer separate ranges:

```ts
for (let j = i + 1; j < candidates.length; j++) {
  const nextRange = candidates[j];
  if (nextRange.token.type === 'heading' && (nextRange.token as Tokens.Heading).depth <= depth) break;
  innerTokens.push(nextRange);
  endOffset = nextRange.start + nextRange.length;
  if (nextRange.trailing) endOffset = nextRange.trailing.start + nextRange.trailing.length;
}
```

Move every `export interface` / `export type` to the end of the file, and replace the ternaries at the original lines 30, 34, 129-130 and 295 with early returns.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `bun test tests/unit/mdq/query.test.ts`
Expected: PASS — **110 tests**, the same count as before the move

- [ ] **Step 5: Replace markdown-query.ts with a shim**

```ts
export * from './mdq/query.ts';
```

- [ ] **Step 6: Verify every existing call site still works**

Run: `bun test tests/unit/`
Expected: PASS, no new failures versus the pre-task run

- [ ] **Step 7: Format, lint and commit**

```bash
bun run format && bun run lint:fix
git add -A src/utils tests/unit
git commit -m "refactor(mdq): move markdown-query into src/utils/mdq behind a shim"
```

---

### Task 3: Flip write verbs to return MarkdownDoc and migrate every call site

The one risky task. It ends with the repo green and every break fixed.

**Files:**
- Modify: `src/utils/mdq/query.ts`
- Modify: `src/experience-tracker.ts:265`, `:289`
- Modify: `src/ai/planner.ts:304`, `:322`
- Modify: `src/ai/researcher/deep-analysis.ts:129`
- Modify: `src/ai/researcher/locators.ts:307`, `:309`
- Modify: `src/ai/researcher/pagination.ts:61`
- Modify: `src/ai/researcher/research-result.ts:56`, `:57`, `:58`
- Modify: `src/ai/researcher.ts:316`
- Modify: `tests/unit/mdq/query.test.ts`

**Interfaces:**
- Consumes: `MarkdownQuery`, `mdq` from Task 2
- Produces:
  - `class MarkdownDoc` — `query()`, `toString()`, `valueOf()`
  - `class Selection` — all reads, plus writes returning `MarkdownDoc`
  - `type Markdown = string | MarkdownDoc`
  - `mdq(source: Markdown): MarkdownDoc`
  - Deprecated alias `MarkdownQuery = Selection`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/mdq/query.test.ts
describe('MarkdownDoc chaining', () => {
  const md = '# T\n\n## A\n\npara\n\n## B\n\nother\n';

  it('returns a MarkdownDoc from a write so edits chain', () => {
    const out = mdq(md).query('h2("A")').replace('## Z\n\n').query('h2').count();
    expect(out).toBe(2);
  });

  it('stringifies to the full document', () => {
    expect(mdq(md).query('h2("A")').replace('## Z\n\n').toString()).toContain('## Z');
  });

  it('accepts a MarkdownDoc as a source', () => {
    const doc = mdq(md).query('h2("A")').replace('## Z\n\n');
    expect(mdq(doc).query('h2').count()).toBe(2);
  });

  it('accepts a MarkdownDoc returned from a replaceEach callback', () => {
    const out = mdq(md)
      .query('h2')
      .replaceEach((section) => mdq(section.text()).query('h2').replace('### x\n\n'))
      .toString();
    expect(out).toContain('### x');
    expect(out).not.toContain('## A');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/query.test.ts -t 'MarkdownDoc chaining'`
Expected: FAIL — `.query is not a function` on the string returned by `replace`

- [ ] **Step 3: Split MarkdownQuery into MarkdownDoc and Selection**

`MarkdownDoc` holds the source. `Selection` holds source plus matches. Every write on `Selection` ends by wrapping its result:

```ts
export class MarkdownDoc {
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  query(selector: string): Selection {
    const segments = parseQuery(selector);
    const candidates = expandSectionRanges(buildTokenIndex(this.source));
    return new Selection(this.source, executeSegments(candidates, segments));
  }

  toString(): string {
    return this.source;
  }

  valueOf(): string {
    return this.source;
  }
}
```

In `Selection`, each write returns `new MarkdownDoc(...)` instead of a raw string. `replaceEach` accepts `Markdown` back from its callback:

```ts
  replaceEach(replacer: (match: Selection, index: number) => Markdown): MarkdownDoc {
    // ... unchanged range logic ...
    const replacements = kept.map((range, index) => String(replacer(new Selection(this.source, [range]), index)));
    // ... unchanged splice loop ...
    return new MarkdownDoc(result);
  }
```

`mdq` accepts either:

```ts
export function mdq(source: Markdown): MarkdownDoc {
  return new MarkdownDoc(String(source));
}
```

`query` takes only a selector here. The optional second `matcher` argument arrives in
Task 5 — it is not missing.

At the end of the file:

```ts
export type Markdown = string | MarkdownDoc;

/** @deprecated Use Selection. */
export const MarkdownQuery = Selection;
```

Before relying on that alias, confirm nothing imports the class by name:

```bash
git grep -ln "MarkdownQuery" -- src bin boat tests
```

Expected: only `src/utils/mdq/query.ts`. Any other file needs its import checked.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mdq/query.test.ts -t 'MarkdownDoc chaining'`
Expected: PASS (4 tests)

- [ ] **Step 5: Fix the write assertions in the ported suite**

The existing `replace` tests assert against a string. Wrap each in `String(...)`, for example:

```ts
    it('should replace matched content', () => {
      const result = String(mdq(sampleMarkdown).query('heading("FAQ")').replace('## Questions\n'));
      expect(result).toContain('## Questions');
      expect(result).not.toContain('## FAQ');
    });
```

Apply the same to every assertion in the `replace`, `setKeyValue` and `edge cases` describes that compares a write result to a string.

Run: `bun test tests/unit/mdq/query.test.ts`
Expected: PASS — 114 tests

- [ ] **Step 6: Migrate the four breakage classes**

**(a) Assignment into a `string`-typed target** — append `.toString()`:

| File:line | Change |
|---|---|
| `src/experience-tracker.ts:265` | `content = sections[sections.length - 1].replace('').toString();` |
| `src/experience-tracker.ts:289` | `combined = mdq(combined).query('code').replace('').toString();` |
| `src/ai/researcher/deep-analysis.ts:129` | `updated = extQuery.replace(\`${existing}\n\n${sectionMarkdown}\n\`).toString();` |
| `src/ai/researcher/locators.ts:307` | `result.text = sectionQuery.query('blockquote[0]').setKeyValue('Container', \`'${newCss}'\`).toString();` |
| `src/ai/researcher/locators.ts:309` | `result.text = sectionQuery.query('blockquote[0]').replace('').toString();` |
| `src/ai/researcher/pagination.ts:61` | `result.text = sectionQuery.query('blockquote[0]').setKeyValue('Pagination', strategy).toString();` |
| `src/ai/researcher/research-result.ts:57` | `section.rawMarkdown = mdq(section.rawMarkdown).query('table').replace(\`${newTable.trimEnd()}\n\`).toString();` |

**(b) A string method called on the result:**

`src/ai/planner.ts:304`:
```ts
          const body = mdq(withoutHeadings).query('hr').replace('').toString().trim();
```

`src/ai/planner.ts:322`:
```ts
          const kept = mdq(section.text()).query('blockquote[10:]').replace('').toString();
```

**(c) Returned from a `replaceEach` callback** — `deep-analysis.ts:542` needs **no change**. The callback signature accepts `Markdown`.

**(d) Compared against a string — read this one carefully.** `research-result.ts:55-58` currently reads:

```ts
    const updated = sectionQuery.query('table').replace(`${newTable.trimEnd()}\n`);
    if (updated === this.text) return;
    section.rawMarkdown = mdq(section.rawMarkdown).query('table').replace(`${newTable.trimEnd()}\n`);
    this.text = updated;
```

`updated` is now a `MarkdownDoc`, so `updated === this.text` is **always false** — the guard silently stops firing and the method starts doing work it used to skip. Convert once, at the top:

```ts
    const updated = sectionQuery.query('table').replace(`${newTable.trimEnd()}\n`).toString();
    if (updated === this.text) return;
    section.rawMarkdown = mdq(section.rawMarkdown).query('table').replace(`${newTable.trimEnd()}\n`).toString();
    this.text = updated;
```

**Leave alone** — these already work because `mdq()` accepts a `MarkdownDoc`: `planner.ts:303`, `planner.ts:405`.

- [ ] **Step 7: Fix the one regex call site**

`src/ai/researcher.ts:316` relies on regex matching being implicitly case-insensitive. Task 4 removes that. Make the flag explicit now so the two changes never overlap:

```ts
      const summaryText = mdq(result.text).query('section2(/^summary/i)').query('paragraph[0]').text().trim();
```

- [ ] **Step 8: Verify with the scoped type check**

```bash
bunx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "^(src/utils/mdq/|src/utils/markdown-query|src/experience-tracker|src/ai/planner|src/ai/researcher)"
```

Expected: **exactly these two lines and nothing else.**

```
src/ai/researcher/locators.ts(247,41): error TS2339: Property 'playwrightLocatorCount' does not exist on type 'Explorer'.
src/ai/researcher/locators.ts(247,65): error TS7006: Parameter 'page' implicitly has an 'any' type.
```

Any third line is an unmigrated call site. Fix it before continuing — CI will not catch it, because CI runs `tsc --noCheck`.

- [ ] **Step 9: Run the full unit suite**

Run: `bun test tests/unit/`
Expected: PASS, no new failures

- [ ] **Step 10: Format, lint and commit**

```bash
bun run format && bun run lint:fix
git add -A src tests
git commit -m "feat(mdq): writes return MarkdownDoc so edits chain"
```

---

### Task 4: Selector additions — comment, html, honest regex flags, loud failures

Four grammar changes, all additive now that Task 3 pre-fixed the one regex call site.

**Files:**
- Modify: `src/utils/mdq/query.ts`
- Create: `tests/unit/mdq/selectors.test.ts`

**Interfaces:**
- Consumes: `parseQuery`, `getTokenText`, `selectorToTokenType`, `matchText` from Task 2
- Produces: `class MdqError extends Error`, `class MdqSelectorError extends MdqError` (with `index: number`), selectors `comment` and `html`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mdq/selectors.test.ts
import { describe, expect, it } from 'vitest';
import { MdqSelectorError, mdq } from '../../../src/utils/mdq/query.ts';

const doc = `<!-- suite -->

## Plan

<!-- test priority=critical
     style=bdd -->

para with <!-- inline --> comment

<div>a block</div>

| Method | Path |
|--------|------|
| GET | /users |
`;

describe('comment selector', () => {
  it('matches block comments and not other html', () => {
    expect(mdq(doc).query('comment').count()).toBe(2);
  });

  it('matches on the inner body so anchored patterns work', () => {
    expect(mdq(doc).query('comment(/^test/)').count()).toBe(1);
  });

  it('exposes the inner body as node text, without the markers', () => {
    expect(mdq(doc).query('comment[0]').nodes()[0].text).toBe('suite');
  });

  it('keeps newlines inside a multi-line comment', () => {
    expect(mdq(doc).query('comment(/^test/)').nodes()[0].text).toContain('\n');
  });

  it('does not reach comments inline in a paragraph', () => {
    expect(mdq(doc).query('comment(~"inline")').count()).toBe(0);
  });

  it('matches an exact single-line comment body', () => {
    expect(mdq(doc).query('comment("suite")').count()).toBe(1);
  });
});

describe('html selector', () => {
  it('matches every html block including comments', () => {
    expect(mdq(doc).query('html').count()).toBe(3);
  });

  it('matches on raw text', () => {
    expect(mdq(doc).query('html(~"<div")').count()).toBe(1);
  });
});

describe('regex flags', () => {
  it('honors an explicit i flag', () => {
    expect(mdq('## Summary\n').query('h2(/^summary/i)').count()).toBe(1);
  });

  it('is case sensitive without the i flag', () => {
    expect(mdq('## Summary\n').query('h2(/^summary/)').count()).toBe(0);
  });
});

describe('table text matching', () => {
  it('matches cell content, not only headers', () => {
    expect(mdq(doc).query('table(~"/users")').count()).toBe(1);
  });

  it('still matches header content', () => {
    expect(mdq(doc).query('table(~"Method")').count()).toBe(1);
  });
});

describe('selector errors', () => {
  it('throws on an unknown selector rather than matching nothing', () => {
    expect(() => mdq(doc).query('secton("A")')).toThrow(MdqSelectorError);
  });

  it('reports where the problem is', () => {
    try {
      mdq(doc).query('h2("A") secton("B")');
      expect.unreachable();
    } catch (error) {
      expect(error.index).toBe(8);
    }
  });

  it('accepts a leading dot for jq muscle memory', () => {
    expect(mdq('## A\n').query('.h2').count()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/selectors.test.ts`
Expected: FAIL — `MdqSelectorError` is not exported

- [ ] **Step 3: Implement the four changes**

Error classes, at the top of the class section:

```ts
export class MdqError extends Error {}

export class MdqSelectorError extends MdqError {
  index: number;

  constructor(message: string, index: number) {
    super(message);
    this.name = 'MdqSelectorError';
    this.index = index;
  }
}
```

In `parseQuery`, skip one leading `.` per segment and throw on an unknown identifier. Replace the silent `pos++; continue;`:

```ts
    if (peek() === '.') advance();
    const selectorStart = pos;
    const selector = readIdentifier();
    if (!selector) throw new MdqSelectorError(`Unexpected character "${input[pos]}" in selector`, pos);
    if (!isKnownSelector(selector)) throw new MdqSelectorError(`Unknown selector "${selector}"`, selectorStart);
```

Add the vocabulary check and the two new token mappings:

```ts
const SELECTORS = new Set(['section', 'heading', 'paragraph', 'table', 'list', 'item', 'code', 'blockquote', 'hr', 'html', 'comment']);

function isKnownSelector(selector: string): boolean {
  if (/^h[1-6]$/.test(selector)) return true;
  if (/^section[1-6]?$/.test(selector)) return true;
  return SELECTORS.has(selector);
}

function isCommentToken(token: Token): boolean {
  if (token.type !== 'html') return false;
  return ((token as any).raw || '').trimStart().startsWith('<!--');
}

function commentBody(token: Token): string {
  const raw = ((token as any).raw || '').trim();
  return raw.replace(/^<!--/, '').replace(/-->$/, '').trim();
}
```

In `selectorToTokenType`, map `html` to `'html'`. Handle `comment` in `executeSegments` before the generic branch, mirroring how `item` is handled:

```ts
  if (segment.selector === 'comment') {
    let comments = candidates.filter((r) => isCommentToken(r.token));
    if (segment.textMatch) comments = comments.filter((r) => matchText(commentBody(r.token), segment.textMatch!));
    return executeSegments(applyIndexSlice(comments, segment), remaining);
  }
```

In `getTokenText`, return the comment body for comment tokens, the raw for other html, and widen tables:

```ts
    case 'html':
      if (isCommentToken(token)) return commentBody(token);
      return t.raw || '';
    case 'table':
      return [...(t.header || []).map((h: any) => h.text), ...(t.rows || []).flatMap((row: any) => row.map((cell: any) => cell.text))].join(', ');
```

In `parseTextMatcher`, capture the flags instead of discarding them:

```ts
    if (peek() === '/') {
      advance();
      let value = '';
      while (pos < input.length && input[pos] !== '/') {
        value += input[pos];
        pos++;
      }
      if (pos < input.length) pos++;
      const flagStart = pos;
      while (pos < input.length && /[gimsuy]/.test(input[pos])) pos++;
      return { mode: 'regex', value, negated, flags: input.slice(flagStart, pos) };
    }
```

In `matchText`, use them:

```ts
    case 'regex':
      result = new RegExp(matcher.value, matcher.flags || '').test(text);
      break;
```

Add `flags?: string` to `TextMatcher` in the type block at the end of the file.

Rename `meta()` to `nodes()` in the same pass, since the test above calls `nodes()`, and
keep `meta` as a deprecated alias. The return type gets a name now that it is public:

```ts
  nodes(): NodeInfo[] {
    return this.matches.map((range) => {
      const token = range.token as any;
      if (token.type !== 'heading') return { type: token.type, depth: null, text: getTokenText(range.token) };
      return { type: token.type, depth: token.depth, text: getTokenText(range.token) };
    });
  }

  /** @deprecated Use nodes(). */
  meta(): NodeInfo[] {
    return this.nodes();
  }
```

and at the end of the file:

```ts
export interface NodeInfo {
  type: string;
  depth: number | null;
  text: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mdq/selectors.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Verify nothing regressed**

Run: `bun test tests/unit/`
Expected: PASS — in particular `query.test.ts` still at 114, since Task 3 already fixed `researcher.ts:316`

- [ ] **Step 6: Format, lint and commit**

```bash
bun run format && bun run lint:fix
git add -A src/utils/mdq tests/unit/mdq
git commit -m "feat(mdq): comment and html selectors, honest regex flags, loud selector errors"
```

---

### Task 5: Matchers as JS values, plus the sugar layer

Removes the hand-escaping wart: `section.name.replace(/"/g, '\\"')` at `researcher/focus.ts:77` exists only because a matcher had to be embedded in a string.

**Files:**
- Modify: `src/utils/mdq/query.ts`
- Create: `tests/unit/mdq/sugar.test.ts`

**Interfaces:**
- Consumes: `MarkdownDoc`, `Selection` from Task 3; `MdqSelectorError` from Task 4
- Produces:
  - `type Matcher = string | RegExp | ((text: string) => boolean)`
  - `interface SelectorOptions { depth?: 1 | 2 | 3 | 4 | 5 | 6 }`
  - `query(selector: string, matcher?: Matcher): Selection` on both classes
  - Sugar on both classes: `section` `heading` `paragraph` `table` `list` `item` `code` `blockquote` `comment` `html` `hr`
  - `at(n: number): Selection` and `slice(from?: number, to?: number): Selection` on `Selection`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mdq/sugar.test.ts
import { describe, expect, it } from 'vitest';
import { mdq } from '../../../src/utils/mdq/query.ts';

const doc = `## API "v2"

| Method | Path |
|--------|------|
| GET | /users |

## Settings

- Option A
- Option B

<!-- test id=1 -->
`;

describe('matchers as values', () => {
  it('matches a string exactly', () => {
    expect(mdq(doc).query('h2', 'Settings').count()).toBe(1);
    expect(mdq(doc).query('h2', 'Setting').count()).toBe(0);
  });

  it('matches a RegExp honoring its flags', () => {
    expect(mdq(doc).query('h2', /^settings$/i).count()).toBe(1);
    expect(mdq(doc).query('h2', /^settings$/).count()).toBe(0);
  });

  it('matches a predicate', () => {
    expect(mdq(doc).query('h2', (t) => t.startsWith('API')).count()).toBe(1);
  });

  it('needs no escaping for a value containing quotes', () => {
    expect(mdq(doc).query('h2', 'API "v2"').count()).toBe(1);
  });
});

describe('sugar', () => {
  it('is equivalent to the query form', () => {
    expect(mdq(doc).heading('Settings').text()).toBe(mdq(doc).query('heading', 'Settings').text());
  });

  it('takes a depth option', () => {
    expect(mdq(doc).section('Settings', { depth: 2 }).text()).toBe(mdq(doc).query('section2("Settings")').text());
  });

  it('reads comments', () => {
    expect(mdq(doc).comment(/^test/).count()).toBe(1);
  });

  it('chains from a Selection', () => {
    expect(mdq(doc).section('API "v2"').table().rows()[0].Path).toBe('/users');
  });

  it('takes no matcher', () => {
    expect(mdq(doc).table().count()).toBe(1);
  });
});

describe('at and slice', () => {
  it('selects by index like the DSL', () => {
    expect(mdq(doc).heading().at(0).text()).toBe(mdq(doc).query('heading[0]').text());
  });

  it('supports a negative index', () => {
    expect(mdq(doc).heading().at(-1).text()).toContain('Settings');
  });

  it('returns nothing for an out-of-bounds index', () => {
    expect(mdq(doc).heading().at(99).count()).toBe(0);
    expect(mdq(doc).heading().at(-99).count()).toBe(0);
  });

  it('slices like the DSL', () => {
    expect(mdq(doc).item().slice(1).count()).toBe(1);
  });
});

describe('exists', () => {
  it('is true when something matched', () => {
    expect(mdq(doc).heading('Settings').exists()).toBe(true);
  });

  it('is false when nothing matched', () => {
    expect(mdq(doc).heading('Nope').exists()).toBe(false);
  });
});

describe('canonical read names', () => {
  it('rows matches the deprecated toJson', () => {
    expect(mdq(doc).table().rows()).toEqual(mdq(doc).table().toJson());
  });

  it('preceding matches the deprecated before', () => {
    expect(mdq(doc).heading('Settings').preceding().text()).toBe(mdq(doc).query('heading("Settings")').before().text());
  });

  it('following matches the deprecated after', () => {
    expect(mdq(doc).heading('API "v2"').following().text()).toBe(mdq(doc).query('heading(~"API")').after().text());
  });

  it('entries matches the deprecated keyValue', () => {
    const block = mdq('> Container: .x\n').query('blockquote[0]');
    expect(block.entries()).toEqual(block.keyValue());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/sugar.test.ts`
Expected: FAIL — `mdq(...).heading is not a function`

- [ ] **Step 3: Implement matchers and the shared sugar base**

A value matcher bypasses the grammar entirely, so it needs its own `TextMatcher` mode:

```ts
function toTextMatcher(matcher: Matcher): TextMatcher {
  if (typeof matcher === 'function') return { mode: 'predicate', value: '', negated: false, predicate: matcher };
  if (matcher instanceof RegExp) return { mode: 'regex', value: matcher.source, negated: false, flags: matcher.flags };
  return { mode: 'exact', value: matcher, negated: false };
}
```

In `matchText`, add the branch:

```ts
    case 'predicate':
      result = matcher.predicate!(text);
      break;
```

Both classes share the sugar through one abstract base. Write the eleven methods out explicitly rather than generating them on the prototype — generated methods lose their types, and a typed surface is the point of a public package:

```ts
abstract class Queryable {
  abstract query(selector: string, matcher?: Matcher): Selection;

  section(matcher?: Matcher, options?: SelectorOptions): Selection {
    return this.query(`section${options?.depth || ''}`, matcher);
  }

  heading(matcher?: Matcher, options?: SelectorOptions): Selection {
    if (options?.depth) return this.query(`h${options.depth}`, matcher);
    return this.query('heading', matcher);
  }

  paragraph(matcher?: Matcher): Selection {
    return this.query('paragraph', matcher);
  }

  table(matcher?: Matcher): Selection {
    return this.query('table', matcher);
  }

  list(matcher?: Matcher): Selection {
    return this.query('list', matcher);
  }

  item(matcher?: Matcher): Selection {
    return this.query('item', matcher);
  }

  code(matcher?: Matcher): Selection {
    return this.query('code', matcher);
  }

  blockquote(matcher?: Matcher): Selection {
    return this.query('blockquote', matcher);
  }

  comment(matcher?: Matcher): Selection {
    return this.query('comment', matcher);
  }

  html(matcher?: Matcher): Selection {
    return this.query('html', matcher);
  }

  hr(): Selection {
    return this.query('hr');
  }
}
```

`MarkdownDoc extends Queryable` and `Selection extends Queryable`. Each `query` applies the matcher to the last parsed segment:

```ts
  query(selector: string, matcher?: Matcher): Selection {
    const segments = parseQuery(selector);
    if (matcher !== undefined && segments.length > 0) segments[segments.length - 1].textMatch = toTextMatcher(matcher);
    const candidates = expandSectionRanges(buildTokenIndex(this.source));
    return new Selection(this.source, executeSegments(candidates, segments));
  }
```

On `Selection`, add:

```ts
  at(index: number): Selection {
    const resolved = index < 0 ? this.matches.length + index : index;
    if (resolved < 0 || resolved >= this.matches.length) return new Selection(this.source, []);
    return new Selection(this.source, [this.matches[resolved]]);
  }

  slice(from?: number, to?: number): Selection {
    return new Selection(this.source, this.matches.slice(from, to));
  }

  exists(): boolean {
    return this.matches.length > 0;
  }
```

At the end of the file add `Matcher`, `SelectorOptions`, `predicate?: (text: string) => boolean` on `TextMatcher`, and widen its `mode` to include `'predicate'`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mdq/sugar.test.ts`
Expected: PASS (21 tests)

The `canonical read names` block fails until Step 5 adds the renames — that is expected.
Run Step 5 before treating those four as real failures.

- [ ] **Step 5: Add the read renames and their deprecated aliases**

Canonical names, with the old ones kept and marked:

| Canonical | Deprecated alias |
|---|---|
| `text()` | `get()` |
| `rows()` | `toJson()` |
| `entries()` | `keyValue()` |
| `nodes()` | `meta()` (already added in Task 4) |
| `preceding()` | `before()` |
| `following()` | `after()` |

Each alias is one line, for example:

```ts
  /** @deprecated Use rows(). */
  toJson(): Record<string, string>[] {
    return this.rows();
  }
```

Run: `bun test tests/unit/`
Expected: PASS — the ported suite still calls the deprecated names and must keep working

- [ ] **Step 6: Format, lint and commit**

```bash
bun run format && bun run lint:fix
git add -A src/utils/mdq tests/unit/mdq
git commit -m "feat(mdq): value matchers, sugar layer, at/slice, canonical read names"
```

---

### Task 6: edit.ts — remove and insert, with the whitespace invariant

The first task in `edit.ts`, and the one most likely to produce subtly wrong output. The governing rule, from the spec:

> **mdq never leaves zero blank lines between blocks, and never more than one.**

This matters because `marked` separators are uneven: a `heading` raw is `"# A\n\n"` with its blank line baked in, while a `paragraph` raw is `"para"` with no newline at all and a sibling `space` token holding the `"\n\n"`. Task 1 recorded that sibling as `range.trailing`; every verb here uses it.

**Files:**
- Create: `src/utils/mdq/edit.ts`
- Modify: `src/utils/mdq/query.ts`
- Create: `tests/unit/mdq/edit.test.ts`

**Interfaces:**
- Consumes: `MatchedRange` (type-only) from Task 1; `MarkdownDoc`, `Selection` from Task 3
- Produces, all in `edit.ts`:
  - `spliceRanges(source: string, ranges: MatchedRange[], render: (range: MatchedRange, index: number) => string): string`
  - `removeRanges(source: string, ranges: MatchedRange[]): string`
  - `insertAt(source: string, offset: number, markdown: string): string`
  - `blockEnd(range: MatchedRange): number` and `blockStart(range: MatchedRange): number`
- Produces, on `Selection`: `remove()`, `insertBefore(md)`, `insertAfter(md)`, `prepend(md)`, `append(md)`
- Produces, on `MarkdownDoc`: `append(md)`, `prepend(md)`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mdq/edit.test.ts
import { describe, expect, it } from 'vitest';
import { mdq } from '../../../src/utils/mdq/query.ts';

describe('remove', () => {
  it('takes a paragraph and its separator, leaving no crater', () => {
    expect(mdq('# A\n\nfirst\n\nsecond\n').query('paragraph("first")').remove().toString()).toBe('# A\n\nsecond\n');
  });

  it('takes a heading with its baked-in separator', () => {
    expect(mdq('# A\n\n## B\n\ntext\n').query('h2').remove().toString()).toBe('# A\n\ntext\n');
  });

  it('takes the leading separator when the node is last', () => {
    expect(mdq('# A\n\nlast\n').query('paragraph').remove().toString()).toBe('# A\n');
  });

  it('removes a whole section including its children', () => {
    expect(mdq('## A\n\nx\n\n## B\n\ny\n').query('section("A")').remove().toString()).toBe('## B\n\ny\n');
  });

  it('removes every match', () => {
    expect(mdq('# T\n\n```js\na\n```\n\ntext\n\n```js\nb\n```\n').query('code').remove().toString()).toBe('# T\n\ntext\n');
  });

  it('returns the document unchanged when nothing matches', () => {
    const src = '# A\n\ntext\n';
    expect(mdq(src).query('h5').remove().toString()).toBe(src);
  });
});

describe('insertBefore and insertAfter', () => {
  it('inserts a sibling before a node', () => {
    expect(mdq('## B\n\ntext\n').query('h2').insertBefore('## A\n').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('inserts a sibling after a node', () => {
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter('## B\n').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('normalizes an insert that already ends with blank lines', () => {
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter('## B\n\n\n\n').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('normalizes an insert with no trailing newline', () => {
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter('## B').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('accepts a MarkdownDoc', () => {
    const fragment = mdq('## B\n');
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter(fragment).toString()).toContain('## B');
  });
});

describe('prepend and append on a section', () => {
  const src = '## A\n\nfirst\n\n## B\n\nother\n';

  it('appends inside the section, before the next same-depth heading', () => {
    expect(mdq(src).query('section("A")').append('last\n').toString()).toBe('## A\n\nfirst\n\nlast\n\n## B\n\nother\n');
  });

  it('prepends directly after the section heading', () => {
    expect(mdq(src).query('section("A")').prepend('intro\n').toString()).toBe('## A\n\nintro\n\nfirst\n\n## B\n\nother\n');
  });

  it('appends at the end of the document when the section is last', () => {
    expect(mdq(src).query('section("B")').append('tail\n').toString()).toBe('## A\n\nfirst\n\n## B\n\nother\n\ntail\n');
  });

  it('throws when applied to a leaf node', () => {
    expect(() => mdq(src).query('paragraph[0]').append('x\n')).toThrow();
  });
});

describe('document-level append and prepend', () => {
  it('appends a block at the end', () => {
    expect(mdq('# A\n\ntext\n').append('## New\n').toString()).toBe('# A\n\ntext\n\n## New\n');
  });

  it('prepends a block at the start', () => {
    expect(mdq('# A\n\ntext\n').prepend('> note\n').toString()).toBe('> note\n\n# A\n\ntext\n');
  });

  it('prepends after frontmatter, never before it', () => {
    const out = mdq('---\nurl: /x\n---\n\n# A\n').prepend('> note\n').toString();
    expect(out.startsWith('---\nurl: /x\n---\n')).toBe(true);
    expect(out).toContain('> note');
  });
});

describe('chained edits', () => {
  it('composes several writes in one expression', () => {
    const out = mdq('## A\n\nfirst\n\n## B\n\nother\n')
      .query('section("A")')
      .append('added\n')
      .query('paragraph("other")')
      .remove()
      .toString();
    expect(out).toBe('## A\n\nfirst\n\nadded\n\n## B\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/edit.test.ts`
Expected: FAIL — `.remove is not a function`

- [ ] **Step 3: Write edit.ts**

```ts
import type { MatchedRange } from './query.ts';

export function blockStart(range: MatchedRange): number {
  return range.start;
}

export function blockEnd(range: MatchedRange): number {
  if (range.trailing) return range.trailing.start + range.trailing.length;
  return range.start + range.length;
}

export function normalizeBlock(markdown: string): string {
  return `${markdown.replace(/\s+$/, '')}\n`;
}

export function spliceRanges(source: string, ranges: MatchedRange[], render: (range: MatchedRange, index: number) => string): string {
  const ordered = dedupeRanges(ranges);
  const rendered = ordered.map(render);
  let result = source;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const range = ordered[i];
    result = result.slice(0, range.start) + rendered[i] + result.slice(range.start + range.length);
  }
  return result;
}

export function removeRanges(source: string, ranges: MatchedRange[]): string {
  const ordered = dedupeRanges(ranges);
  let result = source;
  for (let i = ordered.length - 1; i >= 0; i--) {
    const range = ordered[i];
    const head = result.slice(0, range.start);
    const tail = result.slice(blockEnd(range));
    if (tail) {
      result = head + tail;
      continue;
    }
    if (!head) {
      result = '';
      continue;
    }
    result = `${head.replace(/\n+$/, '')}\n`;
  }
  return result;
}

export function insertAt(source: string, offset: number, markdown: string): string {
  const block = normalizeBlock(markdown);
  const before = source.slice(0, offset).replace(/\n+$/, '');
  const after = source.slice(offset).replace(/^\n+/, '');
  if (!before) return `${block}\n${after}`;
  if (!after) return `${before}\n\n${block}`;
  return `${before}\n\n${block}\n${after}`;
}

function dedupeRanges(ranges: MatchedRange[]): MatchedRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const kept: MatchedRange[] = [];
  let lastEnd = -1;
  for (const range of sorted) {
    if (range.start < lastEnd) continue;
    kept.push(range);
    lastEnd = range.start + range.length;
  }
  return kept;
}

```

Both rules below were derived from real `marked` output, not assumed. **Do not "simplify"
either one.**

**`insertAt` normalizes only the seam.** It strips newlines from the end of `before` and
the start of `after`, then rebuilds the join. The tempting alternative — a global
`.replace(/\n{3,}/g, '\n\n')` over the document — is wrong: a fenced code block's raw really
does contain runs of blank lines (`marked` lexes a ```js block holding `a\n\n\nb` as one
`code` token whose raw carries `\n\n\n`), so a global collapse silently rewrites user code.

**`removeRanges` collapses only at end-of-document.** `marked` bakes the separator into
some raws and not others: a mid-document `paragraph` raw is `"para"` with a sibling `space`
token, a document-final `paragraph` raw is `"last\n"` with no sibling, and every `heading`
raw carries its own `"\n\n"`. So "no trailing space, therefore trim backwards" is wrong — on
`'# A\n\n## B\n\ntext\n'` it eats a blank line and yields `'# A\ntext\n'`. Deleting
`[start, blockEnd)` is already correct whenever anything follows; only a node removed from
the very end needs repair.

- [ ] **Step 4: Wire the verbs onto Selection and MarkdownDoc**

On `Selection`, four public verbs delegating to one private helper:

```ts
  remove(): MarkdownDoc {
    return new MarkdownDoc(removeRanges(this.source, this.matches));
  }

  insertBefore(markdown: Markdown): MarkdownDoc {
    return this.insertEach((range) => blockStart(range), markdown);
  }

  insertAfter(markdown: Markdown): MarkdownDoc {
    return this.insertEach((range) => blockEnd(range), markdown);
  }

  prepend(markdown: Markdown): MarkdownDoc {
    return this.insertEach((range) => this.containerStart(range), markdown);
  }

  append(markdown: Markdown): MarkdownDoc {
    return this.insertEach((range) => this.containerEnd(range), markdown);
  }
```

`insertEach`, `containerStart` and `containerEnd` are private and placed after the public
methods. Inserts run back-to-front so earlier offsets stay valid:

```ts
  private insertEach(offsetOf: (range: MatchedRange) => number, markdown: Markdown): MarkdownDoc {
    const offsets = this.matches.map(offsetOf).sort((a, b) => a - b);
    let result = this.source;
    for (let i = offsets.length - 1; i >= 0; i--) {
      result = insertAt(result, offsets[i], String(markdown));
    }
    return new MarkdownDoc(result);
  }

  private containerStart(range: MatchedRange): number {
    if (!range.innerTokens) throw new MdqOperationError(`prepend needs a section or list, got ${range.token.type}`);
    return range.start + ((range.token as any).raw || '').length;
  }

  private containerEnd(range: MatchedRange): number {
    if (!range.innerTokens) throw new MdqOperationError(`append needs a section or list, got ${range.token.type}`);
    const last = range.innerTokens[range.innerTokens.length - 1];
    if (!last) return this.containerStart(range);
    return blockEnd(last);
  }
```

`containerStart` and `containerEnd` throw eagerly, which is why the "throws when applied to
a leaf node" test asserts on the `query(...).append(...)` call itself rather than on
`.toString()`.

On `MarkdownDoc`:

```ts
  append(markdown: Markdown): MarkdownDoc {
    return new MarkdownDoc(insertAt(this.source, this.source.length, String(markdown)));
  }

  prepend(markdown: Markdown): MarkdownDoc {
    return new MarkdownDoc(insertAt(this.source, splitFrontmatter(this.source).offset, String(markdown)));
  }
```

Add `MdqOperationError`:

```ts
export class MdqOperationError extends MdqError {
  constructor(message: string) {
    super(message);
    this.name = 'MdqOperationError';
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/mdq/edit.test.ts`
Expected: PASS (19 tests)

If a whitespace assertion fails, print the actual output with `JSON.stringify` before changing anything — the difference is almost always one newline, and guessing at it will break a different case.

- [ ] **Step 6: Run the whole suite and commit**

```bash
bun test tests/unit/
bun run format && bun run lint:fix
git add -A src/utils/mdq tests/unit/mdq
git commit -m "feat(mdq): remove and insert verbs with whitespace normalization"
```

---

### Task 7: Structural inserts — addRow and addItem

**Files:**
- Modify: `src/utils/mdq/edit.ts`
- Modify: `src/utils/mdq/query.ts`
- Create: `tests/unit/mdq/structural.test.ts`

**Interfaces:**
- Consumes: `spliceRanges` from Task 6; `MdqOperationError` from Task 6
- Produces in `edit.ts`: `renderTable(headers: string[], rows: string[][], align: (string | null)[]): string`, `renderItem(listRaw: string, text: string): string`
- Produces on `Selection`: `addRow(row: Record<string, string>): MarkdownDoc`, `addItem(text: string): MarkdownDoc`

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mdq/structural.test.ts
import { describe, expect, it } from 'vitest';
import { mdq } from '../../../src/utils/mdq/query.ts';

const table = `| Method | Path |
|--------|------|
| GET | /users |
`;

describe('addRow', () => {
  it('appends a row and re-aligns every column', () => {
    expect(mdq(table).query('table').addRow({ Method: 'POST', Path: '/sessions' }).toString()).toBe(
      ['| Method | Path      |', '| ------ | --------- |', '| GET    | /users    |', '| POST   | /sessions |', ''].join('\n')
    );
  });

  it('round-trips through rows()', () => {
    const out = mdq(table).query('table').addRow({ Method: 'POST', Path: '/sessions' });
    expect(mdq(out).query('table').rows()).toEqual([
      { Method: 'GET', Path: '/users' },
      { Method: 'POST', Path: '/sessions' },
    ]);
  });

  it('leaves a column blank when the object omits it', () => {
    const out = mdq(table).query('table').addRow({ Method: 'PUT' });
    expect(mdq(out).query('table').rows()[1]).toEqual({ Method: 'PUT', Path: '' });
  });

  it('ignores keys that are not columns', () => {
    const out = mdq(table).query('table').addRow({ Method: 'PUT', Nope: 'x' });
    expect(mdq(out).query('table').rows()[1].Method).toBe('PUT');
    expect(mdq(out).query('table').text()).not.toContain('Nope');
  });

  it('throws on a non-table node', () => {
    expect(() => mdq('para\n').query('paragraph').addRow({ a: 'b' })).toThrow();
  });
});

describe('addItem', () => {
  it('copies a dash marker', () => {
    expect(mdq('- a\n- b\n').query('list').addItem('c').toString()).toBe('- a\n- b\n- c\n');
  });

  it('copies a star marker', () => {
    expect(mdq('* a\n* b\n').query('list').addItem('c').toString()).toBe('* a\n* b\n* c\n');
  });

  it('continues an ordered list', () => {
    expect(mdq('1. a\n2. b\n').query('list').addItem('c').toString()).toBe('1. a\n2. b\n3. c\n');
  });

  it('preserves indentation', () => {
    expect(mdq('  - a\n  - b\n').query('list').addItem('c').toString()).toBe('  - a\n  - b\n  - c\n');
  });

  it('throws on a non-list node', () => {
    expect(() => mdq('para\n').query('paragraph').addItem('x')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/structural.test.ts`
Expected: FAIL — `.addRow is not a function`

- [ ] **Step 3: Add the renderers to edit.ts**

```ts
export function renderTable(headers: string[], rows: string[][], align: (string | null)[]): string {
  const widths = headers.map((header, index) => Math.max(header.length, 3, ...rows.map((row) => (row[index] || '').length)));
  const line = (cells: string[]) => `| ${cells.map((cell, index) => (cell || '').padEnd(widths[index])).join(' | ')} |`;
  const divider = `| ${widths.map((width, index) => dashes(align[index], width)).join(' | ')} |`;
  return `${[line(headers), divider, ...rows.map(line)].join('\n')}\n`;
}

export function renderItem(listRaw: string, text: string): string {
  const lines = listRaw.split('\n').filter((line) => line.trim());
  const last = lines[lines.length - 1] || '- x';
  const match = last.match(/^(\s*)(\d+)([.)])\s/);
  if (match) return `${match[1]}${Number.parseInt(match[2], 10) + 1}${match[3]} ${text}`;
  const bullet = last.match(/^(\s*)([-*+])\s/);
  if (!bullet) return `- ${text}`;
  return `${bullet[1]}${bullet[2]} ${text}`;
}

function dashes(alignment: string | null, width: number): string {
  if (alignment === 'center') return `:${'-'.repeat(Math.max(width - 2, 1))}:`;
  if (alignment === 'left') return `:${'-'.repeat(Math.max(width - 1, 1))}`;
  if (alignment === 'right') return `${'-'.repeat(Math.max(width - 1, 1))}:`;
  return '-'.repeat(width);
}
```

- [ ] **Step 4: Wire the verbs onto Selection**

```ts
  addRow(row: Record<string, string>): MarkdownDoc {
    return new MarkdownDoc(
      spliceRanges(this.source, this.matches, (range) => {
        if (range.token.type !== 'table') throw new MdqOperationError(`addRow needs a table, got ${range.token.type}`);
        const table = range.token as Tokens.Table;
        const headers = table.header.map((cell) => cell.text);
        const existing = table.rows.map((cells) => headers.map((_, index) => cells[index]?.text || ''));
        return renderTable(headers, [...existing, headers.map((header) => row[header] || '')], table.align);
      })
    );
  }

  addItem(text: string): MarkdownDoc {
    return new MarkdownDoc(
      spliceRanges(this.source, this.matches, (range) => {
        if (range.token.type !== 'list') throw new MdqOperationError(`addItem needs a list, got ${range.token.type}`);
        const raw = ((range.token as any).raw || '').replace(/\s+$/, '');
        return `${raw}\n${renderItem(raw, text)}\n`;
      })
    );
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/mdq/structural.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 6: Run the whole suite and commit**

```bash
bun test tests/unit/
bun run format && bun run lint:fix
git add -A src/utils/mdq tests/unit/mdq
git commit -m "feat(mdq): addRow and addItem structural inserts"
```

---

### Task 8: setEntry and the frontmatter API

**Files:**
- Modify: `src/utils/mdq/edit.ts`
- Modify: `src/utils/mdq/query.ts`
- Modify: `tests/unit/mdq/frontmatter.test.ts`

**Interfaces:**
- Consumes: `splitFrontmatter` from Task 1; `spliceRanges` from Task 6
- Produces in `edit.ts`: `rewriteEntries(tokenText: string, isBlockquote: boolean, key: string, value: string | null): string`, `writeFrontmatter(source: string, key: string, value: unknown): string`
- Produces on `Selection`: `entries()`, `setEntry(key, value)`
- Produces on `MarkdownDoc`: `frontmatter(): Record<string, unknown>`, `setFrontmatter(key: string, value: unknown): MarkdownDoc`

Reading and writing both go through `yaml`'s **Document API** (`YAML.parseDocument`), never `parse`/`stringify`. That is what preserves comments through a write — verified behaviour, not an assumption.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/unit/mdq/frontmatter.test.ts
import { mdq } from '../../../src/utils/mdq/query.ts';

describe('frontmatter API', () => {
  const src = '---\n# a leading comment\nurl: /login\nwait: 1000\ntags:\n  - auth\n  - smoke\n---\n\n# Title\n';

  it('reads typed scalars, lists and nested maps', () => {
    expect(mdq(src).frontmatter()).toEqual({ url: '/login', wait: 1000, tags: ['auth', 'smoke'] });
  });

  it('returns an empty object when there is no frontmatter', () => {
    expect(mdq('# Title\n').frontmatter()).toEqual({});
  });

  it('updates a key in place', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).frontmatter().wait).toBe(2000);
  });

  it('preserves comments through a write', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).toString()).toContain('# a leading comment');
  });

  it('preserves the body exactly', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).toString()).toContain('# Title');
  });

  it('adds a key that was not there', () => {
    expect(mdq(src).setFrontmatter('region', 'sidebar').frontmatter().region).toBe('sidebar');
  });

  it('deletes a key when the value is null', () => {
    expect(mdq(src).setFrontmatter('wait', null).frontmatter().wait).toBeUndefined();
  });

  it('creates a frontmatter block on a document that has none', () => {
    const out = mdq('# Title\n').setFrontmatter('url', '/x');
    expect(out.frontmatter()).toEqual({ url: '/x' });
    expect(out.toString()).toContain('# Title');
  });

  it('keeps body queries blind to frontmatter after a write', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).query('h2').count()).toBe(0);
  });
});

describe('entries and setEntry', () => {
  const block = "## S\n\n> Container: '.old'\n> Pagination: controls\n\ntext\n";

  it('reads every entry of a blockquote without its markers', () => {
    expect(mdq(block).query('blockquote[0]').entries()).toEqual({ container: "'.old'", pagination: 'controls' });
  });

  it('replaces an entry in place and keeps the others', () => {
    expect(mdq(block).query('blockquote[0]').setEntry('Container', "'.new'").toString()).toBe("## S\n\n> Container: '.new'\n> Pagination: controls\n\ntext\n");
  });

  it('appends an entry that was not there', () => {
    const out = mdq(block).query('blockquote[0]').setEntry('Region', 'sidebar');
    expect(mdq(out).query('blockquote[0]').entries().region).toBe('sidebar');
  });

  it('removes an entry when the value is null', () => {
    const out = mdq(block).query('blockquote[0]').setEntry('Pagination', null);
    expect(mdq(out).query('blockquote[0]').entries()).toEqual({ container: "'.old'" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/frontmatter.test.ts`
Expected: FAIL — `.frontmatter is not a function`

- [ ] **Step 3: Implement in edit.ts**

```ts
import YAML from 'yaml';

export function writeFrontmatter(source: string, key: string, value: unknown): string {
  const { raw, body, offset } = splitFrontmatter(source);
  const document = raw ? YAML.parseDocument(raw) : new YAML.Document({});
  if (value === null) document.delete(key);
  if (value !== null) document.set(key, value);
  const rendered = document.toString().replace(/\s+$/, '');
  if (!offset) return `---\n${rendered}\n---\n\n${source}`;
  return `---\n${rendered}\n---\n${body}`;
}

export function readFrontmatter(source: string): Record<string, unknown> {
  const { raw } = splitFrontmatter(source);
  if (!raw) return {};
  return (YAML.parseDocument(raw).toJS() as Record<string, unknown>) || {};
}
```

`splitFrontmatter` already lives in `edit.ts` from Task 1, so these functions sit beside it.

`rewriteEntries` is the existing `setKeyValue` body, lifted out of the class:

```ts
export function rewriteEntries(tokenText: string, isBlockquote: boolean, key: string, value: string | null): string {
  const lines = tokenText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const index = lines.findIndex((line) => entryKey(line) === key.toLowerCase());
  if (index < 0 && value) lines.push(`${key}: ${value}`);
  if (index >= 0 && value) lines[index] = `${key}: ${value}`;
  if (index >= 0 && !value) lines.splice(index, 1);

  if (!isBlockquote) return lines.join('\n');
  return lines.map((line) => `> ${line}`).join('\n');
}
```

`entryKey` moves to `edit.ts` alongside it.

- [ ] **Step 4: Wire onto the classes**

```ts
  frontmatter(): Record<string, unknown> {
    return readFrontmatter(this.source);
  }

  setFrontmatter(key: string, value: unknown): MarkdownDoc {
    return new MarkdownDoc(writeFrontmatter(this.source, key, value));
  }
```

```ts
  setEntry(key: string, value: string | null): MarkdownDoc {
    return new MarkdownDoc(spliceRanges(this.source, this.matches, (range) => rewriteEntries(getTokenText(range.token), range.token.type === 'blockquote', key, value)));
  }

  /** @deprecated Use setEntry(). */
  setKeyValue(key: string, value: string | null): MarkdownDoc {
    return this.setEntry(key, value);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/mdq/frontmatter.test.ts`
Expected: PASS (21 tests)

- [ ] **Step 6: Confirm knowledge and experience files now parse correctly**

This is the real-world check that motivated the feature:

```bash
bun -e '
import { mdq } from "./src/utils/mdq/query.ts";
import { readdirSync, readFileSync } from "node:fs";
for (const dir of ["knowledge", "experience"]) {
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).slice(0, 5)) {
    const doc = mdq(readFileSync(`${dir}/${file}`, "utf8"));
    console.log(file, JSON.stringify(doc.frontmatter()), "headings:", doc.query("heading").count());
  }
}'
```

Expected: frontmatter parsed as an object on each file, and **no heading whose text looks like `url: ...`**. A `url:` heading means frontmatter is leaking into the token index.

If either directory is empty, skip this step and note it.

- [ ] **Step 7: Run the whole suite and commit**

```bash
bun test tests/unit/
bun run format && bun run lint:fix
git add -A src/utils/mdq tests/unit/mdq
git commit -m "feat(mdq): frontmatter read/write via yaml Document API, setEntry"
```

---

### Task 9: README

The package is publish-ready only if someone can use it without reading the source.

**Files:**
- Create: `src/utils/mdq/README.md`

**Interfaces:**
- Consumes: the complete API from Tasks 3-8
- Produces: nothing code depends on

- [ ] **Step 1: Write the README**

Cover, in this order:

1. One-paragraph pitch: query and edit markdown with a selector language, like jq for markdown.
2. Install and import.
3. **The one rule**, stated early and plainly: *reads narrow, writes return the document.*
4. Selector grammar table: `section` `section1-6` `h1-h6` `heading` `paragraph` `table` `list` `item` `code` `blockquote` `hr` `html` `comment`, with text matchers (`"exact"`, `~"contains"`, `/regex/flags`, `!` to negate), `[index]`, `[from:to]`, and compound paths.
5. Matchers as values: `string` exact, `RegExp` with its own flags, predicate function.
6. Read methods table, write methods table.
7. Frontmatter section, noting comment preservation.
8. A worked example using a chained multi-edit.
9. Limitations, stated honestly: block-level comments only (inline comments live inside paragraph tokens); no row- or item-level selectors, so `addRow` has no `removeRow` partner; YAML frontmatter only.

Do **not** document the deprecated aliases (`get` `toJson` `keyValue` `setKeyValue` `meta` `before` `after`). They exist for in-repo callers; the published surface should read clean.

Follow the repo docs style: show each format example once, and do not close with a "Why this matters" section.

- [ ] **Step 2: Verify every example in the README actually runs**

Extract each fenced `js` block and execute it. Any example that throws or prints something other than what the README claims is a documentation bug — fix the README, not the test.

```bash
bun -e '
import { mdq } from "./src/utils/mdq/query.ts";
// paste each README example here and assert its stated output
'
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/mdq/README.md
git commit -m "docs(mdq): package README"
```

---

### Task 10: The CLI

**Files:**
- Create: `src/utils/mdq/cli.ts`
- Create: `bin/mdq.ts`
- Create: `tests/unit/mdq/cli.test.ts`
- Modify: `package.json` (add the `mdq` bin entry)

**Interfaces:**
- Consumes: the full library API from Tasks 3-8
- Produces: `runMdq(argv: string[], stdin: string): Promise<{ output: string; code: number }>`

`runMdq` returns its result rather than writing to stdout or calling `process.exit`, which is what makes it testable. `bin/mdq.ts` is the only place that touches the process.

Note a deliberate deviation from `CLAUDE.md`: command logic normally lives in `src/commands/`, but mdq must not import from anywhere in explorbot. Its CLI ships with the package.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/mdq/cli.test.ts
import { describe, expect, it } from 'vitest';
import { runMdq } from '../../../src/utils/mdq/cli.ts';

const doc = `# Title

## API

| Method | Path |
|--------|------|
| GET | /users |

## FAQ

question?
`;

describe('reads', () => {
  it('prints matched markdown', async () => {
    const result = await runMdq(['h2'], doc);
    expect(result.output).toContain('## API');
    expect(result.code).toBe(0);
  });

  it('accepts a leading dot like jq', async () => {
    expect((await runMdq(['.h2'], doc)).output).toContain('## API');
  });

  it('prints rows as json', async () => {
    const result = await runMdq(['section("API") table', '--json'], doc);
    expect(JSON.parse(result.output)).toEqual([{ Method: 'GET', Path: '/users' }]);
  });

  it('prints a count', async () => {
    expect((await runMdq(['h2', '--count'], doc)).output.trim()).toBe('2');
  });

  it('prints unwrapped text', async () => {
    expect((await runMdq(['h2', '--text'], doc)).output).not.toContain('##');
  });

  it('prints frontmatter as json', async () => {
    const result = await runMdq(['--frontmatter'], '---\nurl: /x\n---\n\n# T\n');
    expect(JSON.parse(result.output)).toEqual({ url: '/x' });
  });
});

describe('edits', () => {
  it('removes and prints the whole document', async () => {
    const result = await runMdq(['section("FAQ")', '--remove'], doc);
    expect(result.output).not.toContain('## FAQ');
    expect(result.output).toContain('## API');
  });

  it('appends into a section', async () => {
    expect((await runMdq(['section("FAQ")', '--append', 'answer!'], doc)).output).toContain('answer!');
  });

  it('adds a table row from json', async () => {
    const result = await runMdq(['table', '--add-row', '{"Method":"POST","Path":"/s"}'], doc);
    expect(result.output).toContain('POST');
  });

  it('sets an entry', async () => {
    const result = await runMdq(['blockquote', '--set', 'Container=.x'], '> Container: .old\n');
    expect(result.output).toContain('.x');
    expect(result.output).not.toContain('.old');
  });
});

describe('exit codes', () => {
  it('returns 1 when nothing matches', async () => {
    expect((await runMdq(['h5'], doc)).code).toBe(1);
  });

  it('returns 2 on an unknown selector', async () => {
    const result = await runMdq(['secton("A")'], doc);
    expect(result.code).toBe(2);
    expect(result.output).toContain('Unknown selector');
  });

  it('returns 0 when an edit matched', async () => {
    expect((await runMdq(['h2', '--remove'], doc)).code).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/mdq/cli.test.ts`
Expected: FAIL — cannot resolve `cli.ts`

- [ ] **Step 3: Implement cli.ts**

Use Commander with `exitOverride()` and `.configureOutput()` so a parse failure surfaces as a return value rather than killing the process. Shape:

```ts
export async function runMdq(argv: string[], stdin: string): Promise<CliResult> {
  const program = new Command();
  program
    .argument('[selector]', 'markdown selector')
    .argument('[file]', 'file to read; stdin when omitted')
    .option('-j, --json', 'output rows as JSON')
    .option('-c, --count', 'print the number of matches')
    .option('-t, --text', 'print unwrapped text')
    .option('--frontmatter', 'print frontmatter as JSON')
    .option('-i, --in-place', 'write the result back to the file')
    .option('--remove', 'delete matched blocks')
    .option('--replace <markdown>', 'replace matched blocks')
    .option('--insert-before <markdown>', 'insert before each match')
    .option('--insert-after <markdown>', 'insert after each match')
    .option('--prepend <markdown>', 'insert at the start of each match')
    .option('--append <markdown>', 'insert at the end of each match')
    .option('--add-row <json>', 'append a table row')
    .option('--add-item <text>', 'append a list item')
    .option('--set <key=value>', 'set an entry; omit the value to delete it')
    .exitOverride();
  // ... parse, read source, build doc, apply exactly one edit or one read, return { output, code }
}
```

Rules to implement:

- No selector plus `--frontmatter` prints the frontmatter and returns 0.
- An edit flag with no matches returns 1 and prints the document unchanged.
- `MdqSelectorError` returns 2 with the message as output.
- `--in-place` writes `output` to the file and returns an empty `output`.
- More than one edit flag returns 2 with `Only one edit at a time`.
- `--set k=v` splits on the **first** `=`; `--set k=` deletes.

At the end of the file:

```ts
export interface CliResult {
  output: string;
  code: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/mdq/cli.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Add the thin bin entry**

```ts
#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { runMdq } from '../src/utils/mdq/cli.ts';

const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
const result = await runMdq(process.argv.slice(2), stdin);
if (result.output) process.stdout.write(result.output.endsWith('\n') ? result.output : `${result.output}\n`);
process.exit(result.code);
```

Add to `package.json` `bin`:

```json
    "mdq": "./dist/bin/mdq.js"
```

- [ ] **Step 6: Smoke-test the real binary**

```bash
echo '# A

## B

text' | bun run bin/mdq.ts 'h2'
```
Expected: `## B`

```bash
bun run bin/mdq.ts 'section("Data Envelope Formats") table' --json CLAUDE.md | head -5
```
Expected: JSON array of that section's table rows

```bash
bun run bin/mdq.ts 'nonsense' CLAUDE.md; echo "exit=$?"
```
Expected: `Unknown selector "nonsense"` and `exit=2`

- [ ] **Step 7: Run the whole suite and commit**

```bash
bun test tests/unit/
bun run format && bun run lint:fix
git add -A src/utils/mdq bin/mdq.ts tests/unit/mdq package.json
git commit -m "feat(mdq): jq-like CLI"
```

---

### Task 11: Changelog and final verification

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the full unit suite**

Run: `bun test tests/unit/`
Expected: PASS, no failures

- [ ] **Step 2: Re-run the scoped type check**

```bash
bunx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "^(src/utils/mdq/|src/utils/markdown-query|src/experience-tracker|src/ai/planner|src/ai/researcher|bin/mdq)"
```

Expected: **exactly the two known `locators.ts(247,...)` lines.** Anything else is a real defect that CI will not catch.

- [ ] **Step 3: Confirm the package has no explorbot imports**

```bash
grep -rn "^import\|from '" src/utils/mdq/*.ts | grep -v "'marked'" | grep -v "'yaml'" | grep -v "'commander'" | grep -v "'./"
```

Expected: **no output.** Any line here breaks extractability, which is the whole point of the package.

- [ ] **Step 4: Update the changelog**

Use the `/changelog` skill, per `CLAUDE.md`.

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for mdq package"
```

---

## Notes for the executor

- **Never run the regression workflow.** Do not add the `regression` label, do not `gh workflow run regression.yml`, do not re-run its jobs. If a change needs regression coverage, say so and let the user decide.
- **`.claude/worktrees/**` holds four stale copies** of `markdown-query.ts` and its consumers. Exclude that path from every grep, sed and sweep. A migration that "finds" 200 call sites has picked up worktrees.
- **CI type-checking is a mirage.** `tsc` runs with `--noCheck`, so a green build says nothing about the return-type change in Task 3. The scoped check in Task 3 Step 8 and Task 11 Step 2 is the only real gate.
- **Whitespace failures are one newline.** When an edit test fails, print the actual string with `JSON.stringify` before touching the implementation. Adjusting the normalizer by guesswork fixes one case and breaks two.
