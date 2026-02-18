import { marked, type Token, type Tokens } from 'marked';

export type SelectorType = 'section' | 'section1' | 'section2' | 'section3' | 'section4' | 'section5' | 'section6' | 'table' | 'heading' | 'paragraph' | 'list' | 'item' | 'code' | 'blockquote' | 'hr' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface TextMatcher {
  mode: 'exact' | 'contains' | 'regex';
  value: string;
  negated: boolean;
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
  innerTokens?: MatchedRange[];
}

export function parseQuery(input: string): QuerySegment[] {
  const segments: QuerySegment[] = [];
  let pos = 0;

  function peek(): string {
    return pos < input.length ? input[pos] : '';
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
      while (pos < input.length && /[gimsuy]/.test(input[pos])) pos++;
      return { mode: 'regex', value, negated };
    }

    const value = readQuotedString();
    return { mode: 'exact', value, negated };
  }

  while (pos < input.length) {
    skipWhitespace();
    if (pos >= input.length) break;

    const selector = readIdentifier();
    if (!selector) {
      pos++;
      continue;
    }

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
            from: fromStr ? Number.parseInt(fromStr, 10) : undefined,
            to: toStr ? Number.parseInt(toStr, 10) : undefined,
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
      result = new RegExp(matcher.value, 'i').test(text);
      break;
    default:
      result = false;
  }

  return matcher.negated ? !result : result;
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
    case 'table':
      return (t.header || []).map((h: any) => h.text).join(', ');
    default:
      return '';
  }
}

function getHeadingDepth(selector: string): number | null {
  const match = selector.match(/^h([1-6])$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

function isSectionSelector(selector: string): boolean {
  return /^section\d?$/.test(selector);
}

function getSectionDepth(selector: string): number | null {
  const match = selector.match(/^section([1-6])$/);
  return match ? Number.parseInt(match[1], 10) : null;
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
    item: 'list_item',
  };
  return map[selector] || null;
}

function buildTokenIndex(source: string): MatchedRange[] {
  const tokens = marked.lexer(source);
  const ranges: MatchedRange[] = [];
  let offset = 0;

  for (const token of tokens) {
    const raw = (token as any).raw || '';
    ranges.push({ token, start: offset, length: raw.length });
    offset += raw.length;
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
    const idx = segment.index < 0 ? matches.length + segment.index : segment.index;
    return idx >= 0 && idx < matches.length ? [matches[idx]] : [];
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

export class MarkdownQuery {
  private source: string;
  private matches: MatchedRange[];

  constructor(source: string, matches?: MatchedRange[]) {
    this.source = source;
    this.matches = matches || buildTokenIndex(source);
  }

  query(selector: string): MarkdownQuery {
    const segments = parseQuery(selector);
    const candidates = expandSectionRanges(this.matches);
    const results = executeSegments(candidates, segments);
    return new MarkdownQuery(this.source, results);
  }

  text(): string {
    return this.matches.map((r) => this.source.slice(r.start, r.start + r.length)).join('');
  }

  get(): string {
    return this.text();
  }

  toJson(): Record<string, string>[] {
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

  replace(content: string): string {
    const sorted = [...this.matches].sort((a, b) => a.start - b.start);

    const kept: MatchedRange[] = [];
    let lastEnd = -1;
    for (const range of sorted) {
      if (range.start < lastEnd) continue;
      kept.push(range);
      lastEnd = range.start + range.length;
    }

    let result = this.source;
    for (let i = kept.length - 1; i >= 0; i--) {
      const range = kept[i];
      result = result.slice(0, range.start) + content + result.slice(range.start + range.length);
    }

    return result;
  }

  count(): number {
    return this.matches.length;
  }

  first(): MarkdownQuery {
    return new MarkdownQuery(this.source, this.matches.slice(0, 1));
  }

  last(): MarkdownQuery {
    return new MarkdownQuery(this.source, this.matches.slice(-1));
  }

  before(): MarkdownQuery {
    if (this.matches.length === 0) return new MarkdownQuery(this.source, []);
    const cutoff = this.matches[0].start;
    const allTokens = buildTokenIndex(this.source);
    const beforeTokens = allTokens.filter((r) => r.start + r.length <= cutoff);
    return new MarkdownQuery(this.source, beforeTokens);
  }

  after(): MarkdownQuery {
    if (this.matches.length === 0) return new MarkdownQuery(this.source, []);
    const lastMatch = this.matches[this.matches.length - 1];
    const cutoff = lastMatch.start + lastMatch.length;
    const allTokens = buildTokenIndex(this.source);
    const afterTokens = allTokens.filter((r) => r.start >= cutoff);
    return new MarkdownQuery(this.source, afterTokens);
  }

  each(): MarkdownQuery[] {
    return this.matches.map((m) => new MarkdownQuery(this.source, [m]));
  }
}

export function mdq(source: string): MarkdownQuery {
  return new MarkdownQuery(source);
}
