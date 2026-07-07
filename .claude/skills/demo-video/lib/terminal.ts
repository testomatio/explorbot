import path from 'node:path';
import { RecentStepFilter } from '../../../../src/utils/log-filters';
import type { Layout } from './layout';
import { run } from './proc';
import type { Candidate } from './segment';

export const STARTUP_PAD_SEC = 0.8;
const KEEP_TYPES = new Set(['info', 'success', 'error', 'warning', 'step', 'substep']);
const THEMES = {
  dark: {
    name: 'explorbot-dark',
    background: '#16181d',
    foreground: '#dde3ea',
    cursor: '#16181d',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#98a1ab',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
  light: {
    name: 'explorbot-light',
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#ffffff',
    black: '#24292f',
    red: '#cf222e',
    green: '#1a7f37',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#1b7c83',
    white: '#6e7781',
    brightBlack: '#57606a',
    brightRed: '#a40e26',
    brightGreen: '#2da44e',
    brightYellow: '#bf8700',
    brightBlue: '#218bff',
    brightMagenta: '#8250df',
    brightCyan: '#3192aa',
    brightWhite: '#24292f',
  },
};

export function buildTimeline(candidate: Candidate, layout: Layout, successEpilogue: boolean): TimelineItem[] {
  const items: TimelineItem[] = [];
  const stepFilter = new RecentStepFilter();
  for (const entry of candidate.run.entries) {
    if (entry.ts < candidate.ws || entry.ts > candidate.we) continue;
    if (!KEEP_TYPES.has(entry.type)) continue;
    if (entry.type === 'step' && stepFilter.shouldSuppress(entry.content, entry.ts)) continue;
    const offsetMs = Math.round((entry.ts - candidate.ws) / candidate.speed) + STARTUP_PAD_SEC * 1000;
    items.push({ offsetMs, text: styleLine(entry.type, entry.content, layout.cols) });
  }
  if (successEpilogue && !candidate.reachesEnd) {
    const offsetMs = Math.max(0, Math.round((candidate.outDur - 1.5) * 1000)) + STARTUP_PAD_SEC * 1000;
    items.push({ offsetMs, text: styleLine('success', `✔ Successful test: ${candidate.run.scenarioName}`, layout.cols) });
  }
  return items.sort((a, b) => a.offsetMs - b.offsetMs);
}

export async function renderTerminal(tmpDir: string, layout: Layout, timeline: TimelineItem[], outDur: number, bg: string, theme: TerminalTheme): Promise<TerminalRender> {
  const replayPath = path.join(tmpDir, 'replay.ts');
  const tapePath = path.join(tmpDir, 'demo.tape');
  const outputPath = path.join(tmpDir, 'terminal.mp4');
  const sleepSec = Math.ceil(outDur + STARTUP_PAD_SEC + 1.5);
  const lastOffset = timeline.at(-1)?.offsetMs ?? 0;
  const holdMs = Math.max(1000, sleepSec * 1000 - lastOffset + 1000);

  await Bun.write(replayPath, replayScript(timeline, holdMs));
  await Bun.write(tapePath, tapeScript(layout, bg, replayPath, sleepSec, theme));

  const warnings: string[] = [];
  let measured: number | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { code, stderr } = await run([vhsBinary(), 'demo.tape'], { cwd: tmpDir, env: { ...process.env, _ZO_DOCTOR: '0' } });
    if (code !== 0) throw new Error(`vhs failed: ${stderr.slice(-2000)}`);
    if (!(await Bun.file(outputPath).exists())) throw new Error(`vhs produced no output: ${stderr.slice(-2000)}`);
    measured = await probeDuration(outputPath);
    if (measured && Math.abs(measured - sleepSec) <= 1.5) break;
    warnings.push(`vhs attempt ${attempt} recorded ${measured?.toFixed(2)}s instead of ~${sleepSec}s, retrying`);
  }

  let setptsFactor = 1;
  if (measured && Math.abs(measured - sleepSec) > 1.5) {
    setptsFactor = sleepSec / measured;
    warnings.push(`terminal render duration ${measured.toFixed(2)}s deviates from expected ${sleepSec}s, correcting with setpts factor ${setptsFactor.toFixed(3)}`);
  }
  return { path: outputPath, duration: measured, setptsFactor, warnings };
}

function styleLine(type: string, content: string, cols: number): string {
  const lines = content.split('\n');
  let line = lines[0];
  if (lines.length > 1) line += ' …';
  const indent = indentWidth(type);
  const maxLen = cols - indent - 1;
  if (line.length > maxLen) line = `${line.slice(0, maxLen - 1)}…`;
  if (type === 'success') return `\x1b[32m${line}\x1b[39m`;
  if (type === 'error') return `\x1b[31m${line}\x1b[39m`;
  if (type === 'warning') return `\x1b[33m${line}\x1b[39m`;
  if (type === 'step') return `   ${stepText(line)}`;
  if (type === 'substep') return `   \x1b[95m>\x1b[39m ${line}`;
  return line;
}

function stepText(line: string): string {
  if (line.startsWith('I.')) return `\x1b[95mI\x1b[39m\x1b[97m${line.slice(1)}\x1b[39m`;
  return `\x1b[97m${line}\x1b[39m`;
}

function indentWidth(type: string): number {
  if (type === 'step') return 3;
  if (type === 'substep') return 5;
  return 0;
}

function replayScript(timeline: TimelineItem[], holdMs: number): string {
  return [
    `const timeline = ${JSON.stringify(timeline)};`,
    `process.stdout.write('\\x1b[2J\\x1b[3J\\x1b[H\\x1b[?25l');`,
    'const t0 = Date.now();',
    'for (const item of timeline) {',
    '  const wait = item.offsetMs - (Date.now() - t0);',
    '  if (wait > 0) await Bun.sleep(wait);',
    '  console.log(item.text);',
    '}',
    `await Bun.sleep(${holdMs});`,
    '',
  ].join('\n');
}

function tapeScript(layout: Layout, bg: string, replayPath: string, sleepSec: number, theme: TerminalTheme): string {
  return [
    'Output terminal.mp4',
    'Set Shell bash',
    `Set Width ${layout.vhsWidth}`,
    `Set Height ${layout.vhsHeight}`,
    'Set Padding 24',
    'Set FontFamily "IBM Plex Mono"',
    `Set FontSize ${layout.fontSize}`,
    `Set LineHeight ${layout.lineHeight}`,
    `Set Framerate ${layout.vhsFramerate}`,
    'Set CursorBlink false',
    'Set BorderRadius 0',
    'Set Margin 0',
    `Set MarginFill "${bg}"`,
    `Set Theme ${JSON.stringify(THEMES[theme])}`,
    'Hide',
    `Type "${bunBinary()} ${replayPath}"`,
    'Enter',
    'Show',
    `Sleep ${sleepSec}s`,
    '',
  ].join('\n');
}

function vhsBinary(): string {
  return Bun.which('vhs') ?? 'vhs';
}

function bunBinary(): string {
  return Bun.which('bun') ?? process.execPath;
}

async function probeDuration(file: string): Promise<number | null> {
  const { code, stdout } = await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { stderr: 'ignore' });
  if (code !== 0) return null;
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration)) return null;
  return duration;
}

export type TerminalTheme = keyof typeof THEMES;

export interface TimelineItem {
  offsetMs: number;
  text: string;
}

export interface TerminalRender {
  path: string;
  duration: number | null;
  setptsFactor: number;
  warnings: string[];
}
