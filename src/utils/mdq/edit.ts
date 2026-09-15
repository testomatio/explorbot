export function splitFrontmatter(source: string): FrontmatterSplit {
  if (!source.startsWith('---')) return { raw: '', body: source, offset: 0 };
  const match = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { raw: '', body: source, offset: 0 };
  return { raw: match[1], body: source.slice(match[0].length), offset: match[0].length };
}

export interface FrontmatterSplit {
  raw: string;
  body: string;
  offset: number;
}
