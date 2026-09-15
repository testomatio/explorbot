import { type Token, type Tokens, marked } from 'marked';
import { blockEnd, dedupeRanges, insertAt, readFrontmatter, removeRanges, renderItem, renderTable, spliceRanges, splitFrontmatter, writeFrontmatter } from './edit.ts';

export { splitFrontmatter };

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

const SELECTORS = new Set(['section', 'heading', 'paragraph', 'table', 'list', 'item', 'code', 'blockquote', 'hr', 'html', 'comment']);

function isKnownSelector(selector: string): boolean {
  if (/^h[1-6]$/.test(selector)) return true;
  if (/^section[1-6]?$/.test(selector)) return true;
  return SELECTORS.has(selector);
}

function isCommentToken(token: Token): boolean {
  if (token.type !== 'html') return false;
  return (((token as any).raw as string) || '').trimStart().startsWith('<!--');
}

function commentBody(token: Token): string {
  const raw = (((token as any).raw as string) || '').trim();
  return raw.replace(/^<!--/, '').replace(/-->$/, '').trim();
}

export function parseQuery(input: string): QuerySegment[] {
  const segments: QuerySegment[] = [];
  let pos = 0;

  function peek(): string {
    if (pos >= input.length) return '';
    return input[pos];
  }

  function advance(): string {
    return input[pos++] || '';
  }

  function skipWhitespace() {
    while (pos < input.length && /\s/.test(input[pos])) pos++;
  }

  function readIdentifier(): string {
    const start = pos;
    while (pos < input.length && /[a-zA-Z_\d]/.test(input[pos])) pos++;
    return input.slice(start, pos);
  }

  function readQuotedString(): string {
    const quote = advance();
    let result = '';
    while (pos < input.length && input[pos] !== quote) {
      if (input[pos] === '\\') {
        pos++;
        result += input[pos] || '';
      } else {
        result += input[pos];
      }
      pos++;
    }
    if (pos < input.length) pos++;
    return result;
  }

  function readUntilAny(chars: string): string {
    const start = pos;
    while (pos < input.length && !chars.includes(input[pos])) pos++;
    return input.slice(start, pos);
  }

  function parseTextMatcher(): TextMatcher {
    let negated = false;
    if (peek() === '!') {
      negated = true;
      advance();
    }

    if (peek() === '~') {
      advance();
      const value = readQuotedString();
      return { mode: 'contains', value, negated };
    }

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

    const value = readQuotedString();
    return { mode: 'exact', value, negated };
  }

  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;

    if (peek() === '.') advance();
    const selectorStart = pos;
    const selector = readIdentifier();
    if (!selector) throw new MdqSelectorError(`Unexpected character "${input[pos]}" in selector`, pos);
    if (!isKnownSelector(selector)) throw new MdqSelectorError(`Unknown selector "${selector}"`, selectorStart);

    const segment: QuerySegment = {
      selector: selector as SelectorType,
      index: null,
      slice: null,
    };

    if (peek() === '(') {
      advance();
      segment.textMatch = parseTextMatcher();
      if (peek() === ')') advance();
    }

    while (peek() === '[') {
      advance();
      const content = readUntilAny(']');
      if (/^-?\d*(:-?\d*)?$/.test(content) && content !== '') {
        if (content.includes(':')) {
          const colonIdx = content.indexOf(':');
          const fromStr = content.slice(0, colonIdx);
          const toStr = content.slice(colonIdx + 1);
          segment.slice = {
            from: parseBound(fromStr),
            to: parseBound(toStr),
          };
        } else {
          segment.index = Number.parseInt(content, 10);
        }
      }
      if (peek() === ']') advance();
    }

    segments.push(segment);
  }

  return segments;
}

function parseBound(value: string): number | undefined {
  if (!value) return undefined;
  return Number.parseInt(value, 10);
}

function toTextMatcher(matcher: Matcher): TextMatcher {
  if (typeof matcher === 'function') return { mode: 'predicate', value: '', negated: false, predicate: matcher };
  if (matcher instanceof RegExp) return { mode: 'regex', value: matcher.source, negated: false, flags: matcher.flags };
  return { mode: 'exact', value: matcher, negated: false };
}

function applyMatcher(segments: QuerySegment[], matcher?: Matcher): QuerySegment[] {
  if (matcher === undefined) return segments;
  if (segments.length === 0) return segments;
  segments[segments.length - 1].textMatch = toTextMatcher(matcher);
  return segments;
}

function matchText(text: string, matcher: TextMatcher): boolean {
  let result: boolean;

  switch (matcher.mode) {
    case 'exact':
      result = text === matcher.value;
      break;
    case 'contains':
      result = text.includes(matcher.value);
      break;
    case 'regex':
      result = new RegExp(matcher.value, matcher.flags || '').test(text);
      break;
    case 'predicate':
      result = matcher.predicate!(text);
      break;
    default:
      result = false;
  }

  if (matcher.negated) return !result;
  return result;
}

function entryKey(line: string): string | null {
  const separator = line.indexOf(':');
  if (separator < 1) return null;
  return line.slice(0, separator).trim().toLowerCase();
}

function getTokenText(token: Token): string {
  const t = token as any;
  switch (token.type) {
    case 'heading':
    case 'paragraph':
    case 'code':
    case 'blockquote':
    case 'list_item':
      return t.text || '';
    case 'html':
      if (isCommentToken(token)) return commentBody(token);
      return t.raw || '';
    case 'table':
      return [...(t.header || []).map((h: any) => h.text), ...(t.rows || []).flatMap((row: any) => row.map((cell: any) => cell.text))].join(', ');
    default:
      return '';
  }
}

function getHeadingDepth(selector: string): number | null {
  const match = selector.match(/^h([1-6])$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function isSectionSelector(selector: string): boolean {
  return /^section\d?$/.test(selector);
}

function getSectionDepth(selector: string): number | null {
  const match = selector.match(/^section([1-6])$/);
  if (!match) return null;
  return Number.parseInt(match[1], 10);
}

function selectorToTokenType(selector: string): string | null {
  if (/^h[1-6]$/.test(selector)) return 'heading';
  const map: Record<string, string> = {
    heading: 'heading',
    paragraph: 'paragraph',
    table: 'table',
    code: 'code',
    list: 'list',
    blockquote: 'blockquote',
    hr: 'hr',
    html: 'html',
    item: 'list_item',
  };
  return map[selector] || null;
}

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

function computeSections(candidates: MatchedRange[], segment: QuerySegment): MatchedRange[] {
  const sectionDepth = getSectionDepth(segment.selector as string);
  const sections: MatchedRange[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const range = candidates[i];
    if (range.token.type !== 'heading') continue;

    const heading = range.token as Tokens.Heading;
    if (sectionDepth !== null && heading.depth !== sectionDepth) continue;
    if (segment.textMatch && !matchText(heading.text, segment.textMatch)) continue;

    const depth = heading.depth;
    const innerTokens: MatchedRange[] = [];
    let endOffset = range.start + range.length;

    for (let j = i + 1; j < candidates.length; j++) {
      const nextRange = candidates[j];
      if (nextRange.token.type === 'heading' && (nextRange.token as Tokens.Heading).depth <= depth) break;
      innerTokens.push(nextRange);
      endOffset = nextRange.start + nextRange.length;
      if (nextRange.trailing) endOffset = nextRange.trailing.start + nextRange.trailing.length;
    }

    sections.push({
      token: range.token,
      start: range.start,
      length: endOffset - range.start,
      innerTokens,
    });
  }

  return sections;
}

function extractListItems(candidates: MatchedRange[]): MatchedRange[] {
  const items: MatchedRange[] = [];

  for (const range of candidates) {
    if (range.token.type !== 'list') continue;

    const list = range.token as Tokens.List;
    const listRaw = (range.token as any).raw as string;
    let searchFrom = 0;

    for (const item of list.items) {
      const itemRaw = (item as any).raw as string;
      const idx = listRaw.indexOf(itemRaw, searchFrom);
      if (idx === -1) continue;

      items.push({
        token: item as unknown as Token,
        start: range.start + idx,
        length: itemRaw.length,
      });

      searchFrom = idx + itemRaw.length;
    }
  }

  return items;
}

function applyIndexSlice(matches: MatchedRange[], segment: QuerySegment): MatchedRange[] {
  if (segment.index !== null) {
    let idx = segment.index;
    if (idx < 0) idx = matches.length + idx;
    if (idx < 0 || idx >= matches.length) return [];
    return [matches[idx]];
  }

  if (segment.slice) {
    const { from, to } = segment.slice;
    return matches.slice(from, to);
  }

  return matches;
}

function expandSectionRanges(matches: MatchedRange[]): MatchedRange[] {
  let hasSection = false;
  for (const m of matches) {
    if (m.innerTokens) {
      hasSection = true;
      break;
    }
  }
  if (!hasSection) return matches;

  const expanded: MatchedRange[] = [];
  for (const m of matches) {
    if (m.innerTokens) {
      expanded.push({ token: m.token, start: m.start, length: ((m.token as any).raw || '').length });
      expanded.push(...m.innerTokens);
    } else {
      expanded.push(m);
    }
  }
  return expanded;
}

function executeSegments(candidates: MatchedRange[], segments: QuerySegment[]): MatchedRange[] {
  if (segments.length === 0) return candidates;

  const segment = segments[0];
  const remaining = segments.slice(1);

  if (isSectionSelector(segment.selector as string)) {
    const sections = computeSections(candidates, segment);
    const indexed = applyIndexSlice(sections, segment);

    if (remaining.length === 0) return indexed;

    const results: MatchedRange[] = [];
    for (const section of indexed) {
      results.push(...executeSegments(section.innerTokens || [], remaining));
    }
    return results;
  }

  if (segment.selector === 'comment') {
    let comments = candidates.filter((r) => isCommentToken(r.token));
    if (segment.textMatch) comments = comments.filter((r) => matchText(commentBody(r.token), segment.textMatch!));
    return executeSegments(applyIndexSlice(comments, segment), remaining);
  }

  if (segment.selector === 'item') {
    let items = extractListItems(candidates);
    if (segment.textMatch) {
      items = items.filter((r) => matchText(getTokenText(r.token), segment.textMatch!));
    }
    return executeSegments(applyIndexSlice(items, segment), remaining);
  }

  const tokenType = selectorToTokenType(segment.selector as string);
  if (!tokenType) return [];

  let matches = candidates.filter((r) => r.token.type === tokenType);

  const depth = getHeadingDepth(segment.selector as string);
  if (depth !== null) {
    matches = matches.filter((r) => (r.token as any).depth === depth);
  }

  if (segment.textMatch) {
    matches = matches.filter((r) => matchText(getTokenText(r.token), segment.textMatch!));
  }

  return executeSegments(applyIndexSlice(matches, segment), remaining);
}

export class MarkdownDoc {
  protected source: string;

  constructor(source: string) {
    this.source = source;
  }

  query(selector: string, matcher?: Matcher): Selection {
    const segments = applyMatcher(parseQuery(selector), matcher);
    const candidates = expandSectionRanges(buildTokenIndex(this.source));
    return new Selection(this.source, executeSegments(candidates, segments));
  }

  frontmatter(): Record<string, unknown> {
    return readFrontmatter(this.source);
  }

  setFrontmatter(key: string, value: unknown): MarkdownDoc {
    return new MarkdownDoc(writeFrontmatter(this.source, key, value));
  }

  blocks(): Selection {
    return new Selection(this.source);
  }

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

  append(markdown: Markdown): MarkdownDoc {
    return new MarkdownDoc(insertAt(this.source, this.source.length, String(markdown)));
  }

  prepend(markdown: Markdown): MarkdownDoc {
    return new MarkdownDoc(insertAt(this.source, splitFrontmatter(this.source).offset, String(markdown)));
  }

  toString(): string {
    return this.source;
  }

  valueOf(): string {
    return this.source;
  }
}

export class Selection extends MarkdownDoc {
  private matches: MatchedRange[];

  constructor(source: string, matches?: MatchedRange[]) {
    super(source);
    this.matches = matches || buildTokenIndex(source);
  }

  query(selector: string, matcher?: Matcher): Selection {
    const segments = applyMatcher(parseQuery(selector), matcher);
    const candidates = expandSectionRanges(this.matches);
    return new Selection(this.source, executeSegments(candidates, segments));
  }

  text(): string {
    return this.matches.map((r) => this.source.slice(r.start, r.start + r.length)).join('');
  }

  toString(): string {
    return this.text();
  }

  /** @deprecated Use text(). */
  get(): string {
    return this.text();
  }

  rows(): Record<string, string>[] {
    const results: Record<string, string>[] = [];

    for (const range of this.matches) {
      if (range.token.type !== 'table') continue;

      const table = range.token as Tokens.Table;
      const headers = table.header.map((h) => h.text);
      for (const row of table.rows) {
        const obj: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          obj[headers[i]] = row[i]?.text ?? '';
        }
        results.push(obj);
      }
    }

    return results;
  }

  /** @deprecated Use rows(). */
  toJson(): Record<string, string>[] {
    return this.rows();
  }

  entries(): Record<string, string> {
    const entries: Record<string, string> = {};

    for (const range of this.matches) {
      for (const line of getTokenText(range.token).split('\n')) {
        const key = entryKey(line);
        if (!key) continue;
        const value = line.slice(line.indexOf(':') + 1).trim();
        if (value) entries[key] = value;
      }
    }

    return entries;
  }

  /** @deprecated Use entries(). */
  keyValue(): Record<string, string> {
    return this.entries();
  }

  setEntry(key: string, value: string | null): MarkdownDoc {
    return this.replaceEach((match) => {
      const token = match.matches[0].token;
      const lines = getTokenText(token)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      const index = lines.findIndex((line) => entryKey(line) === key.toLowerCase());
      if (index < 0 && value) lines.push(`${key}: ${value}`);
      if (index >= 0 && value) lines[index] = `${key}: ${value}`;
      if (index >= 0 && !value) lines.splice(index, 1);

      if (token.type !== 'blockquote') return lines.join('\n');
      return lines.map((line) => `> ${line}`).join('\n');
    });
  }

  /** @deprecated Use setEntry(). */
  setKeyValue(key: string, value: string | null): MarkdownDoc {
    return this.setEntry(key, value);
  }

  remove(): MarkdownDoc {
    return new MarkdownDoc(removeRanges(this.source, this.matches));
  }

  insertBefore(markdown: Markdown): MarkdownDoc {
    return this.insertEach((range) => range.start, markdown);
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
        const raw = (((range.token as any).raw as string) || '').replace(/\s+$/, '');
        return `${raw}\n${renderItem(raw, text)}\n`;
      })
    );
  }

  replace(content: Markdown): MarkdownDoc {
    return this.replaceEach(() => content);
  }

  replaceEach(replacer: (match: Selection, index: number) => Markdown): MarkdownDoc {
    const kept = dedupeRanges(this.matches);
    const replacements = kept.map((range, index) => String(replacer(new Selection(this.source, [range]), index)));
    let result = this.source;
    for (let i = kept.length - 1; i >= 0; i--) {
      const range = kept[i];
      result = result.slice(0, range.start) + replacements[i] + result.slice(range.start + range.length);
    }

    return new MarkdownDoc(result);
  }

  count(): number {
    return this.matches.length;
  }

  exists(): boolean {
    return this.matches.length > 0;
  }

  at(index: number): Selection {
    let resolved = index;
    if (resolved < 0) resolved = this.matches.length + resolved;
    if (resolved < 0 || resolved >= this.matches.length) return new Selection(this.source, []);
    return new Selection(this.source, [this.matches[resolved]]);
  }

  slice(from?: number, to?: number): Selection {
    return new Selection(this.source, this.matches.slice(from, to));
  }

  first(): Selection {
    return new Selection(this.source, this.matches.slice(0, 1));
  }

  last(): Selection {
    return new Selection(this.source, this.matches.slice(-1));
  }

  preceding(): Selection {
    if (this.matches.length === 0) return new Selection(this.source, []);
    const cutoff = this.matches[0].start;
    return new Selection(
      this.source,
      buildTokenIndex(this.source).filter((r) => r.start + r.length <= cutoff)
    );
  }

  /** @deprecated Use preceding(). */
  before(): Selection {
    return this.preceding();
  }

  following(): Selection {
    if (this.matches.length === 0) return new Selection(this.source, []);
    const lastMatch = this.matches[this.matches.length - 1];
    const cutoff = lastMatch.start + lastMatch.length;
    return new Selection(
      this.source,
      buildTokenIndex(this.source).filter((r) => r.start >= cutoff)
    );
  }

  /** @deprecated Use following(). */
  after(): Selection {
    return this.following();
  }

  each(): Selection[] {
    return this.matches.map((m) => new Selection(this.source, [m]));
  }

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
    return range.start + (((range.token as any).raw as string) || '').length;
  }

  private containerEnd(range: MatchedRange): number {
    if (!range.innerTokens) throw new MdqOperationError(`append needs a section or list, got ${range.token.type}`);
    const last = range.innerTokens[range.innerTokens.length - 1];
    if (!last) return this.containerStart(range);
    return blockEnd(last);
  }
}

/** @deprecated Use Selection. */
export const MarkdownQuery = Selection;

export function mdq(source: Markdown): MarkdownDoc {
  return new MarkdownDoc(String(source));
}

export type SelectorType = 'comment' | 'html' | 'section' | 'section1' | 'section2' | 'section3' | 'section4' | 'section5' | 'section6' | 'table' | 'heading' | 'paragraph' | 'list' | 'item' | 'code' | 'blockquote' | 'hr' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface TextMatcher {
  mode: 'exact' | 'contains' | 'regex' | 'predicate';
  value: string;
  negated: boolean;
  flags?: string;
  predicate?: (text: string) => boolean;
}

export type Matcher = string | RegExp | ((text: string) => boolean);

export interface SelectorOptions {
  depth?: 1 | 2 | 3 | 4 | 5 | 6;
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

export type Markdown = string | MarkdownDoc;

export interface NodeInfo {
  type: string;
  depth: number | null;
  text: string;
}
