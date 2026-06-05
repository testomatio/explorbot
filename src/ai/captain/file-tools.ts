import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

export const CAPTAIN_ARTIFACT_DIRS = ['reports', 'plans', 'tests', 'states'] as const;
export const CAPTAIN_ALLOWED_READ_DIRS = ['output', 'knowledge', 'experience'] as const;
export const CAPTAIN_ARTIFACT_SCAN_LIMIT = 200;
export const CAPTAIN_ARTIFACT_LIST_LIMIT = 20;
export const CAPTAIN_READ_FILE_DEFAULT_LIMIT = 12000;
export const CAPTAIN_READ_FILE_MAX_LIMIT = 50000;
export const CAPTAIN_READ_FILE_MIN_LIMIT = 1000;

export function listRecentArtifacts(outputDir: string): Array<{ path: string; size: number; modifiedAt: string }> {
  const artifacts: Array<{ path: string; size: number; modifiedAt: string; timestamp: number }> = [];

  for (const dir of CAPTAIN_ARTIFACT_DIRS) {
    if (artifacts.length >= CAPTAIN_ARTIFACT_SCAN_LIMIT) break;
    const targetDir = join(outputDir, dir);
    if (!existsSync(targetDir)) continue;
    collectArtifacts(outputDir, targetDir, artifacts);
  }

  return artifacts
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, CAPTAIN_ARTIFACT_LIST_LIMIT)
    .map(({ timestamp, ...artifact }) => artifact);
}

export function readCaptainFile(projectRoot: string | null, input: ReadCaptainFileInput, allowedDirs: readonly string[] = CAPTAIN_ALLOWED_READ_DIRS): ReadCaptainFileResult {
  const resolved = resolveReadableFile(projectRoot, input.path, allowedDirs);
  if (!resolved) {
    return { success: false, message: 'File is outside allowed directories' };
  }
  if (!existsSync(resolved)) {
    return { success: false, message: `File not found: ${input.path}` };
  }
  if (!statSync(resolved).isFile()) {
    return { success: false, message: `Not a file: ${input.path}` };
  }

  const maxChars = normalizeMaxChars(input.maxChars);
  const fullContent = readFileSync(resolved, 'utf8');
  const content = selectContent(fullContent, input);
  return {
    success: true,
    path: relative(projectRoot || process.cwd(), resolved),
    truncated: content.length > maxChars,
    content: content.slice(0, maxChars),
  };
}

function collectArtifacts(outputDir: string, targetDir: string, artifacts: Array<{ path: string; size: number; modifiedAt: string; timestamp: number }>): void {
  for (const entry of readdirSync(targetDir, { withFileTypes: true })) {
    if (artifacts.length >= CAPTAIN_ARTIFACT_SCAN_LIMIT) return;
    const entryPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      collectArtifacts(outputDir, entryPath, artifacts);
      continue;
    }

    const stats = statSync(entryPath);
    artifacts.push({
      path: relative(outputDir, entryPath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      timestamp: stats.mtimeMs,
    });
  }
}

function resolveReadableFile(projectRoot: string | null, requestedPath: string, allowedDirs: readonly string[]): string | null {
  if (!projectRoot) return null;

  let cleanPath = requestedPath.trim();
  const projectName = basename(projectRoot);
  if (cleanPath.startsWith(`${projectName}/`) || cleanPath.startsWith(`${projectName}\\`)) {
    cleanPath = cleanPath.slice(projectName.length + 1);
  }

  const resolved = isAbsolute(cleanPath) ? resolve(cleanPath) : resolve(projectRoot, cleanPath);
  const allowedRoots = allowedDirs.map((dir) => resolve(projectRoot, dir));
  for (const root of allowedRoots) {
    const rel = relative(root, resolved);
    if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) return resolved;
  }

  return null;
}

function selectContent(content: string, input: ReadCaptainFileInput): string {
  if (!input.startLine && !input.endLine) return content;

  const lines = content.split(/\r?\n/);
  const startIndex = resolveLineIndex(input.startLine, lines.length, 1);
  const endIndex = resolveLineIndex(input.endLine, lines.length, lines.length);
  if (endIndex < startIndex) return '';
  return lines.slice(startIndex - 1, endIndex).join('\n');
}

function resolveLineIndex(line: number | undefined, totalLines: number, fallback: number): number {
  if (!line) return fallback;
  if (line < 0) return Math.max(1, totalLines + line + 1);
  return Math.min(Math.max(1, line), totalLines);
}

function normalizeMaxChars(maxChars?: number): number {
  return Math.max(CAPTAIN_READ_FILE_MIN_LIMIT, Math.min(maxChars || CAPTAIN_READ_FILE_DEFAULT_LIMIT, CAPTAIN_READ_FILE_MAX_LIMIT));
}

export interface ReadCaptainFileInput {
  path: string;
  startLine?: number;
  endLine?: number;
  maxChars?: number;
}

export type ReadCaptainFileResult =
  | {
      success: true;
      path: string;
      truncated: boolean;
      content: string;
    }
  | {
      success: false;
      message: string;
    };
