import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import stripAnsi from 'strip-ansi';
import { parsePlansFromMarkdown } from '../../../src/utils/test-plan-markdown.ts';
import { mdq } from '../../../src/utils/markdown-query.ts';
import type { Plan } from '../../../src/test-plan.ts';

export function findResearchFiles(runDir: string): string[] {
  return listMarkdown(join(runDir, 'output', 'research'));
}

export function loadPlans(runDir: string): Plan[] {
  const plans: Plan[] = [];
  for (const file of listMarkdown(join(runDir, 'output', 'plans'))) {
    plans.push(...parsePlansFromMarkdown(file));
  }
  return plans;
}

export function latestReporterSummary(runDir: string): ReporterSummary | null {
  const dir = join(runDir, 'output', 'reports');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('-tests.md'))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (files.length === 0) return null;

  const content = readFileSync(files[0], 'utf-8');
  const rows = mdq(content).query('section("Summary") table').toJson();
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    total: toNumber(row.Total),
    passed: toNumber(row.Passed),
    failed: toNumber(row.Failed),
    skipped: toNumber(row.Skipped),
    file: files[0],
  };
}

export function parseStdoutResults(output: string): StdoutResults | null {
  const clean = stripAnsi(output);
  const match = clean.match(/Results:\s*(\d+)\s*passed,\s*(\d+)\s*failed,\s*(\d+)\s*skipped/i);
  if (!match) return null;
  return { passed: Number(match[1]), failed: Number(match[2]), skipped: Number(match[3]) };
}

export function researchStructure(file: string): { headings: number; tableRows: number; text: string } {
  const content = readFileSync(file, 'utf-8');
  const md = unwrapFence(content);
  const headings = mdq(md).query('heading').count();
  const tableRows = mdq(md).query('table').toJson().length;
  return { headings, tableRows, text: content.toLowerCase() };
}

function unwrapFence(content: string): string {
  const trimmed = content.trim();
  if (!trimmed.startsWith('```')) return content;
  const firstNewline = trimmed.indexOf('\n');
  if (firstNewline === -1) return content;
  const body = trimmed.slice(firstNewline + 1);
  const lastFence = body.lastIndexOf('```');
  if (lastFence === -1) return content;
  return body.slice(0, lastFence);
}

function listMarkdown(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => join(dir, f));
}

function toNumber(value: string | undefined): number {
  const n = Number(String(value || '').trim());
  if (Number.isNaN(n)) return 0;
  return n;
}

export interface ReporterSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  file: string;
}

export interface StdoutResults {
  passed: number;
  failed: number;
  skipped: number;
}
