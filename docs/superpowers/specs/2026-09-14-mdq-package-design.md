# mdq — Markdown Query & Edit Package

Date: 2026-09-14
Status: Approved design, pending implementation

## Goal

Extract `src/utils/markdown-query.ts` into `src/utils/mdq/`, designed as a publishable
standalone package: query markdown *and* update it, with a jq-like CLI planned as a
second phase.

The name `mdq` is unclaimed on npm (verified 404). Publishing is deferred; this change
makes the package publish-ready but adds no `package.json` or build script.

## Constraints

- **Zero explorbot imports.** Two dependencies only: `marked` for markdown, `yaml` for
  frontmatter. Both are already repo deps (`marked` ^16.2.0, `yaml` ^2.8.3).
- **Two files**, per the module split below.
- 54 in-repo call sites must keep working; a re-export shim carries them.

## Architecture

```
src/utils/mdq/
  query.ts   selector grammar - token index - MarkdownDoc - Selection (reads)
  edit.ts    pure edits over (source, ranges): splicing - whitespace - renderers
  README.md  public documentation
src/utils/markdown-query.ts   re-export shim
tests/unit/mdq/*.test.ts
```

`edit.ts` exports pure functions taking source text plus ranges or tokens, and returning
new source text. It imports types from `query.ts` type-only and never references a class
value. `query.ts` owns both classes and delegates each write verb to exactly one `edit.ts`
call. This keeps the split acyclic by construction.

Two types:

- **`MarkdownDoc`** — a whole document. Returned by `mdq()` and by every write.
- **`Selection`** — a set of matched ranges. Returned by `query()` and the sugar methods.

One rule, stated in the README: **reads narrow, writes return the document.**

## API

### `mdq(source)`

`mdq(source: string | MarkdownDoc): MarkdownDoc`

Accepting a `MarkdownDoc` makes re-wrapping free.

### `MarkdownDoc`

| Method | Returns | Notes |
|---|---|---|
| `query(selector, matcher?)` | `Selection` | |
| `frontmatter()` | `Record<string, unknown>` | `{}` when absent |
| `setFrontmatter(key, value)` | `MarkdownDoc` | `null` value deletes the key |
| `append(md)` | `MarkdownDoc` | add a block at end of document |
| `prepend(md)` | `MarkdownDoc` | add a block at start of body, after frontmatter |
| `toString()` / `valueOf()` | `string` | full document, frontmatter included |

Plus the shared sugar layer.

`append`/`prepend` exist because "add a section to the end of the document" otherwise has
no clean path — only the `section().last().insertAfter(...)` workaround. There is a real
call site: `deep-analysis.ts:131` builds it by hand today as
`` `${cached.trimEnd()}\n\n# Extended Research\n\n...` ``.

### `Selection` — reads

Narrow or extract; never mutate.

| Method | Returns | Replaces |
|---|---|---|
| `query(selector, matcher?)` | `Selection` | sub-query, unchanged |
| `text()` | `string` | — (`get()` deprecated) |
| `count()` | `number` | |
| `exists()` | `boolean` | the `.count() > 0` idiom, 3 in-repo uses |
| `first()` / `last()` | `Selection` | |
| `at(n)` | `Selection` | new; sugar-path equivalent of DSL `[n]` |
| `slice(from?, to?)` | `Selection` | new; sugar-path equivalent of DSL `[a:b]` |
| `each()` | `Selection[]` | |
| `nodes()` | `NodeInfo[]` | `meta()` |
| `rows()` | `Record<string,string>[]` | `toJson()` — it only ever handled tables |
| `entries()` | `Record<string,string>` | `keyValue()` |
| `preceding()` / `following()` | `Selection` | `before()` / `after()` |

`before`/`after` are renamed specifically to free those names from colliding with
`insertBefore`/`insertAfter`.

### `Selection` — writes

Every write returns `MarkdownDoc`, so edits chain in one expression.

| Method | Signature | Notes |
|---|---|---|
| `replace(md)` | `(Markdown) => MarkdownDoc` | |
| `replaceEach(fn)` | `((Selection, number) => Markdown) => MarkdownDoc` | |
| `remove()` | `() => MarkdownDoc` | node **plus its adjacent `space` token** |
| `insertBefore(md)` | `(Markdown) => MarkdownDoc` | sibling |
| `insertAfter(md)` | `(Markdown) => MarkdownDoc` | sibling |
| `prepend(md)` | `(Markdown) => MarkdownDoc` | inside a section or list; `MdqOperationError` on a leaf node |
| `append(md)` | `(Markdown) => MarkdownDoc` | inside a section or list; `MdqOperationError` on a leaf node |
| `addRow(row)` | `(Record<string,string>) => MarkdownDoc` | table only; re-aligns columns |
| `addItem(text)` | `(string) => MarkdownDoc` | list only; matches marker + indent |
| `setEntry(key, value)` | `(string, string \| null) => MarkdownDoc` | `null` deletes |

Naming now pairs: `rows()`/`addRow()`, `entries()`/`setEntry()`, `nodes()`.

Every verb that *takes* markdown accepts `Markdown = string | MarkdownDoc`, mirroring
`mdq()` itself. A `replaceEach` callback may therefore return a `MarkdownDoc` built by a
nested edit, without a `.toString()` hop.

### Sugar layer

Eleven methods on both classes: `section` `heading` `paragraph` `table` `list` `item`
`code` `blockquote` `comment` `html` `hr`.

Each is `(matcher?, opts?) => Selection` and is *defined as* `query(sel, matcher)` —
documented as sugar, not a parallel implementation. Defined once on a shared base that
implements them in terms of an abstract `query()`, so the two classes do not duplicate it.

Depth is an option rather than 12 near-duplicate methods:

```js
mdq(src).section('API', { depth: 2 })   // DSL: query('section2("API")')
mdq(src).heading(/^f/i).at(0)           // DSL: query('heading(/^f/i)[0]')
mdq(src).comment(/^test/)               // DSL: query('comment(/^test/)')
```

### Exported types

Declared at the end of their file, per repo convention.

```ts
type Markdown = string | MarkdownDoc;
type Matcher  = string | RegExp | ((text: string) => boolean);

interface NodeInfo {
  type: string;            // 'heading' | 'paragraph' | 'table' | 'comment' | ...
  depth: number | null;    // heading level, else null
  text: string;            // unwrapped text; comment bodies without <!-- -->
}

interface SelectorOptions {
  depth?: 1 | 2 | 3 | 4 | 5 | 6;
}
```

`Matcher` semantics:

- `string` — exact match (mirrors DSL `"x"`)
- `RegExp` — pattern, honoring its own flags
- function — predicate; needs no escaping at all

Note the consequence for `comment`: a `string` matcher is **exact**, and this repo's own
test-plan comments are multi-line (`<!-- test\n  priority=critical\n-->`). So
`comment('test')` matches only a bare `<!-- test -->`; reaching the multi-line ones needs
`comment(/^test/)` or a predicate. Exactness is the consistent rule and is kept, but it is
the one place the sugar is likely to surprise.

This removes an existing wart. Today the repo hand-escapes to build selector strings:

```js
const escaped = section.name.replace(/"/g, '\\"');   // researcher/focus.ts:77
mdq(result.text).query(`section2(~"${escaped}")`);
```

### Deprecated aliases

`get` `toJson` `keyValue` `setKeyValue` `meta` `before` `after` are kept, marked
`@deprecated`, and omitted from the README so the published surface reads clean.

Aliases cover the read renames completely. They cannot shield the write return-type
change — see Migration.

## Selector grammar

Unchanged, plus one addition and three fixes.

### `comment` (new)

`html` tokens filtered to those that are comments. Not an alias for `html`: `<div>x</div>`
lexes as `html` too.

- `comment` matches on the **inner** body, trimmed. `html` matches on raw.
  This is required for anchored patterns — `/^test/` against `<!-- test id=1 -->` only
  works if the text is `test id=1`.
- Multi-line comments are a single token and keep their newlines in the matched text.
- **Inline comments are out of scope for 1.0.** `para with <!-- x --> comment` lexes the
  comment inside the paragraph token; it is not reachable as a block. Documented, not faked.

`comment` and `html` together finish the `test-plan-markdown.ts` story: its hand-rolled
line parser (`src/utils/test-plan-markdown.ts:122+`) exists only because mdq could not
see `<!-- suite -->` and `<!-- test ... -->`.

### Fixes

1. **Regex flags are honored.** Today flags are parsed then discarded
   (`markdown-query.ts:90`) and `'i'` is hardcoded (`markdown-query.ts:156`), so `/x/` is
   case-insensitive while `"x"` and `~"x"` are case-sensitive. After the fix `/x/i` is
   insensitive and `/x/` is not. One production call site relies on the old behavior:
   `researcher.ts:316` `section2(/^summary/)` becomes `/^summary/i`. Tests already write
   flags explicitly.
2. **Unknown selectors throw.** Today `query('secton("A")')` silently matches nothing
   (`markdown-query.ts:103-106`, `:356`). Unacceptable for a CLI.
3. **Table text-match widens to headers plus cells.** Today `getTokenText` returns headers
   only (`markdown-query.ts:181`), so `table(~"GET")` can never match a cell. No call site
   uses table text-matching, so this is safe.

## Update semantics

`marked` separators are uneven, and every write rule follows from this:

| Token | `raw` |
|---|---|
| `heading` | `"# A\n\n"` — separators baked in |
| `paragraph` | `"para"` — no trailing newline |
| `space` | `"\n\n"` — a separate token |

The token index therefore records each node's range **and its adjacent `space` range**.

> **Invariant: mdq never leaves zero blank lines between blocks, and never more than one.**

- `remove()` takes the node plus its trailing `space` — or its leading `space` when it is
  the last block. Without this, removing a paragraph leaves a four-newline crater. This is
  the most likely bug in the feature and gets dedicated tests.
- `insertAfter` / `append` normalize inserted markdown to one trailing `\n` and splice at
  the boundary, never inside a space token.
- `append` on a section inserts before the next same-or-shallower heading, reusing the
  existing `computeSections` end boundary.
- `addRow` re-renders the whole table so column pipes stay aligned.
- `addItem` copies the list's existing marker (`-`, `*`, `1.`) and indent.

## Frontmatter

Every `knowledge/` and `experience/` file opens with `---\nurl: /login\n---`, which
`marked` lexes as a setext h2 titled `url: /login`.

mdq detects leading frontmatter, excludes it from the token index with offsets preserved
so edits splice correctly, and exposes it as data.

Reading and writing both go through `yaml`'s **Document API** (`YAML.parseDocument`), not
`parse`/`stringify`. That buys two things a hand-rolled parser cannot: correctness on
nested maps, lists and block scalars — the Jekyll/Astro/Obsidian files that justify the
feature — and **comment preservation through a write**, verified:

```yaml
# a leading comment          <- survives setFrontmatter('wait', 2000)
url: /login
wait: 2000
tags:
  - auth
  - smoke
nested:
  key: value # trailing note  <- also survives
```

`gray-matter` is deliberately not used: `knowledge-tracker.ts` keeps it for its own
purposes, but a published package should not carry it to do what `yaml` already does.

```js
const doc = mdq(knowledgeFile);
doc.frontmatter();                  // { url: '/login', wait: 1000, tags: ['auth'] }
doc.query('h2').count();            // 0 — the --- block is not a heading
doc.setFrontmatter('wait', 2000).toString();
```

## Errors

`MdqError` base, with:

- `MdqSelectorError` — malformed or unknown selector, carrying the offending index.
- `MdqOperationError` — a verb applied to the wrong node type, e.g. `addRow` on a paragraph.

An **empty selection is a safe no-op**: reads return `''` / `[]`, writes return the
document unchanged. This preserves the existing "returns source unchanged when no matches"
test.

## CLI (phase 2)

The selector is the program, the file or stdin is the input, markdown is the default output.

A leading `.` is accepted and ignored, so muscle memory from jq (`mdq '.h2'`) works. It is
sugar in the grammar, not a separate syntax — without it the new "unknown selectors throw"
rule would reject the most natural thing a jq user types first.

```bash
mdq 'h2' README.md                           # raw markdown of matches
cat plan.md | mdq 'section("API") table' -j  # rows() as JSON
mdq 'comment(~"test")' plan.md --count
mdq 'section("FAQ")' doc.md --remove -i      # edit in place
mdq 'table[0]' api.md --add-row '{"Method":"GET","Path":"/users"}' -i
```

Flags mirror library verbs exactly: `--remove` `--replace` `--insert-before`
`--insert-after` `--prepend` `--append` `--add-row` `--add-item` `--set k=v`, plus
`-i/--in-place`, `-j/--json`, `-c/--count`, `-t/--text`, `--frontmatter`.

Built with Commander, per repo convention. Exit codes compose like grep: **0** match,
**1** no match, **2** usage or selector error.

1.0 reads one file or stdin. Multi-file input is out of scope.

## Testing

Port the existing 801-line suite first — it is the regression net for all 54 call sites.
Then add coverage for what is new or newly specified:

- whitespace craters on `remove` (the invariant above)
- chained multi-edits through `MarkdownDoc`
- `addRow` column alignment; `addItem` marker and indent matching
- frontmatter round-trip, including a file whose body has its own `---`
- `comment` inner-text matching, multi-line comments, and `html` versus `comment`
- `MdqSelectorError` on unknown selectors and malformed input
- sugar equivalence: every sugar call equals its `query()` form

## Migration

Two steps. Only the second carries risk.

1. `src/utils/markdown-query.ts` becomes a re-export shim. **All 54 call sites keep
   working untouched.**
2. A sweep updates imports, then fixes the call sites the return-type change breaks.

Deprecated read aliases mean **no read call site changes**. Writes are not shielded: a
verb that returned `string` now returns `MarkdownDoc`. That breaks four classes of site,
at least eleven in total.

**(a) Assignment into a `string`-typed target** — 7 sites, each needs `.toString()`:

| Site | Target |
|---|---|
| `experience-tracker.ts:265` | `content` (inferred `string`) |
| `experience-tracker.ts:289` | `combined` (inferred `string`) |
| `researcher/deep-analysis.ts:129` | `let updated: string` |
| `researcher/locators.ts:307` | `result.text` |
| `researcher/locators.ts:309` | `result.text` |
| `researcher/pagination.ts:61` | `result.text` |
| `researcher/research-result.ts:57` | `section.rawMarkdown` |
| `researcher/research-result.ts:58` | `this.text` |

**(b) A string method called on the result** — 2 sites:

- `planner.ts:304` — `.replace('').trim()`
- `planner.ts:322` — `const kept = ...replace('')`, then `kept.trimEnd()` on line 324

**(c) Returned from a `replaceEach` callback** — `deep-analysis.ts:542`. **Resolved by
design**, not by migration: callbacks accept `Markdown`, so returning a `MarkdownDoc` is
valid. No edit needed.

**(d) Compared against a string — the dangerous one.** `research-result.ts:56`:

```js
const updated = sectionQuery.query('table').replace(`${newTable.trimEnd()}\n`);
if (updated === this.text) return;     // MarkdownDoc === string is always false
```

This does not crash. The guard silently stops firing and the method starts doing work it
used to skip. `tsc` does flag it — comparing types with no overlap is an error — which is
precisely why the manual type-check below is not optional. Every `replace`/`setEntry`
result used in an equality or truthiness test must be audited, not just the ones that fail
to compile.

Sites that flow the result straight back into `mdq()` — `planner.ts:303`, `planner.ts:405`
— keep working unchanged, because `mdq()` accepts a `MarkdownDoc`.

`tsc` is the complete detector for these breaks: every one surfaces as a type error. The migration step is therefore *run `tsc` over the changed files and fix
what it reports*, with the table above as the expected result rather than the whole story.

Also in the sweep: `researcher.ts:316` gains its `i` flag (`section2(/^summary/i)`).

### Hazards

- **`.claude/worktrees/**` holds four stale copies** of `markdown-query.ts` and its
  consumers. Every grep or sed sweep must exclude that path.
- **`tsc` runs with `--noCheck` in CI.** The nine breaks above are *exactly* the errors a
  type-check would raise, and CI raises none of them — a fully green build proves nothing
  here. Run `tsc` manually over the changed files before considering the sweep done.

## Style compliance

The current file violates several repo rules that the rewrite fixes: types belong at the
end of the file, ternaries are banned (`markdown-query.ts:30`, `:34`, `:129-130`, `:295`),
and the `switch` in `matchText` should be early returns.

## Deliberately out of scope

- Publishing: no `package.json`, no build script, no npm release in this change.
- Frontmatter formats other than YAML (TOML `+++`, JSON) — detected and skipped from the
  token index, but not parsed.
- Row-level and item-level *selectors* (`addRow` has no `removeRow` partner). A future
  `row(...)` selector is the right shape for that; guessing at it now is premature.
- Inline HTML comments.
- Multi-file CLI input.
