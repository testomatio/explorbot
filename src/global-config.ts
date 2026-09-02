import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

const GLOBAL_CONFIG_NAMES = ['config.js', 'config.mjs', 'config.ts'];
const SITE_DIRS = ['knowledge', 'experience', 'output'];

export function globalDir(): string {
  return join(os.homedir(), '.explorbot');
}

export function globalEnvPath(): string {
  return join(globalDir(), '.env');
}

export function globalConfigPath(): string {
  return join(globalDir(), 'config.js');
}

export function findGlobalConfig(): string | null {
  for (const name of GLOBAL_CONFIG_NAMES) {
    const fullPath = join(globalDir(), name);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

export function isGlobalConfigPath(configPath: string): boolean {
  return GLOBAL_CONFIG_NAMES.some((name) => join(globalDir(), name) === configPath);
}

export function sitesDir(): string {
  return join(globalDir(), 'sites');
}

export function siteFolderName(url: string): string {
  return new URL(url).host.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

export function listSites(): SiteRecord[] {
  if (!existsSync(sitesDir())) return [];

  return readdirSync(sitesDir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSite(entry.name))
    .filter((site): site is SiteRecord => !!site)
    .sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt));
}

export function findSiteWith(subpath: string): SiteRecord | undefined {
  return listSites().find((site) => existsSync(join(site.dir, subpath)));
}

export function listSitePlanDirs(): string[] {
  return listSites().map((site) => join(site.dir, 'output', 'plans'));
}

export function registerSite(baseUrl: string): SiteRecord {
  const folder = siteFolderName(baseUrl);
  const dir = join(sitesDir(), folder);
  for (const subDir of SITE_DIRS) {
    mkdirSync(join(dir, subDir), { recursive: true, mode: 0o700 });
  }

  const now = new Date().toISOString();
  const meta = {
    url: baseUrl,
    createdAt: readSite(folder)?.createdAt || now,
    lastRunAt: now,
  };
  writeFileSync(join(dir, 'site.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  return { folder, dir, ...meta };
}

export function resolveSiteTarget(target?: string, defaultBaseUrl?: string): SiteTarget {
  const raw = (target || process.env.EXPLORBOT_URL || defaultBaseUrl || '').trim();
  if (!raw) {
    throw new Error(withSites('No site to explore. Pass a URL to the command or set EXPLORBOT_URL.'));
  }

  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    const url = new URL(raw);
    return { baseUrl: url.origin, path: `${url.pathname}${url.search}${url.hash}` };
  }

  if (raw.startsWith('/')) {
    const base = defaultBaseUrl || process.env.EXPLORBOT_URL;
    if (!base) {
      throw new Error(withSites(`Cannot resolve path "${raw}" without a site.`));
    }
    return { baseUrl: new URL(base).origin, path: raw };
  }

  let reference = raw;
  let path = '/';
  const separator = raw.indexOf('/');
  if (separator > -1) {
    reference = raw.slice(0, separator);
    path = raw.slice(separator);
  }

  const site = findSite(reference);
  if (!site) {
    throw new Error(withSites(`Unknown site "${reference}".`));
  }
  return { baseUrl: site.url, path };
}

function readSite(folder: string): SiteRecord | null {
  const dir = join(sitesDir(), folder);
  const metaPath = join(dir, 'site.json');
  if (!existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    new URL(meta.url);
    return { folder, dir, url: meta.url, createdAt: meta.createdAt, lastRunAt: meta.lastRunAt };
  } catch {
    return null;
  }
}

function findSite(reference: string): SiteRecord | null {
  const normalized = reference.toLowerCase().replace(/[^a-z0-9._-]/g, '_');
  const sites = listSites();
  const byFolder = sites.find((site) => site.folder === normalized);
  if (byFolder) return byFolder;
  return sites.find((site) => new URL(site.url).host.toLowerCase() === reference.toLowerCase()) || null;
}

function withSites(message: string): string {
  const lines = [message];
  const sites = listSites();
  if (sites.length) {
    lines.push('Registered sites:');
    for (const site of sites) lines.push(`  ${site.folder} → ${site.url}`);
  }
  lines.push('Explore a new site by passing its full URL, e.g. https://app.example.com/login');
  return lines.join('\n');
}

interface SiteRecord {
  folder: string;
  dir: string;
  url: string;
  createdAt: string;
  lastRunAt: string;
}

interface SiteTarget {
  baseUrl: string;
  path: string;
}

export type { SiteRecord, SiteTarget };
