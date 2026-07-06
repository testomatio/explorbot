import path from 'node:path';
import type { Background } from './background';
import type { Layout } from './layout';
import { run } from './proc';
import { STARTUP_PAD_SEC } from './terminal';

const BAR_STYLES = {
  light: { bg: '#ECEAE6', text: '#6b6f76' },
  dark: { bg: '#21262e', text: '#adb6c0' },
};
const TRAFFIC_LIGHTS = ['#FF5F57', '#FEBC2E', '#28C840'];
const SHADOW_LEVEL = '0x999999';
const TERMINAL_OPACITY = 0.85;

export async function composeVideo(options: ComposeOptions): Promise<void> {
  const { layout, outDur } = options;
  const browserBar = await createWindowBar(options.tmpDir, 'browser-bar.png', layout.browser.w, layout.windowBar, options.appTitle, 'light');
  const terminalBar = await createWindowBar(options.tmpDir, 'terminal-bar.png', layout.terminal.w, layout.windowBar, `Explorbot: ${options.title}`, options.terminalBarStyle);
  const browserMask = await createRoundedMask(options.tmpDir, 'browser-mask.png', layout.browser.w, layout.browser.h, layout.radius);
  const terminalMask = await createRoundedMask(options.tmpDir, 'terminal-mask.png', layout.terminal.w, layout.terminal.h, layout.radius);

  const cmd = ['ffmpeg', '-y', '-v', 'error', '-i', options.browserWebm, '-i', options.terminalMp4];
  const stillDur = (outDur + 1).toFixed(3);
  const stills: string[] = [];
  if (options.background.kind === 'image') stills.push(options.background.path as string);
  stills.push(browserBar, terminalBar, browserMask, terminalMask);
  for (const still of stills) {
    cmd.push('-loop', '1', '-framerate', '30', '-t', stillDur, '-i', still);
  }
  cmd.push('-filter_complex', buildFilterGraph(options), '-map', '[out]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-r', '30', '-t', outDur.toFixed(3), options.output);
  const { code, stderr } = await run(cmd);
  if (code !== 0) throw new Error(`ffmpeg composite failed: ${stderr.slice(-2000)}`);
}

export async function verifyOutput(output: string, layout: Layout, outDur: number): Promise<OutputCheck> {
  const { code, stdout } = await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,width,height', '-show_entries', 'format=duration', '-of', 'json', output], { stderr: 'ignore' });
  if (code !== 0) return { ok: false, issues: ['ffprobe failed on output file'] };
  const data = JSON.parse(stdout);
  const stream = data.streams?.[0] ?? {};
  const duration = Number.parseFloat(data.format?.duration);
  const issues: string[] = [];
  if (stream.codec_name !== 'h264') issues.push(`codec ${stream.codec_name}, expected h264`);
  if (stream.pix_fmt !== 'yuv420p') issues.push(`pix_fmt ${stream.pix_fmt}, expected yuv420p`);
  if (stream.width !== layout.W || stream.height !== layout.H) issues.push(`size ${stream.width}x${stream.height}, expected ${layout.W}x${layout.H}`);
  if (!Number.isFinite(duration) || Math.abs(duration - outDur) > 0.5) issues.push(`duration ${duration}s, expected ~${outDur.toFixed(2)}s`);
  return { ok: !issues.length, issues, duration, width: stream.width, height: stream.height };
}

export async function extractCheckFrames(output: string, outDur: number): Promise<string[]> {
  const base = output.replace(/\.mp4$/, '');
  const frames: Array<{ at: number; name: string }> = [
    { at: 0.2, name: 'first' },
    { at: outDur / 2, name: 'mid' },
    { at: Math.max(0, outDur - 0.3), name: 'last' },
  ];
  const paths: string[] = [];
  for (const frame of frames) {
    const framePath = `${base}-frame-${frame.name}.png`;
    const { code, stderr } = await run(['ffmpeg', '-y', '-v', 'error', '-ss', frame.at.toFixed(2), '-i', output, '-frames:v', '1', framePath]);
    if (code !== 0) throw new Error(`frame extraction failed: ${stderr.slice(-500)}`);
    paths.push(path.resolve(framePath));
  }
  return paths;
}

async function createRoundedMask(tmpDir: string, name: string, w: number, h: number, radius: number): Promise<string> {
  const file = path.join(tmpDir, name);
  const { code, stderr } = await run(['magick', '-size', `${w}x${h}`, 'xc:black', '-fill', 'white', '-draw', `roundrectangle 0,0,${w - 1},${h - 1},${radius},${radius}`, file]);
  if (code !== 0) throw new Error(`rounded mask generation failed: ${stderr.slice(-500)}`);
  return file;
}

async function createWindowBar(tmpDir: string, name: string, w: number, h: number, title: string, style: 'light' | 'dark'): Promise<string> {
  const colors = BAR_STYLES[style];
  const r = Math.round(h * 0.16);
  const cy = Math.round(h / 2);
  const gap = Math.round(h * 0.55);
  const file = path.join(tmpDir, name);
  const cmd = ['magick', '-size', `${w}x${h}`, `xc:${colors.bg}`];
  TRAFFIC_LIGHTS.forEach((color, i) => {
    const cx = gap + i * gap;
    cmd.push('-fill', color, '-draw', `circle ${cx},${cy} ${cx + r},${cy}`);
  });
  let text = title;
  if (text.length > 70) text = `${text.slice(0, 69)}…`;
  cmd.push('-fill', colors.text, '-pointsize', String(Math.round(h * 0.38)), '-gravity', 'center', '-annotate', '+0+0', text, file);
  const { code, stderr } = await run(cmd);
  if (code !== 0) throw new Error(`window bar generation failed: ${stderr.slice(-500)}`);
  return file;
}

function buildFilterGraph(options: ComposeOptions): string {
  const { layout, bg, segStart, segLen, speed, outDur, terminalSetptsFactor, background } = options;
  const { browser, terminal, windowBar } = layout;
  const dur = (outDur + 1).toFixed(3);
  const parts: string[] = [];

  let next = 2;
  let bgInput = -1;
  if (background.kind === 'image') bgInput = next++;
  const browserBarInput = next++;
  const terminalBarInput = next++;
  const browserMaskInput = next++;
  const terminalMaskInput = next++;

  if (bgInput >= 0) {
    parts.push(`[${bgInput}:v]scale=${layout.W}:${layout.H}:force_original_aspect_ratio=increase:out_range=tv,crop=${layout.W}:${layout.H},setsar=1,fps=30,format=yuv420p[canvas]`);
  } else {
    parts.push(`color=c=${bg}:s=${layout.W}x${layout.H}:d=${dur}:r=30[canvas]`);
  }

  if (layout.shadows) {
    const browserShadow = `drawbox=x=${browser.x + 8}:y=${browser.y + 14}:w=${browser.w}:h=${browser.h}:color=${SHADOW_LEVEL}:t=fill`;
    const terminalShadow = `drawbox=x=${terminal.x + 8}:y=${terminal.y + 14}:w=${terminal.w}:h=${terminal.h}:color=${SHADOW_LEVEL}:t=fill`;
    parts.push(`color=c=black:s=${layout.W}x${layout.H}:d=${dur}:r=30[shmaskbase]`);
    parts.push(`[shmaskbase]${browserShadow},${terminalShadow},gblur=sigma=18,format=gray[shmask]`);
    parts.push(`color=c=black:s=${layout.W}x${layout.H}:d=${dur}:r=30,format=rgba[shfill]`);
    parts.push('[shfill][shmask]alphamerge[shadow]');
    parts.push('[canvas][shadow]overlay=0:0[bg]');
  } else {
    parts.push('[canvas]null[bg]');
  }

  const videoH = browser.h - windowBar;
  parts.push(`[0:v]trim=start=${segStart.toFixed(3)}:duration=${segLen.toFixed(3)},setpts=(PTS-STARTPTS)/${speed.toFixed(4)},fps=30,scale=${browser.w}:${videoH}:flags=lanczos,format=rgba[bvideo]`);
  parts.push(`[${browserBarInput}:v]format=rgba[bbar]`);
  parts.push('[bbar][bvideo]vstack[bwin]');
  parts.push(`[bwin][${browserMaskInput}:v]alphamerge[browserwin]`);

  const terminalFilters: string[] = [];
  if (terminalSetptsFactor !== 1) terminalFilters.push(`setpts=PTS*${terminalSetptsFactor.toFixed(4)}`);
  terminalFilters.push(`trim=start=${STARTUP_PAD_SEC}`, 'setpts=PTS-STARTPTS', 'fps=30', `scale=${terminal.w}:${terminal.h - windowBar}:flags=lanczos`, 'format=rgba');
  parts.push(`[1:v]${terminalFilters.join(',')}[tvideo]`);
  parts.push(`[${terminalBarInput}:v]format=rgba[tbar]`);
  parts.push('[tbar][tvideo]vstack[twin]');
  parts.push(`[twin][${terminalMaskInput}:v]alphamerge,colorchannelmixer=aa=${TERMINAL_OPACITY},tpad=stop_mode=clone:stop_duration=4,trim=duration=${outDur.toFixed(3)}[term]`);

  parts.push(`[bg][browserwin]overlay=${browser.x}:${browser.y}[withbrowser]`);
  parts.push(`[withbrowser][term]overlay=${terminal.x}:${terminal.y},format=yuv420p,setrange=tv[out]`);
  return parts.join(';');
}

export interface ComposeOptions {
  browserWebm: string;
  terminalMp4: string;
  output: string;
  layout: Layout;
  bg: string;
  background: Background;
  title: string;
  appTitle: string;
  terminalBarStyle: 'light' | 'dark';
  tmpDir: string;
  segStart: number;
  segLen: number;
  speed: number;
  outDur: number;
  terminalSetptsFactor: number;
}

export interface OutputCheck {
  ok: boolean;
  issues: string[];
  duration?: number;
  width?: number;
  height?: number;
}
