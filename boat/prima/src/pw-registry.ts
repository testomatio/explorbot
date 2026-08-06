import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TITLE = 'default';
const DEFAULT_BROWSER = 'chromium';

export function registryDir(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright', 'b');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright', 'b');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'ms-playwright', 'b');
}

export function readDescriptors(dir = registryDir()): PwServerDescriptor[] {
  const descriptors: PwServerDescriptor[] = [];
  for (const fileName of listFiles(dir)) {
    const descriptor = parseDescriptor(path.join(dir, fileName));
    if (descriptor) descriptors.push(descriptor);
  }
  return descriptors;
}

export function selectDescriptor(descriptors: PwServerDescriptor[], opts: { workspaceDir: string; title?: string }): { match?: PwServerDescriptor; candidates: PwServerDescriptor[] } {
  const workspaceDir = path.resolve(opts.workspaceDir);
  const candidates = descriptors.filter((descriptor) => path.resolve(descriptor.workspaceDir) === workspaceDir);
  if (!candidates.length) return { candidates };

  if (opts.title) {
    const titled = candidates.find((descriptor) => descriptor.title === opts.title);
    if (titled) return { match: titled, candidates };
    return { candidates };
  }

  const preferred = candidates.find((descriptor) => descriptor.title === DEFAULT_TITLE);
  if (preferred) return { match: preferred, candidates };
  if (candidates.length === 1) return { match: candidates[0], candidates };
  return { candidates };
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function parseDescriptor(file: string): PwServerDescriptor | null {
  let data: any;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }

  if (!data?.endpoint || !data?.title || !data?.workspaceDir) return null;

  return {
    file,
    title: data.title,
    endpoint: data.endpoint,
    workspaceDir: data.workspaceDir,
    browserName: data.browser?.browserName || DEFAULT_BROWSER,
    playwrightLib: data.playwrightLib || '',
  };
}

export interface PwServerDescriptor {
  file: string;
  title: string;
  endpoint: string;
  workspaceDir: string;
  browserName: string;
  playwrightLib: string;
}
