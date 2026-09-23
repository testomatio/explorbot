import { type Token, type Tokens, marked } from 'marked';
import { MarkdownEditor } from './edit.ts';

export { MarkdownEditor };

export class MarkdownQuery {
  private source: string;
  private matches: MatchedRange[];

  constructor(source: string, matches?: MatchedRange[]) {
    this.source = source;
    this.matches = matches || buildTokenIndex(source);
  }

  query(selector: string, matcher?: Matcher): MarkdownQuery {
    const segments = parseQuery(selector);
    if (matcher !== undefined && segments.length > 0) segments[segments.length - 1].textMatch = this.valueMatcher(matcher);
    return new MarkdownQuery(this.source, this.run(this.expandSections(this.matches), segments));
  }

  section(matcher?: Matcher, options?: SelectorOptions): MarkdownQuery {
    return this.query(`section${options?.depth || ''}`, matcher);
  }

  heading(matcher?: Matcher, options?: SelectorOptions): MarkdownQuery {
    if (options?.depth) return this.query(`h${options.depth}`, matcher);
    return this.query('heading', matcher);
  }

  paragraph(matcher?: Matcher): MarkdownQuery {
    return this.query('paragraph', matcher);
  }

  table(matcher?: Matcher): MarkdownQuery {
    return this.query('table', matcher);
  }

  list(matcher?: Matcher): MarkdownQuery {
    return this.query('list', matcher);
  }

  item(matcher?: Matcher): MarkdownQuery {
    return this.query('item', matcher);
  }

  code(matcher?: Matcher): MarkdownQuery {
    return this.query('code', matcher);
  }

  blockquote(matcher?: Matcher): MarkdownQuery {
    return this.query('blockquote', matcher);
  }

  comment(matcher?: Matcher): MarkdownQuery {
    return this.query('comment', matcher);
  }

  html(matcher?: Matcher): MarkdownQuery {
    return this.query('html', matcher);
  }

  hr(): MarkdownQuery {
    return this.query('hr');
  }

  text(): string {
    return this.matches.map((range) => this.source.slice(range.start, range.start + range.length)).join('');
  }

  nodes(): NodeInfo[] {
    return this.matches.map((range) => {
      const token = range.token as any;
      if (token.type !== 'heading') return { type: token.type, depth: null, text: this.tokenText(range.token) };
      return { type: token.type, depth: token.depth, text: this.tokenText(range.token) };
    });
  }

  rows(): Record<string, string>[] {
    const results: Record<string, string>[] = [];

    for (const range of this.matches) {
      if (range.token.type !== 'table') continue;

      const table = range.token as Tokens.Table;
      const headers = table.header.map((cell) => cell.text);
      for (const row of table.rows) {
        const entry: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          entry[headers[i]] = row[i]?.text ?? '';
        }
        results.push(entry);
      }
    }

    return results;
  }

  entries(): Record<string, string> {
    const entries: Record<string, string> = {};

    for (const range of this.matches) {
      for (const line of this.tokenText(range.token).split('\n')) {
        const separator = line.indexOf(':');
        if (separator < 1) continue;
        const value = line.slice(separator + 1).trim();
        if (value) entries[line.slice(0, separator).trim().toLowerCase()] = value;
      }
    }

    return entries;
  }

  frontmatter(): Record<string, unknown> {
    return this.editor().frontmatter();
  }

  count(): number {
    return this.matches.length;
  }

  exists(): boolean {
    return this.matches.length > 0;
  }

  at(index: number): MarkdownQuery {
    let resolved = index;
    if (resolved < 0) resolved = this.matches.length + resolved;
    if (resolved < 0 || resolved >= this.matches.length) return new MarkdownQuery(this.source, []);
    return new MarkdownQuery(this.source, [this.matches[resolved]]);
  }

  slice(from?: number, to?: number): MarkdownQuery {
    return new MarkdownQuery(this.source, this.matches.slice(from, to));
  }

  first(): MarkdownQuery {
    return this.slice(0, 1);
  }

  last(): MarkdownQuery {
    return this.slice(-1);
  }

  each(): MarkdownQuery[] {
    return this.matches.map((range) => new MarkdownQuery(this.source, [range]));
  }

  preceding(): MarkdownQuery {
    if (this.matches.length === 0) return new MarkdownQuery(this.source, []);
    const cutoff = this.matches[0].start;
    return new MarkdownQuery(
      this.source,
      buildTokenIndex(this.source).filter((range) => range.start + range.length <= cutoff)
    );
  }

  following(): MarkdownQuery {
    if (this.matches.length === 0) return new MarkdownQuery(this.source, []);
    const last = this.matches[this.matches.length - 1];
    const cutoff = last.start + last.length;
    return new MarkdownQuery(
      this.source,
      buildTokenIndex(this.source).filter((range) => range.start >= cutoff)
    );
  }

  replace(content: Markdown): MarkdownQuery {
    return this.replaceEach(() => content);
  }

  replaceEach(replacer: (match: MarkdownQuery, index: number) => Markdown): MarkdownQuery {
    return new MarkdownQuery(this.editor().replace(this.matches, (range, index) => String(replacer(new MarkdownQuery(this.source, [range]), index))));
  }

  remove(): MarkdownQuery {
    return new MarkdownQuery(this.editor().remove(this.matches));
  }

  insertBefore(markdown: Markdown): MarkdownQuery {
    return this.insertAll((range) => range.start, markdown);
  }

  insertAfter(markdown: Markdown): MarkdownQuery {
    return this.insertAll((range) => MarkdownEditor.blockEnd(range), markdown);
  }

  prepend(markdown: Markdown): MarkdownQuery {
    return this.insertAll((range) => this.containerStart(range), markdown);
  }

  append(markdown: Markdown): MarkdownQuery {
    return this.insertAll((range) => this.containerEnd(range), markdown);
  }

  addRow(row: Record<string, string>): MarkdownQuery {
    return new MarkdownQuery(
      this.editor().replace(this.matches, (range) => {
        if (range.token.type !== 'table') throw new MdqOperationError(`addRow needs a table, got ${range.token.type}`);
        const table = range.token as Tokens.Table;
        const headers = table.header.map((cell) => cell.text);
        const existing = table.rows.map((cells) => headers.map((_, index) => cells[index]?.text || ''));
        return MarkdownEditor.table(headers, [...existing, headers.map((header) => row[header] || '')], table.align);
      })
    );
  }

  addItem(text: string): MarkdownQuery {
    return new MarkdownQuery(
      this.editor().replace(this.matches, (range) => {
        if (range.token.type !== 'list') throw new MdqOperationError(`addItem needs a list, got ${range.token.type}`);
        const raw = (((range.token as any).raw as string) || '').trimEnd();
        return `${raw}\n${MarkdownEditor.item(raw, text)}\n`;
      })
    );
  }

  setEntry(key: string, value: string | null): MarkdownQuery {
    return this.replaceEach((match) => {
      const token = match.matches[0].token;
      return MarkdownEditor.entries(this.tokenText(token), key, value, token.type === 'blockquote');
    });
  }

  setFrontmatter(key: string, value: unknown): MarkdownQuery {
    return new MarkdownQuery(this.editor().setFrontmatter(key, value));
  }

  toString(): string {
    return this.source;
  }

  valueOf(): string {
    return this.source;
  }

  /** Compatibility aliases. Each delegates to the canonical name above; prefer those. */
  get(): string {
    return this.text();
  }

  meta(): NodeInfo[] {
    return this.nodes();
  }

  toJson(): Record<string, string>[] {
    return this.rows();
  }

  keyValue(): Record<string, string> {
    return this.entries();
  }

  setKeyValue(key: string, value: string | null): MarkdownQuery {
    return this.setEntry(key, value);
  }

  before(): MarkdownQuery {
    return this.preceding();
  }

  after(): MarkdownQuery {
    return this.following();
  }

  private editor(): MarkdownEditor {
    return new MarkdownEditor(this.source);
  }

  private run(candidates: MatchedRange[], segments: QuerySegment[]): MatchedRange[] {
    if (segments.length === 0) return candidates;

    const segment = segments[0];
    const remaining = segments.slice(1);

    if (/^section[1-6]?$/.test(segment.selector)) {
      const sections = this.narrow(this.sectionsOf(candidates, segment), segment);
      if (remaining.length === 0) return sections;

      const results: MatchedRange[] = [];
      for (const section of sections) results.push(...this.run(section.innerTokens || [], remaining));
      return results;
    }

    if (segment.selector === 'comment') {
      const comments = candidates.filter((range) => this.isComment(range.token));
      return this.run(this.narrow(this.filterByText(comments, segment), segment), remaining);
    }

    if (segment.selector === 'item') {
      return this.run(this.narrow(this.filterByText(this.itemsOf(candidates), segment), segment), remaining);
    }

    const depth = segment.selector.match(/^h([1-6])$/);
    let type = TOKEN_ALIASES[segment.selector] || segment.selector;
    if (depth) type = 'heading';

    let matches = candidates.filter((range) => range.token.type === type);
    if (depth) matches = matches.filter((range) => (range.token as any).depth === Number.parseInt(depth[1], 10));

    return this.run(this.narrow(this.filterByText(matches, segment), segment), remaining);
  }

  private sectionsOf(candidates: MatchedRange[], segment: QuerySegment): MatchedRange[] {
    const wanted = segment.selector.match(/^section([1-6])$/);
    const sections: MatchedRange[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const range = candidates[i];
      if (range.token.type !== 'heading') continue;

      const heading = range.token as Tokens.Heading;
      if (wanted && heading.depth !== Number.parseInt(wanted[1], 10)) continue;
      if (segment.textMatch && !this.matchText(heading.text, segment.textMatch)) continue;

      const innerTokens: MatchedRange[] = [];
      let end = range.start + range.length;

      for (let j = i + 1; j < candidates.length; j++) {
        const next = candidates[j];
        if (next.token.type === 'heading' && (next.token as Tokens.Heading).depth <= heading.depth) break;
        innerTokens.push(next);
        end = MarkdownEditor.blockEnd(next);
      }

      sections.push({ token: range.token, start: range.start, length: end - range.start, innerTokens });
    }

    return sections;
  }

  private itemsOf(candidates: MatchedRange[]): MatchedRange[] {
    const items: MatchedRange[] = [];

    for (const range of candidates) {
      if (range.token.type !== 'list') continue;

      const raw = (range.token as any).raw as string;
      let cursor = 0;

      for (const item of (range.token as Tokens.List).items) {
        const itemRaw = (item as any).raw as string;
        const at = raw.indexOf(itemRaw, cursor);
        if (at === -1) continue;
        items.push({ token: item as unknown as Token, start: range.start + at, length: itemRaw.length });
        cursor = at + itemRaw.length;
      }
    }

    return items;
  }

  private expandSections(matches: MatchedRange[]): MatchedRange[] {
    if (!matches.some((range) => range.innerTokens)) return matches;

    const expanded: MatchedRange[] = [];
    for (const range of matches) {
      if (!range.innerTokens) {
        expanded.push(range);
        continue;
      }
      expanded.push({ token: range.token, start: range.start, length: ((range.token as any).raw || '').length });
      expanded.push(...range.innerTokens);
    }
    return expanded;
  }

  private narrow(matches: MatchedRange[], segment: QuerySegment): MatchedRange[] {
    if (segment.index !== null) {
      let index = segment.index;
      if (index < 0) index = matches.length + index;
      if (index < 0 || index >= matches.length) return [];
      return [matches[index]];
    }
    if (segment.slice) return matches.slice(segment.slice.from, segment.slice.to);
    return matches;
  }

  private filterByText(matches: MatchedRange[], segment: QuerySegment): MatchedRange[] {
    if (!segment.textMatch) return matches;
    return matches.filter((range) => this.matchText(this.tokenText(range.token), segment.textMatch!));
  }

  private matchText(text: string, matcher: TextMatcher): boolean {
    let result = false;
    if (matcher.mode === 'exact') result = text === matcher.value;
    if (matcher.mode === 'contains') result = text.includes(matcher.value);
    if (matcher.mode === 'regex') result = new RegExp(matcher.value, matcher.flags || '').test(text);
    if (matcher.mode === 'predicate') result = matcher.predicate!(text);
    if (matcher.negated) return !result;
    return result;
  }

  private valueMatcher(matcher: Matcher): TextMatcher {
    if (typeof matcher === 'function') return { mode: 'predicate', value: '', negated: false, predicate: matcher };
    if (matcher instanceof RegExp) return { mode: 'regex', value: matcher.source, negated: false, flags: matcher.flags };
    return { mode: 'exact', value: matcher, negated: false };
  }

  private tokenText(token: Token): string {
    const value = token as any;
    if (this.isComment(token)) return (value.raw as string).trim().replace(/^<!--/, '').replace(/-->$/, '').trim();
    if (token.type === 'html') return value.raw || '';
    if (token.type === 'table') return [...(value.header || []).map((cell: any) => cell.text), ...(value.rows || []).flatMap((row: any) => row.map((cell: any) => cell.text))].join(', ');
    return value.text || '';
  }

  private isComment(token: Token): boolean {
    if (token.type !== 'html') return false;
    return (((token as any).raw as string) || '').trimStart().startsWith('<!--');
  }

  private insertAll(offsetOf: (range: MatchedRange) => number, markdown: Markdown): MarkdownQuery {
    return new MarkdownQuery(this.editor().insert(this.matches.map(offsetOf), String(markdown)));
  }

  private containerStart(range: MatchedRange): number {
    if (!range.innerTokens) throw new MdqOperationError(`prepend needs a section or list, got ${range.token.type}`);
    return range.start + (((range.token as any).raw as string) || '').length;
  }

  private containerEnd(range: MatchedRange): number {
    if (!range.innerTokens) throw new MdqOperationError(`append needs a section or list, got ${range.token.type}`);
    const last = range.innerTokens[range.innerTokens.length - 1];
    if (!last) return this.containerStart(range);
    return MarkdownEditor.blockEnd(last);
  }
}

export class MdqError extends Error {}

export class MdqSelectorError extends MdqError {
  index: number;

  constructor(message: string, index: number) {
    super(message);
    this.name = 'MdqSelectorError';
    this.index = index;
  }
}

export class MdqOperationError extends MdqError {
  constructor(message: string) {
    super(message);
    this.name = 'MdqOperationError';
  }
}

export function mdq(source: Markdown): MarkdownQuery {
  return new MarkdownQuery(String(source));
}

export function parseQuery(input: string): QuerySegment[] {
  const segments: QuerySegment[] = [];
  SEGMENT.lastIndex = 0;

  while (SEGMENT.lastIndex < input.length) {
    const at = SEGMENT.lastIndex;
    const match = SEGMENT.exec(input);
    if (!match) throw new MdqSelectorError(`Unexpected character "${input[at]}" in selector`, at);

    const [, prefix, name, negated, contains, quoted, pattern, flags, brackets] = match;
    if (!SELECTOR_NAMES.has(name) && !/^(?:h|section)[1-6]$/.test(name)) throw new MdqSelectorError(`Unknown selector "${name}"`, at + prefix.length);

    const segment: QuerySegment = { selector: name as SelectorType, index: null, slice: null };

    if (quoted !== undefined) {
      let mode: TextMatcher['mode'] = 'exact';
      if (contains) mode = 'contains';
      segment.textMatch = { mode, value: quoted.replace(/\\(.)/g, '$1'), negated: Boolean(negated) };
    }
    if (pattern !== undefined) {
      segment.textMatch = { mode: 'regex', value: pattern, negated: Boolean(negated), flags };
    }

    for (const [, bounds] of brackets.matchAll(/\[([^\]]*)\]/g)) {
      if (!bounds || !/^-?\d*(?::-?\d*)?$/.test(bounds)) continue;
      if (!bounds.includes(':')) {
        segment.index = Number.parseInt(bounds, 10);
        continue;
      }
      const [from, to] = bounds.split(':');
      segment.slice = {};
      if (from) segment.slice.from = Number.parseInt(from, 10);
      if (to) segment.slice.to = Number.parseInt(to, 10);
    }

    segments.push(segment);
  }

  return segments;
}

export function buildTokenIndex(source: string): MatchedRange[] {
  const { body, offset } = MarkdownEditor.splitFrontmatter(source);
  const ranges: MatchedRange[] = [];
  let cursor = offset;

  for (const token of marked.lexer(body)) {
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

const SELECTOR_NAMES = new Set(['section', 'heading', 'paragraph', 'table', 'list', 'item', 'code', 'blockquote', 'hr', 'html', 'comment']);

const TOKEN_ALIASES: Record<string, string> = { item: 'list_item' };

const SEGMENT = /(\s*\.?)([A-Za-z]\w*)(?:\((!?)(~?)(?:"((?:[^"\\]|\\.)*)"|\/((?:[^/\\]|\\.)*)\/([a-z]*))\))?((?:\[[^\]]*\])*)\s*/y;

export type Markdown = string | MarkdownQuery;

export type Matcher = string | RegExp | ((text: string) => boolean);

export type SelectorType = 'comment' | 'html' | 'section' | 'section1' | 'section2' | 'section3' | 'section4' | 'section5' | 'section6' | 'table' | 'heading' | 'paragraph' | 'list' | 'item' | 'code' | 'blockquote' | 'hr' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface SelectorOptions {
  depth?: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface TextMatcher {
  mode: 'exact' | 'contains' | 'regex' | 'predicate';
  value: string;
  negated: boolean;
  flags?: string;
  predicate?: (text: string) => boolean;
}

export interface QuerySegment {
  selector: SelectorType;
  textMatch?: TextMatcher;
  index: number | null;
  slice: { from?: number; to?: number } | null;
}

export interface MatchedRange {
  token: Token;
  start: number;
  length: number;
  trailing?: { start: number; length: number };
  innerTokens?: MatchedRange[];
}

export interface NodeInfo {
  type: string;
  depth: number | null;
  text: string;
}
