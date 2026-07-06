import type { LogEntry, TestRun } from './log-parser';

const VISUAL_STEP = /^I\.(click|clickXY|doubleClick|rightClick|fillField|appendField|type|pressKey|amOnPage|selectOption|checkOption|uncheckOption|attachFile|dragAndDrop|dragSlider|scroll\w*|moveCursorTo|switchTo|focus|clearField)\(/;
const LEAD_MS = 1000;
const TAIL_MS = 2500;
const EDGE_MARGIN_MS = 500;
const MIN_UNIQUE_RATIO = 0.6;
const BURST_GAP_SEC = 0.5;
const MAX_BURST_RATIO = 0.35;
const RELAX_LADDER: RelaxParams[] = [
  { level: 0, maxGap: 10, allowedBigGaps: 1 },
  { level: 1, maxGap: 15, allowedBigGaps: 2 },
  { level: 2, maxGap: 20, allowedBigGaps: 3 },
  { level: 3, maxGap: Number.POSITIVE_INFINITY, allowedBigGaps: Number.POSITIVE_INFINITY },
];

export function selectSegments(runs: TestRun[], targetSec: number, speedMax: number): Candidate[] {
  for (const relax of RELAX_LADDER) {
    const candidates = runs.flatMap((run) => enumerateWindows(run, targetSec, speedMax, relax));
    if (!candidates.length) continue;
    const ranked = dedupe(candidates).sort((a, b) => b.score - a.score);
    const perRun = new Map<string, number>();
    const diverse: Candidate[] = [];
    for (const candidate of ranked) {
      const count = perRun.get(candidate.run.webmPath) ?? 0;
      if (count >= 2) continue;
      perRun.set(candidate.run.webmPath, count + 1);
      diverse.push(candidate);
      if (diverse.length === 10) break;
    }
    return diverse;
  }
  return [];
}

export function buildManualCandidate(run: TestRun, wsMs: number, weMs: number, targetSec: number, speedMax: number): Candidate {
  const winStart = run.videoStartTs + EDGE_MARGIN_MS;
  const winEnd = run.savedTs - EDGE_MARGIN_MS;
  const ws = Math.max(wsMs, winStart);
  let we = Math.min(weMs, winEnd);
  const maxLenMs = targetSec * speedMax * 1000;
  if (we - ws > maxLenMs) we = ws + maxLenMs;
  const visual = visualSteps(run).filter((s) => s.ts >= ws && s.ts <= we);
  return finalizeCandidate(run, ws, we, visual, targetSec, speedMax, 0, winEnd);
}

export function visualSteps(run: TestRun): VisualStep[] {
  const steps: VisualStep[] = [];
  for (const entry of run.entries) {
    if (entry.type !== 'step') continue;
    const match = entry.content.match(VISUAL_STEP);
    if (!match) continue;
    steps.push({ ts: entry.ts, kind: match[1], entry });
  }
  return steps;
}

function enumerateWindows(run: TestRun, targetSec: number, speedMax: number, relax: RelaxParams): Candidate[] {
  const winStart = run.videoStartTs + EDGE_MARGIN_MS;
  const winEnd = run.savedTs - EDGE_MARGIN_MS;
  const visual = visualSteps(run).filter((s) => s.ts >= winStart && s.ts <= winEnd);
  if (!visual.length) return [];
  const maxLenMs = targetSec * speedMax * 1000;
  const candidates: Candidate[] = [];

  for (let i = 0; i < visual.length; i++) {
    const ws = Math.max(visual[i].ts - LEAD_MS, winStart);
    let bigGaps = 0;
    let j = i;
    while (j + 1 < visual.length) {
      const next = visual[j + 1];
      if (next.ts > ws + maxLenMs - TAIL_MS) break;
      const gap = (next.ts - visual[j].ts) / 1000;
      if (gap > relax.maxGap) break;
      if (gap > 8) {
        bigGaps++;
        if (bigGaps > relax.allowedBigGaps) break;
      }
      j++;
    }
    const we = Math.min(visual[j].ts + TAIL_MS, winEnd, ws + maxLenMs);
    const lengthSec = (we - ws) / 1000;
    if (lengthSec < Math.min(targetSec, 12)) continue;
    const candidate = finalizeCandidate(run, ws, we, visual.slice(i, j + 1), targetSec, speedMax, relax.level, winEnd);
    if (candidate.uniqueRatio < MIN_UNIQUE_RATIO && relax.level < 3) continue;
    if (candidate.endsWithIssue && relax.level < 3) continue;
    if (candidate.burstRatio > MAX_BURST_RATIO && relax.level < 3) continue;
    candidates.push(candidate);
  }
  return candidates;
}

function finalizeCandidate(run: TestRun, ws: number, we: number, included: VisualStep[], targetSec: number, speedMax: number, relaxLevel: number, winEnd: number): Candidate {
  const lengthSec = (we - ws) / 1000;
  const gaps: number[] = [];
  for (let k = 1; k < included.length; k++) {
    gaps.push((included[k].ts - included[k - 1].ts) / 1000);
  }
  const kinds = new Set(included.map((s) => s.kind));
  const reachesEnd = we >= winEnd - 3000;
  const uniqueSteps = new Set(included.map((s) => normalizeStep(s.entry.content))).size;
  const uniqueRatio = uniqueSteps / Math.max(1, included.length);
  const inWindow = run.entries.filter((e) => e.ts >= ws && e.ts <= we);
  const successCount = inWindow.filter((e) => e.type === 'success').length;
  const issues = inWindow.filter((e) => e.type === 'warning' || e.type === 'error');
  const pilotPass = inWindow.some((e) => e.content.startsWith('Pilot: pass'));
  const pilotStuck = inWindow.some((e) => e.content.startsWith('Pilot: ') && !e.content.startsWith('Pilot: pass'));

  let score = 2 * included.length + (10 * included.length) / lengthSec;
  for (const gap of gaps) {
    if (gap > 5) score -= (gap - 5) * 0.5;
  }
  if (reachesEnd) score += 5;
  score += Math.min(4, Math.max(0, kinds.size - 1));
  const lastStep = included.at(-1);
  if (lastStep?.kind === 'amOnPage') score -= 4;
  if (lastStep && run.entries.some((e) => e.type === 'success' && e.ts >= lastStep.ts && e.ts <= we)) score += 3;
  if (run.entries.some((e) => e.content.startsWith('Researching ') && e.ts >= we - 3000 && e.ts <= we)) score -= 6;
  score -= (1 - uniqueRatio) * 25;
  score += Math.min(8, successCount * 2);
  if (pilotPass) score += 4;
  if (pilotStuck) score -= 6;
  const burstRatio = gaps.filter((g) => g < BURST_GAP_SEC).length / Math.max(1, gaps.length);
  const endsWithIssue = issues.some((e) => e.ts >= we - 5000);
  score -= Math.min(12, issues.length * 3);
  if (endsWithIssue) score -= 6;
  score -= burstRatio * 20;

  const speed = Math.min(Math.max(lengthSec / targetSec, 1), speedMax);
  return {
    run,
    ws,
    we,
    lengthSec,
    visualCount: included.length,
    actionKinds: [...kinds],
    gaps,
    score,
    reachesEnd,
    uniqueRatio,
    successCount,
    issueCount: issues.length,
    endsWithIssue,
    burstRatio,
    relaxLevel,
    speed,
    outDur: lengthSec / speed,
    segStart: (ws - run.videoStartTs) / 1000,
  };
}

function normalizeStep(content: string): string {
  return content.split('\n')[0].replace(/\s+/g, ' ').trim().toLowerCase();
}

function dedupe(candidates: Candidate[]): Candidate[] {
  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const bin = Math.floor((candidate.ws - candidate.run.videoStartTs) / 5000);
    const key = `${candidate.run.webmPath}:${bin}`;
    const existing = best.get(key);
    if (!existing || candidate.score > existing.score) best.set(key, candidate);
  }
  return [...best.values()];
}

export interface Candidate {
  run: TestRun;
  ws: number;
  we: number;
  lengthSec: number;
  visualCount: number;
  actionKinds: string[];
  gaps: number[];
  score: number;
  reachesEnd: boolean;
  uniqueRatio: number;
  successCount: number;
  issueCount: number;
  endsWithIssue: boolean;
  burstRatio: number;
  relaxLevel: number;
  speed: number;
  outDur: number;
  segStart: number;
}

interface VisualStep {
  ts: number;
  kind: string;
  entry: LogEntry;
}

interface RelaxParams {
  level: number;
  maxGap: number;
  allowedBigGaps: number;
}
