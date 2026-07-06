import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { run } from './proc';

const LOG_LINE = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] \[([A-Z]+)\] (.*)$/;
const SESSION_MARKER = /^=== ExplorBot Session Started at .+ ===$/;
const SCREENCAST_PREFIX = 'Saved screencast: ';
const SUCCESS_PREFIX = 'Successful test: ';

export async function parseLog(logPath: string, screencastsDir: string): Promise<ParsedLog> {
  const text = await Bun.file(logPath).text();
  const entries: LogEntry[] = [];
  for (const line of text.split('\n')) {
    const match = line.match(LOG_LINE);
    if (match) {
      entries.push({ ts: Date.parse(match[1]), type: match[2].toLowerCase(), content: match[3] });
      continue;
    }
    if (!line.trim()) continue;
    if (SESSION_MARKER.test(line.trim())) continue;
    const last = entries.at(-1);
    if (last) last.content += `\n${line}`;
  }
  const runs = await buildRuns(entries, logPath, screencastsDir);
  return { entries, runs };
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
}

async function buildRuns(entries: LogEntry[], logPath: string, screencastsDir: string): Promise<TestRun[]> {
  const byPath = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!entry.content.startsWith(SCREENCAST_PREFIX)) return;
    const rel = entry.content.split('\n')[0].slice(SCREENCAST_PREFIX.length).trim();
    const resolved = resolveWebm(rel, logPath, screencastsDir);
    if (!resolved) return;
    byPath.set(resolved, index);
  });

  const candidates: Array<{ webmPath: string; index: number; scenarioName: string }> = [];
  for (const [webmPath, index] of byPath) {
    const outcome = findOutcome(entries, index);
    if (!outcome) continue;
    candidates.push({ webmPath, index, scenarioName: outcome });
  }

  const runs = await Promise.all(
    candidates.map(async ({ webmPath, index, scenarioName }) => {
      const savedTs = entries[index].ts;
      const mtime = statSync(webmPath).mtimeMs;
      if (Math.abs(mtime - savedTs) > 15000) {
        console.warn(`Skipping ${path.basename(webmPath)}: file on disk was written at a different time than the log records (overwritten by a run outside this log?)`);
        return null;
      }
      const probe = await probeVideo(webmPath);
      if (!probe || probe.duration < 10) return null;
      const videoStartTs = savedTs - probe.duration * 1000;
      const nameMatchesFile = path.basename(webmPath).includes(safeFilename(scenarioName));
      return {
        webmPath,
        webmBasename: path.basename(webmPath),
        savedTs,
        videoStartTs,
        videoDuration: probe.duration,
        width: probe.width,
        height: probe.height,
        scenarioName,
        nameMatchesFile,
        entries: entries.filter((e) => e.ts >= videoStartTs && e.ts <= savedTs),
      };
    })
  );
  return runs.filter((run) => !!run);
}

function findOutcome(entries: LogEntry[], savedIndex: number): string | null {
  const savedTs = entries[savedIndex].ts;
  for (let i = savedIndex + 1; i < Math.min(savedIndex + 16, entries.length); i++) {
    const entry = entries[i];
    if (entry.ts - savedTs > 60000) return null;
    if (entry.content.startsWith(SUCCESS_PREFIX)) return entry.content.split('\n')[0].slice(SUCCESS_PREFIX.length).trim();
    if (entry.content.startsWith('Failed test')) return null;
    if (entry.type === 'error') return null;
  }
  return null;
}

function resolveWebm(rel: string, logPath: string, screencastsDir: string): string | null {
  const options = [path.resolve(screencastsDir, path.basename(rel)), path.resolve(rel), path.resolve(path.dirname(logPath), '..', '..', rel)];
  for (const option of options) {
    if (existsSync(option)) return option;
  }
  return null;
}

async function probeVideo(file: string): Promise<VideoProbe | null> {
  const { code, stdout } = await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-show_entries', 'format=duration', '-of', 'json', file], { stderr: 'ignore' });
  if (code !== 0) return null;
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0];
  if (!stream?.width) return null;
  let duration = Number.parseFloat(data.format?.duration);
  if (!Number.isFinite(duration)) {
    const fallback = await probeDurationFromPackets(file);
    if (!fallback) return null;
    duration = fallback;
  }
  return { duration, width: stream.width, height: stream.height };
}

async function probeDurationFromPackets(file: string): Promise<number | null> {
  const { code, stdout } = await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', file], { stderr: 'ignore' });
  if (code !== 0) return null;
  const lines = stdout.trim().split('\n').filter(Boolean);
  const last = Number.parseFloat(lines.at(-1) ?? '');
  if (!Number.isFinite(last)) return null;
  return last;
}

export interface LogEntry {
  ts: number;
  type: string;
  content: string;
}

export interface TestRun {
  webmPath: string;
  webmBasename: string;
  savedTs: number;
  videoStartTs: number;
  videoDuration: number;
  width: number;
  height: number;
  scenarioName: string;
  nameMatchesFile: boolean;
  entries: LogEntry[];
}

export interface ParsedLog {
  entries: LogEntry[];
  runs: TestRun[];
}

interface VideoProbe {
  duration: number;
  width: number;
  height: number;
}
