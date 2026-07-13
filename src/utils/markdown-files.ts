import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

export function loadMarkdownFiles(dir: string, options: { recursive?: boolean } = {}): MarkdownFile[] {
  if (!existsSync(dir)) return [];

  const results: MarkdownFile[] = [];
  const files = readdirSync(dir, { recursive: options.recursive === true })
    .filter((file): file is string => typeof file === 'string' && file.endsWith('.md'))
    .map((file) => join(dir, file));

  for (const filePath of files) {
    try {
      const parsed = matter(readFileSync(filePath, 'utf8'));
      results.push({ filePath, content: parsed.content, data: parsed.data, mtime: statSync(filePath).mtime });
    } catch {}
  }

  return results;
}

export interface MarkdownFile {
  filePath: string;
  content: string;
  data: Record<string, any>;
  mtime: Date;
}
