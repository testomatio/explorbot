import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMarkdownFiles } from '../../utils/markdown-files.ts';

export const MAX_HITS = 50;
const HIT_LINE_CLAMP = 200;
const HIT_PATTERN = /^(.+?):(\d+):(.*)$/;

let cachedEngine: SearchEngine | null = null;

export async function searchMarkdown(dirs: string[], pattern: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const roots = dirs.map((dir) => resolve(dir)).filter((dir) => existsSync(dir));
  if (roots.length === 0 || !pattern.trim()) return [];

  const maxHits = opts.maxHits ?? MAX_HITS;
  const regex = toRegex(pattern);
  if (!regex) {
    const literal = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return searchFiles(roots, new RegExp(literal, 'i'), maxHits);
  }

  const engine = opts.engine ?? (cachedEngine ||= await detectEngine());
  if (engine === 'js') return searchFiles(roots, regex, maxHits);

  const output = await runSearch(engine, roots, pattern, maxHits);
  if (output === null) return searchFiles(roots, regex, maxHits);

  return parseHits(output, maxHits);
}

async function detectEngine(): Promise<SearchEngine> {
  if (await binaryRuns('rg')) return 'rg';
  if (await binaryRuns('grep')) return 'grep';
  return 'js';
}

async function binaryRuns(engine: 'rg' | 'grep'): Promise<boolean> {
  try {
    const proc = Bun.spawn([engine, '--version'], { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function commandArgs(engine: 'rg' | 'grep', roots: string[], pattern: string, maxHits: number): string[] {
  if (engine === 'rg') return ['--no-heading', '--no-messages', '-n', '-i', '-m', String(maxHits), '-e', pattern, '--glob', '*.md', ...roots];
  return ['-r', '-n', '-i', '-E', '-m', String(maxHits), '-e', toGrepPattern(pattern), '--include=*.md', ...roots];
}

function toGrepPattern(pattern: string): string {
  return pattern.replace(/\\d/g, '[0-9]').replace(/\\D/g, '[^0-9]').replace(/\\w/g, '[0-9A-Za-z_]').replace(/\\W/g, '[^0-9A-Za-z_]').replace(/\\s/g, '[[:space:]]').replace(/\\S/g, '[^[:space:]]');
}

async function runSearch(engine: 'rg' | 'grep', roots: string[], pattern: string, maxHits: number): Promise<string | null> {
  try {
    const proc = Bun.spawn([engine, ...commandArgs(engine, roots, pattern, maxHits)], { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore' });
    const output = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code === 2) return null;
    return output;
  } catch {
    return null;
  }
}

function searchFiles(roots: string[], regex: RegExp, maxHits: number): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const root of roots) {
    for (const file of loadMarkdownFiles(root, { recursive: true })) {
      let fileHits = 0;
      const lines = readFileSync(file.filePath, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i])) continue;
        hits.push({ path: file.filePath, line: i + 1, text: lines[i].slice(0, HIT_LINE_CLAMP) });
        fileHits++;
        if (fileHits >= MAX_HITS) break;
      }
    }
  }
  return interleave(hits, maxHits);
}

function parseHits(output: string, maxHits: number): SearchHit[] {
  const hits: SearchHit[] = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const match = HIT_PATTERN.exec(line);
    if (!match) continue;
    hits.push({ path: match[1], line: Number(match[2]), text: match[3].slice(0, HIT_LINE_CLAMP) });
  }
  return interleave(hits, maxHits);
}

function interleave(hits: SearchHit[], maxHits: number): SearchHit[] {
  if (hits.length <= maxHits) return hits;

  const byFile = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const list = byFile.get(hit.path);
    if (list) {
      list.push(hit);
      continue;
    }
    byFile.set(hit.path, [hit]);
  }

  const queues = [...byFile.values()];
  const result: SearchHit[] = [];
  let added = true;
  while (result.length < maxHits && added) {
    added = false;
    for (const queue of queues) {
      if (queue.length === 0) continue;
      result.push(queue.shift() as SearchHit);
      added = true;
      if (result.length >= maxHits) break;
    }
  }
  return result;
}

function toRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

interface SearchOptions {
  engine?: SearchEngine;
  maxHits?: number;
}

type SearchEngine = 'rg' | 'grep' | 'js';
