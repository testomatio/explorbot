import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import dedent from 'dedent';

const GLOBAL_CONFIG_NAMES = ['config.js', 'config.mjs', 'config.ts'];
const SITE_DIRS = ['knowledge', 'experience', 'output'];

export const EXPLORBOT_CONFIG_PATHS = ['explorbot.config.js', 'explorbot.config.mjs', 'explorbot.config.ts'];

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
  return firstExisting(globalDir(), GLOBAL_CONFIG_NAMES);
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

export function findSiteConfig(dir: string): string | null {
  return firstExisting(dir, EXPLORBOT_CONFIG_PATHS);
}

function ensureSiteConfig(dir: string, baseUrl: string): string {
  const existing = findSiteConfig(dir);
  if (existing) return existing;

  const path = join(dir, EXPLORBOT_CONFIG_PATHS[0]);
  writeFileSync(path, siteConfigTemplate(baseUrl), 'utf8');
  return path;
}

export async function loadSiteConfig(dir: string, baseUrl: string): Promise<{ path: string; config: any }> {
  const path = ensureSiteConfig(dir, baseUrl);
  const module = await import(pathToFileURL(resolve(path)).href);
  const config = module.default || module;
  validateSiteConfig(config, path, baseUrl);
  return { path, config };
}

function validateSiteConfig(config: any, configPath: string, baseUrl: string): void {
  const url = config?.web?.url;
  if (!url) {
    throw new Error(dedent`
      Site config is missing web.url.
        ${configPath}

      Add it so the config states which site it configures:
        web: { url: '${baseUrl}' },
    `);
  }

  const declared = URL.parse(url)?.origin;
  if (declared === baseUrl) return;

  throw new Error(dedent`
    Site config declares a different site.
      ${configPath}
      web.url:  ${url}
      site:     ${baseUrl}

    Fix web.url, or explore ${url} to register it as its own site.
  `);
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

function firstExisting(dir: string, names: string[]): string | null {
  for (const name of names) {
    const fullPath = join(dir, name);
    if (existsSync(fullPath)) return fullPath;
  }
  return null;
}

function siteConfigTemplate(baseUrl: string): string {
  return `// Config for ${baseUrl}
// Extends ~/.explorbot/config.js — set only what differs.
const config = {
  web: {
    url: '${baseUrl}',
  },

  // ai: {
  //   model: 'openrouter/openai/gpt-oss-120b',
  // },

  // playwright: {
  //   show: true,
  // },
};

export default config;
`;
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
