import type { MatchedRange } from './query.ts';

export function splitFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith('---')) return { raw: '', body: source, offset: 0 };
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { raw: '', body: source, offset: 0 };
  return { raw: match[1], body: source.slice(match[0].length), offset: match[0].length };
}

export function dedupeRanges(ranges: MatchedRange[]): MatchedRange[] {
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

export function blockEnd(range: MatchedRange): number {
  if (range.trailing) return range.trailing.start + range.trailing.length;
  return range.start + range.length;
}

export function normalizeBlock(markdown: string): string {
  return `${markdown.replace(/\s+$/, '')}\n`;
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

export interface FrontmatterSplit {
  raw: string;
  body: string;
  offset: number;
}
