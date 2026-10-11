import { readFileSync } from 'node:fs';
import { tag } from './logger.js';
import type { UrlFilter } from './url-filter.ts';

const ENTRY_PATTERN = /<(url|sitemap)\b[^>]*>(.*?)<\/\1>/gis;
const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const MAX_NESTED_SITEMAPS = 50;
const DEFAULT_PRIORITY = 0.5;
const STDIN_SOURCE = '-';

export async function readSitemap(source: string, filter?: UrlFilter): Promise<string[]> {
  const entries: SitemapEntry[] = [];
  const seen = new Set<string>();
  const pending = [source];
  let fetched = 0;

  while (pending.length > 0) {
    if (fetched >= MAX_NESTED_SITEMAPS) {
      tag('warning').log(`Sitemap index lists more than ${MAX_NESTED_SITEMAPS} sitemaps, the rest are ignored`);
      break;
    }
    const next = pending.shift()!;
    fetched++;
    const content = await readSource(next);
    const isIndex = content.includes('<sitemapindex');
    for (const entry of extractEntries(content)) {
      if (seen.has(entry.url)) continue;
      seen.add(entry.url);
      if (isIndex) {
        pending.push(entry.url);
        continue;
      }
      entries.push(entry);
    }
  }

  return applyFilter(entries, filter).map((entry) => entry.url);
}

export async function readCliSitemap(path: string | undefined, source: string | undefined, filter?: UrlFilter): Promise<string[] | undefined> {
  const usage = 'Pass a page path, --sitemap <source>, or pipe a sitemap to stdin';
  let resolved = source;
  if (!resolved && !path && !process.stdin.isTTY) resolved = STDIN_SOURCE;
  if (!resolved && !path) throw new Error(usage);
  if (!resolved) return undefined;
  const urls = await readSitemap(resolved, filter);
  if (urls.length === 0 && !source) throw new Error(usage);
  if (urls.length === 0) throw new Error(`No URLs left in sitemap ${resolved}`);
  return urls;
}

export function keepSiteUrls(urls: string[], siteUrl: string): string[] {
  const siteOrigin = URL.parse(siteUrl)?.origin;
  const kept = urls.filter((url) => url.startsWith('/') || URL.parse(url)?.origin === siteOrigin);
  if (kept.length < urls.length) tag('warning').log(`Skipped ${urls.length - kept.length} sitemap URL(s) outside ${siteOrigin}`);
  return kept;
}

export function extractEntries(content: string): SitemapEntry[] {
  if (!content.trimStart().startsWith('<')) {
    return content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('http://') || line.startsWith('https://') || line.startsWith('/'))
      .map((url) => ({ url, priority: DEFAULT_PRIORITY }));
  }
  const entries: SitemapEntry[] = [];
  for (const match of content.matchAll(ENTRY_PATTERN)) {
    const url = tagValue(match[2], 'loc');
    if (!url) continue;
    const entry: SitemapEntry = { url, priority: DEFAULT_PRIORITY };
    const priority = Number.parseFloat(tagValue(match[2], 'priority') || '');
    if (!Number.isNaN(priority)) entry.priority = priority;
    const lastmod = Date.parse(tagValue(match[2], 'lastmod') || '');
    if (!Number.isNaN(lastmod)) entry.lastmod = lastmod;
    entries.push(entry);
  }
  return entries;
}

function applyFilter(entries: SitemapEntry[], filter: UrlFilter | undefined): SitemapEntry[] {
  if (!filter) return entries;
  let result = entries.filter((entry) => filter.allows(entry.url));
  if (filter.sort === 'priority') result = result.toSorted((a, b) => b.priority - a.priority);
  if (filter.sort === 'lastmod') result = result.toSorted((a, b) => (b.lastmod ?? 0) - (a.lastmod ?? 0));
  return result.slice(0, filter.limit);
}

function tagValue(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[)?\\s*(.*?)\\s*(?:\\]\\]>)?\\s*</${name}>`, 'is'));
  return match?.[1].replace(/&(amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity]) || undefined;
}

async function readSource(source: string): Promise<string> {
  if (source === STDIN_SOURCE) return readFileSync(0, 'utf8');
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Sitemap ${source} returned HTTP ${response.status}`);
    return await response.text();
  }
  return readFileSync(source, 'utf8');
}

interface SitemapEntry {
  url: string;
  priority: number;
  lastmod?: number;
}
