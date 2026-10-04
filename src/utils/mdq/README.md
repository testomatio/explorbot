<p align="center">
  <img src="https://raw.githubusercontent.com/testomatio/explorbot/main/assets/logos/mdq/mdq-icon-bg-v2.png" alt="mdq" width="160">
</p>

# mdq

Query, validate, extract, and update structured Markdown with a selector language. Like `jq` for Markdown.

## Usage examples

```bash
npx mdq-cli 'section("Overview")' generated.md                                      # validate
npx mdq-cli 'section("API") table' --json README.md                                 # extract
npx mdq-cli 'section("Tasks") list' --add-item 'Review docs' --in-place plan.md      # update
```

### Validate the structure of LLM-generated Markdown

Use a selector as a structural assertion. The command prints the matching Markdown and exits with status `0` when the section exists, `1` when it does not exist, or `2` when the selector or input is invalid:

```bash
npx mdq-cli 'section("Overview")' generated.md
```

Check several conditions in one call by joining selectors with `AND`. The command exits with `1` when any of them fails:

```bash
npx mdq-cli 'section("Overview") AND section("API") table AND section("Examples") code' generated.md
```

This checks for an **Overview** section, a table inside **API**, and at least one fenced code block inside **Examples**. An unknown selector raises an error instead of silently matching nothing.

The same validation can be scripted in JavaScript:

```js
import { readFile } from 'node:fs/promises';
import { mdq } from 'mdq-cli';

const source = await readFile('generated.md', 'utf8');
const doc = mdq(source);

const valid =
  doc.section('Overview').exists() &&
  doc.query('section("API") table').exists() &&
  doc.query('section("Examples") code[0]').exists();

if (!valid) throw new Error('Generated Markdown does not match the required structure');
```

### Extract data from structured Markdown

Read a table as JSON from the CLI:

```bash
npx mdq-cli 'section("API") table' --json README.md
```

Or extract typed structures through the JavaScript API:

```js
import { mdq } from 'mdq-cli';

const endpoints = mdq(readme).query('section("API") table').rows();
const metadata = mdq(plan).section('Metadata').entries();
const testComments = mdq(doc).comment(/^test/).nodes();
```

### Update data in Markdown

Append a row to a table and save the file in place:

```bash
npx mdq-cli 'section("API") table' \
  --add-row '{"Method":"POST","Path":"/sessions"}' \
  --in-place README.md
```

Or compose several edits in JavaScript:

```js
import { mdq } from 'mdq-cli';

const updated = mdq(source)
  .query('section("API") table')
  .addRow({ Method: 'POST', Path: '/sessions' })
  .query('section("Notes")')
  .append('- Document the new endpoint\n')
  .toString();
```

## Install

```bash
npx mdq-cli 'h2' README.md     # run without installing
npm install mdq-cli            # use as a library
npm install -g mdq-cli         # install the mdq-cli command globally
```

mdq requires Node.js 18 or newer. Its implementation libraries are described in [Implementation](#implementation).

## Use mdq with coding agents

Add this instruction to your project's `AGENTS.md`:

```md
When you need to inspect, validate, or edit structured Markdown, use `npx mdq-cli` selectors instead of parsing or rewriting the document manually; run `npx mdq-cli --help` for the available query and edit options.
```

This gives an agent a deterministic CLI for checking generated documents, extracting structured content, and making targeted edits without rewriting unrelated Markdown.

## Core model

**Reads narrow the selection; writes return the document.**

`mdq(source)` returns a `MarkdownQuery`. It holds the complete document and the blocks currently selected from it. `query()` and the convenience methods narrow that selection. Every write returns a fresh `MarkdownQuery` over the edited document, so edits can be chained and finished with `toString()`:

```js
mdq(source)
  .query('section("API")')
  .append('## Notes\n')
  .query('blockquote[0]')
  .remove()
  .toString();
```

`toString()` always returns the whole document. `text()` returns the raw Markdown for only the current selection.

## CLI reference

```text
mdq-cli [options] [selector] [file]
```

Square brackets in `mdq-cli [options] [selector] [file]` mean that an argument is optional; they are documentation notation, not characters to type.

- `[selector]` is the query that chooses Markdown blocks.
- `[file]` is the input file. When it is omitted, mdq reads the document from standard input.
- `--in-place` is an output option for edits, not a replacement for `[file]`. It tells mdq to overwrite the input file instead of printing the edited document.

```bash
npx mdq-cli 'h2' README.md                    # read from a file
cat README.md | npx mdq-cli 'h2'              # read from standard input
npx mdq-cli 'comment(~"draft")' --remove README.md
                                                  # print the edited document
npx mdq-cli 'comment(~"draft")' --remove --in-place README.md
                                                  # overwrite README.md
```

Only one edit option can be used per invocation. `--in-place` requires a file because there is no input file to overwrite when mdq reads from standard input.

### Read options

| Option | Result |
| --- | --- |
| `-j, --json` | Output selected table rows as JSON |
| `-c, --count` | Print the number of matches |
| `-t, --text` | Print unwrapped node text |
| `--frontmatter` | Print YAML frontmatter as JSON; no selector is required |

Without a read option, mdq prints the raw Markdown for the selection.

### Edit options

| Option | Effect |
| --- | --- |
| `--remove` | Delete matched blocks |
| `--replace <markdown>` | Replace matched blocks |
| `--insert-before <markdown>` | Insert a sibling block before each match |
| `--insert-after <markdown>` | Insert a sibling block after each match |
| `--prepend <markdown>` | Insert at the start of each matched section or list |
| `--append <markdown>` | Insert at the end of each matched section or list |
| `--add-row <json>` | Append a row to each matched table |
| `--add-item <text>` | Append an item to each matched list |
| `--set <key=value>` | Set a `Key: value` entry; omit `=value` to delete the key |
| `-i, --in-place` | Write the edited document back to the input file |

Without `--in-place`, an edit prints the complete edited document to standard output. `--in-place` requires a file.

### Use mdq in pipelines

Because mdq reads from standard input when `[file]` is omitted, it can query generated Markdown without creating a temporary file:

```bash
generate-markdown | npx mdq-cli 'section("Summary")'
```

Pipe selected table rows as JSON into another data tool:

```bash
npx mdq-cli 'section("API") table' --json README.md |
  jq -r '.[].Path'
```

Pipe a selected Markdown block to another command:

```bash
cat README.md |
  npx mdq-cli 'section("Install")' |
  markdownlint
```

Edits without `--in-place` print the complete edited document, so multiple mdq edits can be chained:

```bash
npx mdq-cli 'section("Deprecated")' --remove README.md |
  npx mdq-cli 'section("Notes") list[0]' --add-item 'Reviewed' \
  > README.updated.md
```

To replace the original file, prefer `--in-place`. Do not redirect output back to the same file being read, such as `... README.md > README.md`, because the shell truncates the file before mdq can read it.

### Exit status

| Status | Meaning |
| --- | --- |
| `0` | The query matched, the count completed, or the edit succeeded |
| `1` | The selector matched nothing |
| `2` | The command, selector, input file, or operation was invalid |

`--count` exits with status `0`, including when the count is zero.

## Selector reference

| Selector | Matches |
| --- | --- |
| `section` | A heading and everything below it, up to the next heading of the same or shallower depth |
| `section1` … `section6` | The same section range, restricted to one heading depth |
| `heading`, `h1` … `h6` | The heading line only |
| `paragraph` | A paragraph |
| `table` | A GFM table |
| `list` | A bullet or ordered list |
| `item` | One list item |
| `code` | A fenced code block |
| `blockquote` | A `>` block |
| `hr` | A thematic break |
| `html` | An HTML block, matched against its raw text |
| `comment` | An HTML comment, matched against its **inner** body |

### Match text

Put a text matcher in parentheses. Prefix any matcher with `!` to negate it.

```text
section("Install")      exact match
section(~"Inst")        contains text
section(/^inst/i)       regular expression, with its own flags
section(!~"Draft")      negated match
```

### Select by index or slice

Use brackets to select by position. Negative indexes count from the end, and slices follow Python-style `from:to` bounds.

```text
heading[0]              first heading
heading[-1]             last heading
blockquote[2:5]         a slice
```

### Scope selectors

Separate selectors with spaces to scope each selector inside the previous one:

```text
section("API") table    every table inside the API section
```

### Combine selectors

Join selectors with `AND` or `OR`, written in capitals. `AND` matches only when every selector matches; `OR` matches when any of them does. `AND` binds tighter than `OR`. The result holds the matches of the selectors that passed, each once, in document order. An index or slice applies to its own selector, not to the combined result:

```text
section("Steps") AND section("Expected")    both sections must exist
section("Install") OR section("Setup")      either section
h2[0] OR h2[-1]                             the first and the last h2
```

A leading `.` is accepted and ignored, so `.h2` works if that is your habit from `jq`.

An unknown selector throws `MdqSelectorError`. The error carries the `index` of the offending character; mdq never silently treats an unknown selector as an empty result.

## Matchers as JavaScript values

Pass a JavaScript matcher value when building a selector string would require escaping dynamic input:

```js
mdq(doc).query('section2', section.name);   // exact string
mdq(doc).heading(/^summary/i);              // RegExp with its own flags
mdq(doc).item((text) => text.length > 80);  // predicate
```

A `string` matches exactly, a `RegExp` honors its own flags, and a function is called as a predicate over the node's text.

These convenience selector methods accept a matcher:

- `section`
- `heading`
- `paragraph`
- `table`
- `list`
- `item`
- `code`
- `blockquote`
- `comment`
- `html`

Each is equivalent to `query(selector, matcher)`. The `hr()` convenience method takes no matcher. `section` and `heading` also accept `{ depth }`:

```js
mdq(doc).section('Install', { depth: 2 });
mdq(doc).heading(/^summary/i, { depth: 3 });
```

## Reading with the JavaScript API

| Method | Returns |
| --- | --- |
| `text()` | Raw Markdown from every match, joined together |
| `nodes()` | One `{ type, depth, text }` object per match |
| `rows()` | Table rows as objects keyed by table header |
| `entries()` | `Key: value` lines from a block, with lowercase keys |
| `count()` / `exists()` | The number of matches / whether any match exists |
| `first()` / `last()` / `at(n)` / `slice(from, to)` | A narrowed selection |
| `each()` | One single-match `MarkdownQuery` per match |
| `preceding()` / `following()` | Everything before the first / after the last match |

## Writing with the JavaScript API

Every write returns a new `MarkdownQuery` over the complete edited document.

| Method | Effect |
| --- | --- |
| `replace(md)` | Replace every match |
| `replaceEach(fn)` | Replace each match with `fn(selection, index)` |
| `remove()` | Delete every match and its blank line |
| `insertBefore(md)` / `insertAfter(md)` | Add a sibling block |
| `prepend(md)` / `append(md)` | Add a block inside a section or list |
| `addRow(obj)` | Append a table row and realign the columns |
| `addItem(text)` | Append a list item using the existing list marker |
| `setEntry(key, value)` | Set a `Key: value` line; pass `null` to delete it |
| `setFrontmatter(key, value)` | Set a YAML frontmatter value |

`prepend` and `append` require a section or list. Using either method on another block raises `MdqOperationError`.

Any method that accepts Markdown also accepts another `MarkdownQuery`. Writes normalize spacing to exactly one blank line between blocks. Content inside fenced code blocks is preserved exactly.

## Frontmatter

A leading `---` block is parsed as YAML, excluded from the token index, and exposed as data. This prevents `marked` from interpreting a line such as `url: /login` as a setext heading.

```js
const doc = mdq(page);

doc.frontmatter();                // { url: '/login', wait: 1000, tags: ['auth'] }
doc.query('h2').count();          // 0 — the --- block is not a heading

const updated = doc
  .setFrontmatter('wait', 2000)   // comments and formatting survive
  .toString();
```

From the CLI:

```bash
npx mdq-cli --frontmatter page.md
```

## Implementation

Under the hood, mdq uses `marked` to parse Markdown into a block-token AST before it queries or edits anything. Headings, paragraphs, tables, lists, list items, fenced code blocks, blockquotes, HTML, and thematic breaks all come from that parsed structure.

### Processing model

1. A leading YAML frontmatter block is separated from the Markdown body.
2. `marked.lexer()` parses the body into block tokens, including nested list items and GFM table data.
3. mdq indexes each token with its range in the original source.
4. The selector parser converts the query into validated selector segments.
5. The evaluator matches those segments against parsed tokens. It derives sections from heading depth and descendant scope from the selected token ranges.
6. Edits splice only the selected source ranges. Untouched text remains unchanged, and the result is parsed again into a fresh `MarkdownQuery`.

This model provides consistent queries and targeted edits while preserving content outside the selection.

### Selector grammar

The selector language has a small, explicit grammar:

```text
query     := segment (whitespace segment)*
segment   := ["." ] name [matcher] position*
name      := section | section1..section6
           | heading | h1..h6
           | paragraph | table | list | item | code
           | blockquote | hr | html | comment
matcher   := "(" ["!"] (quoted | "~" quoted | regex) ")"
quoted    := '"' text '"'
regex     := "/" pattern "/" flags
position  := "[" integer "]"
           | "[" [integer] ":" [integer] "]"
```

Whitespace between segments means “select inside the previous match.” A leading `.` is accepted as optional syntax. Indexes may be negative, and slices use `from:to` bounds. The complete selector must match this grammar: unknown names and unexpected characters raise `MdqSelectorError` with the failing character position.

Markdown structure is not parsed with regular expressions. Regex is limited to selector tokenization, explicit `/pattern/flags` matchers, and small local formatting operations.

### Libraries

| Library | Purpose |
| --- | --- |
| [`marked`](https://marked.js.org/) | Parse Markdown into block tokens and provide GFM table and nested-list structure |
| [`yaml`](https://eemeli.org/yaml/) | Parse and update YAML frontmatter through a document model that preserves comments and formatting |
| [`commander`](https://github.com/tj/commander.js) | Parse CLI arguments and options, and generate command help |

File input and in-place writes use Node.js built-in filesystem APIs.

## License

MIT
