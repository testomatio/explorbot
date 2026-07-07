import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { resolveBackground } from './lib/background';
import { composeVideo, extractCheckFrames, verifyOutput } from './lib/composite';
import { type Layout, computeLayout, parseSize } from './lib/layout';
import { type TestRun, parseLog } from './lib/log-parser';
import { type Candidate, buildManualCandidate, selectSegments } from './lib/segment';
import { type TerminalTheme, buildTimeline, renderTerminal } from './lib/terminal';

const DEFAULTS = {
  log: 'output/explorbot.log',
  screencasts: 'output/screencasts',
  duration: 30,
  size: '1920x1080',
  output: '',
  screencast: '',
  scenario: '',
  start: '',
  end: '',
  speedMax: 1.25,
  bg: '#F2F0EB',
  bgImage: 'auto',
  appTitle: '',
  terminalTheme: 'dark' as TerminalTheme,
  successEpilogue: false,
  keepTemp: false,
  byArea: false,
};

export async function analyzeDemoCandidates(options: DemoVideoOptions = {}): Promise<CandidateSummary[]> {
  const opts = withDefaults(options);
  const parsed = await parseLog(opts.log, opts.screencasts);
  if (opts.byArea) return bestPerArea(parsed.runs, opts).map(candidateSummary);
  return selectSegments(parsed.runs, opts.duration, opts.speedMax).map(candidateSummary);
}

export async function createDemoVideo(options: DemoVideoOptions = {}): Promise<DemoSummary> {
  const opts = withDefaults(options);
  const parsed = await parseLog(opts.log, opts.screencasts);
  const candidate = pickCandidate(parsed.runs, opts);
  return renderCandidate(candidate, opts);
}

function bestPerArea(runs: TestRun[], opts: ResolvedOptions): Candidate[] {
  const byArea = new Map<string, Candidate>();
  for (const run of runs) {
    const candidate = selectSegments([run], opts.duration, opts.speedMax)[0];
    if (!candidate) continue;
    const area = run.webmBasename.replace(/-\d+-.*$/, '');
    const current = byArea.get(area);
    if (current && current.score >= candidate.score) continue;
    byArea.set(area, candidate);
  }
  return [...byArea.values()].sort((a, b) => b.score - a.score);
}

function pickCandidate(runs: TestRun[], opts: ResolvedOptions): Candidate {
  if (!opts.screencast && !opts.scenario) {
    const candidate = selectSegments(runs, opts.duration, opts.speedMax)[0];
    if (!candidate) throw new Error('No successful runs with screencasts found.');
    return candidate;
  }
  const run = pickRun(runs, opts);
  if (opts.start && opts.end) {
    return buildManualCandidate(run, parseTimePoint(opts.start, run), parseTimePoint(opts.end, run), opts.duration, opts.speedMax);
  }
  const candidate = selectSegments([run], opts.duration, opts.speedMax)[0];
  if (!candidate) throw new Error(`No usable segment found in ${run.webmBasename}`);
  return candidate;
}

async function renderCandidate(candidate: Candidate, opts: ResolvedOptions): Promise<DemoSummary> {
  const run = candidate.run;
  const { width, height } = parseSize(opts.size);
  const layout = computeLayout(width, height, run.width / run.height);
  const output = resolveOutputPath(run, layout, opts);
  mkdirSync(path.dirname(output), { recursive: true });
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'demo-video-'));

  console.log(`Rendering ${run.webmBasename}`);
  console.log(`  segment: ${candidate.segStart.toFixed(1)}s → ${(candidate.segStart + candidate.lengthSec).toFixed(1)}s, speed ${candidate.speed.toFixed(2)}x, output ${candidate.outDur.toFixed(1)}s`);

  const timeline = buildTimeline(candidate, layout, opts.successEpilogue);
  console.log(`  terminal: ${timeline.length} log lines, ${layout.vhsWidth}x${layout.vhsHeight} @ font ${layout.fontSize} (VHS, ${opts.terminalTheme})`);
  const terminal = await renderTerminal(tmpDir, layout, timeline, candidate.outDur, opts.bg, opts.terminalTheme);

  const background = await resolveBackground(opts.bgImage, layout.W, layout.H, tmpDir);
  if (background.credit) console.log(`  ${background.credit}`);

  console.log(`  compositing ${layout.W}x${layout.H} (${layout.mode})`);
  await composeVideo({
    browserWebm: run.webmPath,
    terminalMp4: terminal.path,
    output,
    layout,
    bg: opts.bg,
    background,
    title: run.scenarioName,
    appTitle: resolveAppTitle(run, opts),
    terminalBarStyle: opts.terminalTheme,
    tmpDir,
    segStart: candidate.segStart,
    segLen: candidate.lengthSec,
    speed: candidate.speed,
    outDur: candidate.outDur,
    terminalSetptsFactor: terminal.setptsFactor,
  });

  const check = await verifyOutput(output, layout, candidate.outDur);
  const frames = await extractCheckFrames(output, candidate.outDur);
  const warnings = [...terminal.warnings];
  const maxGap = Math.max(0, ...candidate.gaps);
  if (candidate.relaxLevel > 0) warnings.push(`segment required relaxation level ${candidate.relaxLevel} (gaps above default limits)`);
  if (candidate.uniqueRatio < 0.85) warnings.push(`only ${Math.round(candidate.uniqueRatio * 100)}% of steps are unique — the browser may sit static while the terminal retries selectors (desync look)`);
  if (maxGap > 7) warnings.push(`${maxGap.toFixed(1)}s gap between actions — the browser may sit still while the terminal waits`);
  if (candidate.outDur < opts.duration - 1) warnings.push(`output is ${candidate.outDur.toFixed(1)}s, shorter than the ${opts.duration}s target (test too short)`);
  if (!run.nameMatchesFile) warnings.push('scenario name does not match webm filename — verify the screencast belongs to this test');

  const summary = {
    output: path.resolve(output),
    frames,
    scenario: run.scenarioName,
    webm: run.webmPath,
    background: background.credit ?? background.kind,
    ...candidateSummary(candidate),
    check,
    warnings,
  };
  if (opts.keepTemp) {
    console.log(`temp workspace kept: ${tmpDir}`);
    return summary;
  }
  rmSync(tmpDir, { recursive: true, force: true });
  return summary;
}

function pickRun(runs: TestRun[], opts: ResolvedOptions): TestRun {
  if (opts.screencast) {
    const wanted = path.basename(opts.screencast);
    const run = runs.find((r) => r.webmBasename === wanted);
    if (run) return run;
    throw new Error(`No successful run found for screencast "${wanted}". Available:\n${runs.map((r) => `  ${r.webmBasename}`).join('\n')}`);
  }
  const needle = opts.scenario.toLowerCase();
  const run = runs.find((r) => r.scenarioName.toLowerCase().includes(needle));
  if (run) return run;
  throw new Error(`No successful run matching scenario "${opts.scenario}". Available:\n${runs.map((r) => `  ${r.scenarioName}`).join('\n')}`);
}

function parseTimePoint(value: string, run: TestRun): number {
  if (value.includes('T')) {
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) throw new Error(`Invalid ISO timestamp: ${value}`);
    return ts;
  }
  const seconds = Number.parseFloat(value);
  if (!Number.isFinite(seconds)) throw new Error(`Invalid time point: ${value}`);
  return run.videoStartTs + seconds * 1000;
}

function resolveAppTitle(run: TestRun, opts: ResolvedOptions): string {
  if (opts.appTitle) return opts.appTitle;
  for (const entry of run.entries) {
    const match = entry.content.match(/https?:\/\/[^\s"')]+/);
    if (match) return new URL(match[0]).host;
  }
  return 'Web Application';
}

function resolveOutputPath(run: TestRun, layout: Layout, opts: ResolvedOptions): string {
  if (opts.output) return opts.output;
  const slug = run.webmBasename.replace(/\.webm$/, '').slice(0, 60);
  return path.join('output', `demo-${slug}-${layout.W}x${layout.H}.mp4`);
}

function candidateSummary(candidate: Candidate): CandidateSummary {
  let maxGap = 0;
  for (const gap of candidate.gaps) {
    if (gap > maxGap) maxGap = gap;
  }
  return {
    webm: candidate.run.webmBasename,
    scenario: candidate.run.scenarioName,
    windowStart: candidate.segStart.toFixed(1),
    windowEnd: (candidate.segStart + candidate.lengthSec).toFixed(1),
    length: candidate.lengthSec.toFixed(1),
    speed: candidate.speed.toFixed(2),
    outDur: candidate.outDur.toFixed(1),
    visualSteps: candidate.visualCount,
    actionKinds: candidate.actionKinds.join(','),
    maxGap: maxGap.toFixed(1),
    reachesEnd: candidate.reachesEnd,
    uniqueSteps: `${Math.round(candidate.uniqueRatio * 100)}%`,
    successNotes: candidate.successCount,
    issueNotes: candidate.issueCount,
    relaxLevel: candidate.relaxLevel,
    score: candidate.score.toFixed(1),
  };
}

function parseTerminalTheme(value: string): TerminalTheme {
  if (value !== 'dark' && value !== 'light') throw new Error(`Invalid terminal theme "${value}" — use dark or light`);
  return value;
}

function withDefaults(options: DemoVideoOptions): ResolvedOptions {
  const opts = { ...DEFAULTS, ...options };
  opts.duration = Number(opts.duration);
  opts.speedMax = Number(opts.speedMax);
  opts.terminalTheme = parseTerminalTheme(String(opts.terminalTheme));
  return opts;
}

async function runCli(): Promise<void> {
  const { values: args, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      log: { type: 'string', default: DEFAULTS.log },
      screencasts: { type: 'string', default: DEFAULTS.screencasts },
      duration: { type: 'string', default: String(DEFAULTS.duration) },
      size: { type: 'string', default: DEFAULTS.size },
      output: { type: 'string', default: '' },
      screencast: { type: 'string', default: '' },
      scenario: { type: 'string', default: '' },
      start: { type: 'string', default: '' },
      end: { type: 'string', default: '' },
      'speed-max': { type: 'string', default: String(DEFAULTS.speedMax) },
      bg: { type: 'string', default: DEFAULTS.bg },
      'bg-image': { type: 'string', default: DEFAULTS.bgImage },
      'app-title': { type: 'string', default: '' },
      'terminal-theme': { type: 'string', default: DEFAULTS.terminalTheme },
      'success-epilogue': { type: 'boolean', default: false },
      'keep-temp': { type: 'boolean', default: false },
      'by-area': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });

  const options: DemoVideoOptions = {
    log: args.log,
    screencasts: args.screencasts,
    duration: Number(args.duration),
    size: args.size,
    output: args.output,
    screencast: args.screencast,
    scenario: args.scenario,
    start: args.start,
    end: args.end,
    speedMax: Number(args['speed-max']),
    bg: args.bg,
    bgImage: args['bg-image'],
    appTitle: args['app-title'],
    terminalTheme: parseTerminalTheme(args['terminal-theme']),
    successEpilogue: args['success-epilogue'],
    keepTemp: args['keep-temp'],
    byArea: args['by-area'],
  };

  const command = positionals[0];
  if (command === 'analyze') {
    const candidates = await analyzeDemoCandidates(options);
    if (args.json) {
      console.log(JSON.stringify(candidates, null, 2));
      return;
    }
    if (!candidates.length) {
      console.log('No successful runs with screencasts found.');
      return;
    }
    candidates.forEach((s, i) => {
      console.log(`#${i + 1} score=${s.score} ${s.webm}`);
      console.log(`   scenario: ${s.scenario}`);
      console.log(`   window: ${s.windowStart}s → ${s.windowEnd}s of video (${s.length}s, speed ${s.speed}x → ${s.outDur}s output)`);
      console.log(`   visual steps: ${s.visualSteps} (${s.actionKinds}), unique ${s.uniqueSteps}, ${s.successNotes} success notes, max gap ${s.maxGap}s, reaches end: ${s.reachesEnd}, relax level: ${s.relaxLevel}`);
    });
    return;
  }
  if (command === 'render') {
    if (!options.screencast && !options.scenario) throw new Error('render requires --screencast <file.webm> or --scenario "<substring>"');
    console.log(JSON.stringify(await createDemoVideo(options), null, 2));
    return;
  }
  if (command === 'auto') {
    console.log(JSON.stringify(await createDemoVideo(options), null, 2));
    return;
  }
  console.error('Usage: demo-video.ts <analyze|render|auto> [options]');
  process.exit(1);
}

if (import.meta.main) await runCli();

export type DemoVideoOptions = Partial<typeof DEFAULTS>;

type ResolvedOptions = typeof DEFAULTS;

export interface CandidateSummary {
  webm: string;
  scenario: string;
  windowStart: string;
  windowEnd: string;
  length: string;
  speed: string;
  outDur: string;
  visualSteps: number;
  actionKinds: string;
  maxGap: string;
  reachesEnd: boolean;
  uniqueSteps: string;
  successNotes: number;
  issueNotes: number;
  relaxLevel: number;
  score: string;
}

export interface DemoSummary extends CandidateSummary {
  output: string;
  frames: string[];
  background: string;
  check: { ok: boolean; issues: string[] };
  warnings: string[];
}
