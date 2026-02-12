import { marked } from 'marked';

export interface MarkdownSection {
  name: string;
  depth: number;
  rawMarkdown: string;
}

export function parseSections(markdown: string, opts?: { minDepth?: number; maxDepth?: number }): MarkdownSection[] {
  const { minDepth = 2, maxDepth = 3 } = opts || {};
  const tokens = marked.lexer(markdown);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;

  for (const token of tokens) {
    const depth = (token as any).depth;
    if (token.type === 'heading' && depth >= minDepth && depth <= maxDepth) {
      current = { name: (token as any).text, depth, rawMarkdown: (token as any).raw };
      sections.push(current);
      continue;
    }
    if (current) {
      current.rawMarkdown += (token as any).raw || '';
    }
  }

  return sections;
}

export function extractLabeledCode(markdown: string, labelPattern: RegExp): string | null {
  const tokens = marked.lexer(markdown);
  let expectValueInNext = false;

  for (const token of tokens) {
    if (token.type === 'heading' && labelPattern.test((token as any).text || '')) {
      expectValueInNext = true;
      continue;
    }

    if (expectValueInNext) {
      if (token.type === 'code') {
        const val = ((token as any).text as string).trim();
        if (val && !val.includes('\n')) return val;
        expectValueInNext = false;
        continue;
      }
      if (token.type === 'paragraph') {
        const codespan = ((token as any).tokens || []).find((t: any) => t.type === 'codespan');
        if (codespan) return codespan.text;
        expectValueInNext = false;
      }
      if (token.type !== 'space') expectValueInNext = false;
    }

    if (token.type === 'paragraph' || token.type === 'blockquote') {
      const raw = (token as any).raw || '';
      if (!labelPattern.test(raw)) continue;

      const codespans = ((token as any).tokens || []).filter((t: any) => t.type === 'codespan');
      if (codespans.length > 0) return codespans[codespans.length - 1].text;

      const match = raw.match(labelPattern);
      if (match) {
        const afterLabel = raw.substring(match.index! + match[0].length);
        const quotedMatch = afterLabel.match(/['"`]([^'"`]+)['"`]/);
        if (quotedMatch) return quotedMatch[1];
      }

      expectValueInNext = true;
    }
  }

  return null;
}

export function tableToJson(markdown: string): Record<string, string>[] {
  const tokens = marked.lexer(markdown);
  for (const token of tokens) {
    if (token.type !== 'table') continue;
    const tableToken = token as any;
    const headers: string[] = tableToken.header.map((h: any) => h.text);
    return tableToken.rows.map((row: any) => {
      const obj: Record<string, string> = {};
      for (let i = 0; i < headers.length; i++) {
        obj[headers[i]] = row[i]?.text ?? '';
      }
      return obj;
    });
  }
  return [];
}

export function jsonToTable(rows: Record<string, string>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const headers = columns || Object.keys(rows[0]);
  let md = `| ${headers.join(' | ')} |\n`;
  md += `|${headers.map(() => '------|').join('')}\n`;
  for (const row of rows) {
    md += `| ${headers.map((h) => row[h] ?? '-').join(' | ')} |\n`;
  }
  return md;
}

export function findTableRaw(markdown: string): string | null {
  const tokens = marked.lexer(markdown);
  for (const token of tokens) {
    if (token.type === 'table') return (token as any).raw;
  }
  return null;
}
