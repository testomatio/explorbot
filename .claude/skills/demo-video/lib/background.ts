import { existsSync } from 'node:fs';
import path from 'node:path';
import { run } from './proc';

const GRADIENT_PALETTES = [
  ['#0f2027', '#203a43', '#2c5364'],
  ['#232526', '#414345', '#6b6b83'],
  ['#355c7d', '#6c5b7b', '#c06c84'],
  ['#2c3e50', '#4ca1af', '#c4e0e5'],
  ['#41295a', '#2f0743', '#8e44ad'],
];

export async function resolveBackground(spec: string, W: number, H: number, tmpDir: string): Promise<Background> {
  if (spec === 'none') return { kind: 'color' };
  if (spec === 'gradient') return generateGradient(W, H, tmpDir);
  if (spec === 'auto') {
    const unsplash = await fetchUnsplash(W, H, tmpDir);
    if (unsplash) return unsplash;
    return generateGradient(W, H, tmpDir);
  }
  if (spec.startsWith('http://') || spec.startsWith('https://')) {
    const downloaded = await download(spec, path.join(tmpDir, 'bg-download.jpg'));
    if (!downloaded) throw new Error(`Could not download background image: ${spec}`);
    return { kind: 'image', path: downloaded };
  }
  if (existsSync(spec)) return { kind: 'image', path: path.resolve(spec) };
  throw new Error(`Background image not found: ${spec}`);
}

async function fetchUnsplash(W: number, H: number, tmpDir: string): Promise<Background | null> {
  const search = await fetchJson(`https://unsplash.com/napi/search/photos?query=abstract%20background&per_page=30&orientation=${orientationFor(W, H)}`);
  const results = search?.results?.filter((p: any) => !p.premium && !p.plus);
  if (!results?.length) return null;
  const photo = results[Math.floor(Math.random() * results.length)];
  const raw = photo?.urls?.raw;
  if (!raw) return null;
  const url = `${raw}&w=${W}&h=${H}&fit=crop&q=80&fm=jpg`;
  const file = await download(url, path.join(tmpDir, 'bg-unsplash.jpg'));
  if (!file) return null;
  let credit = '';
  if (photo.user?.name) credit = `Background photo by ${photo.user.name} on Unsplash`;
  return { kind: 'image', path: file, credit };
}

async function generateGradient(W: number, H: number, tmpDir: string): Promise<Background> {
  const palette = GRADIENT_PALETTES[Math.floor(Math.random() * GRADIENT_PALETTES.length)];
  const seed = Math.floor(Math.random() * 100000);
  const file = path.join(tmpDir, 'bg-gradient.png');
  const source = `gradients=s=${W}x${H}:c0=${palette[0]}:c1=${palette[1]}:c2=${palette[2]}:nb_colors=3:seed=${seed}`;
  const { code, stderr } = await run(['ffmpeg', '-y', '-v', 'error', '-f', 'lavfi', '-i', source, '-frames:v', '1', file]);
  if (code !== 0) throw new Error(`gradient background generation failed: ${stderr.slice(-500)}`);
  return { kind: 'image', path: file };
}

function orientationFor(W: number, H: number): string {
  if (W > H) return 'landscape';
  if (W < H) return 'portrait';
  return 'squarish';
}

async function fetchJson(url: string): Promise<any | null> {
  const response = await fetch(url, { headers: { 'User-Agent': 'explorbot-demo-video' }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

async function download(url: string, dest: string): Promise<string | null> {
  const response = await fetch(url, { headers: { 'User-Agent': 'explorbot-demo-video' }, signal: AbortSignal.timeout(15000) }).catch(() => null);
  if (!response?.ok) return null;
  await Bun.write(dest, response);
  return dest;
}

export interface Background {
  kind: 'image' | 'color';
  path?: string;
  credit?: string;
}
