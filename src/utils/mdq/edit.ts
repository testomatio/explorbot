import YAML from 'yaml';
import type { MatchedRange } from './query.ts';

export class MarkdownEditor {
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  static splitFrontmatter(source: string): FrontmatterSplit {
    if (!source.startsWith('---')) return { raw: '', body: source, offset: 0 };
    const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) return { raw: '', body: source, offset: 0 };
    return { raw: match[1], body: source.slice(match[0].length), offset: match[0].length };
  }

  static blockEnd(range: MatchedRange): number {
    if (range.trailing) return range.trailing.start + range.trailing.length;
    return range.start + range.length;
  }

  static table(headers: string[], rows: string[][], align: (string | null)[]): string {
    const widths = headers.map((header, index) => Math.max(header.length, 3, ...rows.map((row) => (row[index] || '').length)));
    const line = (cells: string[]) => `| ${cells.map((cell, index) => (cell || '').padEnd(widths[index])).join(' | ')} |`;
    const divider = `| ${widths.map((width, index) => MarkdownEditor.dashes(align[index], width)).join(' | ')} |`;
    return `${[line(headers), divider, ...rows.map(line)].join('\n')}\n`;
  }

  static item(listRaw: string, text: string): string {
    const lines = listRaw.split('\n').filter((line) => line.trim());
    const last = lines[lines.length - 1] || '- x';
    const ordered = last.match(/^(\s*)(\d+)([.)])\s/);
    if (ordered) return `${ordered[1]}${Number.parseInt(ordered[2], 10) + 1}${ordered[3]} ${text}`;
    const bullet = last.match(/^(\s*)([-*+])\s/);
    if (!bullet) return `- ${text}`;
    return `${bullet[1]}${bullet[2]} ${text}`;
  }

  static entries(text: string, key: string, value: string | null, isBlockquote: boolean): string {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const index = lines.findIndex((line) => MarkdownEditor.entryKey(line) === key.toLowerCase());
    if (index < 0 && value) lines.push(`${key}: ${value}`);
    if (index >= 0 && value) lines[index] = `${key}: ${value}`;
    if (index >= 0 && !value) lines.splice(index, 1);

    if (!isBlockquote) return lines.join('\n');
    return lines.map((line) => `> ${line}`).join('\n');
  }

  remove(ranges: MatchedRange[]): string {
    const ordered = this.dedupe(ranges);
    let result = this.source;

    for (let i = ordered.length - 1; i >= 0; i--) {
      const range = ordered[i];
      const head = result.slice(0, range.start);
      const tail = result.slice(MarkdownEditor.blockEnd(range));
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

  replace(ranges: MatchedRange[], render: (range: MatchedRange, index: number) => string): string {
    const ordered = this.dedupe(ranges);
    const rendered = ordered.map(render);
    let result = this.source;

    for (let i = ordered.length - 1; i >= 0; i--) {
      const range = ordered[i];
      result = result.slice(0, range.start) + rendered[i] + result.slice(range.start + range.length);
    }

    return result;
  }

  insert(offsets: number[], markdown: string): string {
    const ordered = [...offsets].sort((a, b) => a - b);
    let result = this.source;
    for (let i = ordered.length - 1; i >= 0; i--) {
      result = MarkdownEditor.spliceIn(result, ordered[i], markdown);
    }
    return result;
  }

  frontmatter(): Record<string, unknown> {
    const { raw } = MarkdownEditor.splitFrontmatter(this.source);
    if (!raw) return {};
    return (YAML.parseDocument(raw).toJS() as Record<string, unknown>) || {};
  }

  setFrontmatter(key: string, value: unknown): string {
    const { raw, body, offset } = MarkdownEditor.splitFrontmatter(this.source);
    let document = new YAML.Document({});
    if (raw) document = YAML.parseDocument(raw);
    if (value === null) document.delete(key);
    if (value !== null) document.set(key, value);

    const rendered = document.toString().trimEnd();
    if (!offset) return `---\n${rendered}\n---\n\n${this.source}`;
    return `---\n${rendered}\n---\n${body}`;
  }

  private static spliceIn(source: string, offset: number, markdown: string): string {
    const block = `${markdown.trimEnd()}\n`;
    const before = source.slice(0, offset).replace(/\n+$/, '');
    const after = source.slice(offset).replace(/^\n+/, '');
    if (!before) return `${block}\n${after}`;
    if (!after) return `${before}\n\n${block}`;
    return `${before}\n\n${block}\n${after}`;
  }

  private static dashes(alignment: string | null, width: number): string {
    if (alignment === 'center') return `:${'-'.repeat(Math.max(width - 2, 1))}:`;
    if (alignment === 'left') return `:${'-'.repeat(Math.max(width - 1, 1))}`;
    if (alignment === 'right') return `${'-'.repeat(Math.max(width - 1, 1))}:`;
    return '-'.repeat(width);
  }

  private static entryKey(line: string): string | null {
    const separator = line.indexOf(':');
    if (separator < 1) return null;
    return line.slice(0, separator).trim().toLowerCase();
  }

  private dedupe(ranges: MatchedRange[]): MatchedRange[] {
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
}

export interface FrontmatterSplit {
  raw: string;
  body: string;
  offset: number;
}
