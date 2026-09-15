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

export interface FrontmatterSplit {
  raw: string;
  body: string;
  offset: number;
}
