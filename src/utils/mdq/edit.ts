import YAML from 'yaml';
import type { MatchedRange } from './query.ts';

export function splitFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith('---')) return { raw: '', body: source, offset: 0 };
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { raw: '', body: source, offset: 0 };
  return { raw: match[1], body: source.slice(match[0].length), offset: match[0].length };
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

export function blockEnd(range: MatchedRange): number {
  if (range.trailing) return range.trailing.start + range.trailing.length;
  return range.start + range.length;
}

export function normalizeBlock(markdown: string): string {
  return `${markdown.trimEnd()}\n`;
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
    result = `${head.trimEnd()}\n`;
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

export function renderTable(headers: string[], rows: string[][], align: (string | null)[]): string {
  const widths = headers.map((header, index) => Math.max(header.length, 3, ...rows.map((row) => (row[index] || '').length)));
  const line = (cells: string[]) => `| ${cells.map((cell, index) => (cell || '').padEnd(widths[index])).join(' | ')} |`;
  const divider = `| ${widths.map((width, index) => dashes(align[index], width)).join(' | ')} |`;
  return `${[line(headers), divider, ...rows.map(line)].join('\n')}\n`;
}

export function renderItem(listRaw: string, text: string): string {
  const lines = listRaw.split('\n').filter((line) => line.trim());
  const last = lines[lines.length - 1] || '- x';
  const ordered = last.match(/^(\s*)(\d+)([.)])\s/);
  if (ordered) return `${ordered[1]}${Number.parseInt(ordered[2], 10) + 1}${ordered[3]} ${text}`;
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

export function entryKey(line: string): string | null {
  const separator = line.indexOf(':');
  if (separator < 1) return null;
  return line.slice(0, separator).trim().toLowerCase();
}

export function rewriteEntries(text: string, key: string, value: string | null, isBlockquote: boolean): string {
  const lines = text
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

export function readFrontmatter(source: string): Record<string, unknown> {
  const { raw } = splitFrontmatter(source);
  if (!raw) return {};
  return (YAML.parseDocument(raw).toJS() as Record<string, unknown>) || {};
}

export function writeFrontmatter(source: string, key: string, value: unknown): string {
  const { raw, body, offset } = splitFrontmatter(source);
  let document = new YAML.Document({});
  if (raw) document = YAML.parseDocument(raw);
  if (value === null) document.delete(key);
  if (value !== null) document.set(key, value);
  const rendered = document.toString().trimEnd();
  if (!offset) return `---\n${rendered}\n---\n\n${source}`;
  return `---\n${rendered}\n---\n${body}`;
}

export interface FrontmatterSplit {
  raw: string;
  body: string;
  offset: number;
}
