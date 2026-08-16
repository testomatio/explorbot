import path from 'node:path';
import { run } from './proc';

const OUTPUT_FPS = 30;
const PROBE_W = 160;
const PROBE_H = 120;
const PAD_LUMA = 126;
const PAD_TOLERANCE = 4;
const MERGE_GAP_SEC = 0.2;
const MIN_SEGMENT_FRAMES = 30;
const MAX_DEVIANT_RATIO = 0.3;
const PTS_EPSILON = 0.001;

export async function cleanBrowserVideo(webm: string, tmpDir: string, segStart: number, segLen: number): Promise<CleanedVideo> {
  const original: CleanedVideo = { path: webm, dropped: [], droppedFrames: 0, warnings: [] };
  const frames = await probeContentGeometry(webm);
  const segEnd = segStart + segLen;
  const segment = frames.filter((frame) => frame.pts >= segStart && frame.pts <= segEnd);
  if (segment.length < MIN_SEGMENT_FRAMES) return original;

  const dominant = mostCommon(segment.map((frame) => frame.key));
  const deviant = segment.filter((frame) => frame.key !== dominant).map((frame) => frame.pts);
  if (!deviant.length) return original;

  const ratio = deviant.length / segment.length;
  if (ratio > MAX_DEVIANT_RATIO) {
    original.warnings.push(`${Math.round(ratio * 100)}% of browser frames in the segment deviate from the dominant ${dominant} viewport — the page resizes throughout, so no frames were dropped`);
    return original;
  }

  const dropped = mergeRanges(deviant);
  const cleaned = path.join(tmpDir, 'browser-clean.mp4');
  const resized = dropped.map(([from, to]) => `between(t,${from.toFixed(4)},${to.toFixed(4)})`).join('+');
  const filter = `select='not(${resized})',fps=${OUTPUT_FPS}:start_time=0`;
  const cmd = ['ffmpeg', '-y', '-v', 'error', '-i', webm, '-vf', filter, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-an', cleaned];
  const { code, stderr } = await run(cmd);
  if (code !== 0) throw new Error(`browser frame cleanup failed: ${stderr.slice(-500)}`);
  return { path: cleaned, dropped, droppedFrames: deviant.length, warnings: [] };
}

async function probeContentGeometry(webm: string): Promise<ProbedFrame[]> {
  const timestamps = await probeTimestamps(webm);
  const filter = `format=gray,scale=${PROBE_W}:${PROBE_H}:flags=neighbor`;
  const proc = Bun.spawn(['ffmpeg', '-v', 'error', '-i', webm, '-vf', filter, '-vsync', '0', '-f', 'rawvideo', '-'], { stdout: 'pipe', stderr: 'ignore' });
  const pixels = new Uint8Array(await new Response(proc.stdout).arrayBuffer());
  await proc.exited;

  const frameSize = PROBE_W * PROBE_H;
  const frames: ProbedFrame[] = [];
  for (let offset = 0; offset + frameSize <= pixels.length; offset += frameSize) {
    const index = frames.length;
    if (index >= timestamps.length) break;
    frames.push({ pts: timestamps[index], key: contentGeometry(pixels.subarray(offset, offset + frameSize)) });
  }
  return frames;
}

async function probeTimestamps(webm: string): Promise<number[]> {
  const { code, stdout } = await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', webm], { stderr: 'ignore' });
  if (code !== 0) throw new Error(`browser frame probe failed on ${webm}`);
  return stdout
    .split('\n')
    .map((line) => Number.parseFloat(line))
    .filter((pts) => Number.isFinite(pts));
}

function contentGeometry(frame: Uint8Array): string {
  let height = 0;
  for (let y = 0; y < PROBE_H; y++) {
    if (isPadRow(frame, y)) continue;
    height = y + 1;
  }
  let width = 0;
  for (let x = 0; x < PROBE_W; x++) {
    if (isPadColumn(frame, x)) continue;
    width = x + 1;
  }
  return `${width}x${height}`;
}

function isPadRow(frame: Uint8Array, y: number): boolean {
  for (let x = 0; x < PROBE_W; x++) {
    if (!isPad(frame[y * PROBE_W + x])) return false;
  }
  return true;
}

function isPadColumn(frame: Uint8Array, x: number): boolean {
  for (let y = 0; y < PROBE_H; y++) {
    if (!isPad(frame[y * PROBE_W + x])) return false;
  }
  return true;
}

function isPad(luma: number): boolean {
  return Math.abs(luma - PAD_LUMA) <= PAD_TOLERANCE;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let winner = values[0];
  let best = 0;
  for (const [value, count] of counts) {
    if (count <= best) continue;
    winner = value;
    best = count;
  }
  return winner;
}

function mergeRanges(timestamps: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const pts of timestamps) {
    const last = ranges[ranges.length - 1];
    if (last && pts - last[1] <= MERGE_GAP_SEC) {
      last[1] = pts + PTS_EPSILON;
      continue;
    }
    ranges.push([Math.max(0, pts - PTS_EPSILON), pts + PTS_EPSILON]);
  }
  return ranges;
}

interface ProbedFrame {
  pts: number;
  key: string;
}

export interface CleanedVideo {
  path: string;
  dropped: Array<[number, number]>;
  droppedFrames: number;
  warnings: string[];
}
