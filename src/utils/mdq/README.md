# mdq

Query and edit markdown with a selector language — jq, for markdown.

## Install

```bash
npx mdq 'h2' README.md     # no install
npm install mdq            # as a library
npm install -g mdq         # as a command
```

Node 18 or newer. Two dependencies: `marked` and `yaml`.

## Use

```js
import { mdq } from 'mdq';

mdq(readme).query('section("Install") code[0]').text();
mdq(plan).comment(/^test/).nodes();
mdq(doc).table().addRow({ Method: 'POST', Path: '/sessions' }).toString();
```

There is a CLI too:

```bash
mdq 'section("API") table' --json README.md
```

## The one rule

**Reads narrow, writes return the document.**

`mdq(source)` gives a `MarkdownQuery` — one class, holding the document and the set of
blocks currently selected. `query()` and the sugar methods narrow that set. Every write
returns a fresh `MarkdownQuery` over the edited document, so edits chain and end with
`toString()`:

```js
mdq(source)
  .query('section("API")').append('## Notes\n')
  .query('blockquote[0]').remove()
  .toString();
```

`toString()` is always the whole document; `text()` is the markdown of the current
selection.

## Selectors

| Selector | Matches |
| --- | --- |
| `section` | a heading and everything under it, until the next heading of the same or shallower depth |
| `section1` … `section6` | the same, restricted to one heading depth |
| `heading`, `h1` … `h6` | the heading line alone |
| `paragraph` | a paragraph |
| `table` | a GFM table |
| `list` | a bullet or ordered list |
| `item` | one item of a list |
| `code` | a fenced code block |
| `blockquote` | a `>` block |
| `hr` | a thematic break |
| `html` | an HTML block, matched on its raw text |
| `comment` | an HTML comment, matched on its **inner** body |

Text matchers go in parentheses, and `!` negates any of them:

```
section("Install")      exact
section(~"Inst")        contains
section(/^inst/i)       regex, with its own flags
section(!~"Draft")      negated
```

Index and slice with brackets, and compose with spaces to scope one selector inside
another:

```
heading[0]              first
heading[-1]             last
blockquote[2:5]         a slice
section("API") table    every table inside that section
```

A leading `.` is accepted and ignored, so `.h2` works if that is your habit from jq.

An unknown selector throws `MdqSelectorError`, which carries the `index` of the offending
character. It never silently matches nothing.

## Matchers as values

Passing a JavaScript value avoids escaping a dynamic string into a selector:

```js
mdq(doc).query('section2', section.name);   // exact
mdq(doc).heading(/^summary/i);              // regex, own flags
mdq(doc).item((text) => text.length > 80);  // predicate
```

A `string` matches exactly, a `RegExp` honors its own flags, and a function is a predicate
over the node's text. Every sugar method takes one: `section` `heading` `paragraph` `table`
`list` `item` `code` `blockquote` `comment` `html` `hr`. Each is exactly
`query(selector, matcher)`; `section` and `heading` also take `{ depth }`.

## Reading

| Method | Returns |
| --- | --- |
| `text()` | raw markdown of every match, joined |
| `nodes()` | `{ type, depth, text }` per match |
| `rows()` | table rows as objects, keyed by header |
| `entries()` | `Key: value` lines of a block, keys lowercased |
| `count()` / `exists()` | how many matched / whether any did |
| `first()` / `last()` / `at(n)` / `slice(from, to)` | narrow the selection |
| `each()` | one single-match query per match |
| `preceding()` / `following()` | everything before the first / after the last match |

## Writing

Every one returns a `MarkdownQuery` over the edited document.

| Method | Effect |
| --- | --- |
| `replace(md)` | replace each match |
| `replaceEach(fn)` | replace each match with `fn(selection, index)` |
| `remove()` | delete each match, and its blank line |
| `insertBefore(md)` / `insertAfter(md)` | add a sibling block |
| `prepend(md)` / `append(md)` | add a block inside a section or list |
| `addRow(obj)` | append a table row, re-aligning the columns |
| `addItem(text)` | append a list item, copying the existing marker |
| `setEntry(key, value)` | set a `Key: value` line; `null` deletes it |

`prepend` and `append` need a section or list; on any other block they raise
`MdqOperationError`. Anything that takes markdown also takes a `MarkdownQuery`. Writes
never leave zero blank lines between blocks, and never more than one — including inside
fenced code blocks, which are left exactly as they are.

## Frontmatter

A leading `---` block is parsed as YAML, kept out of the token index, and exposed as data.
Without this, `marked` reads `url: /login` as a setext heading.

```js
const doc = mdq(page);
doc.frontmatter();                   // { url: '/login', wait: 1000, tags: ['auth'] }
doc.query('h2').count();             // 0 — the --- block is not a heading
doc.setFrontmatter('wait', 2000);    // comments and formatting survive
```

## Limitations

- **Block-level comments only.** A comment inside a paragraph (`text <!-- x --> more`) is
  part of that paragraph's token and is not reachable as a `comment`.
- **No row or item selectors.** `addRow` and `addItem` append; there is no `removeRow`,
  because there is nothing to select.
- **YAML frontmatter only.** TOML (`+++`) and JSON blocks are skipped from the token index
  but not parsed.
