import { tag } from './logger.js';
import { parseSpecPairs } from './spec.ts';
import { matchesUrl } from './url-matcher.ts';

export class UrlFilter {
  readonly include: string[] = [];
  readonly exclude: string[] = [];
  sort?: 'priority' | 'lastmod';
  limit = Number.POSITIVE_INFINITY;
  private admitted = new Set<string>();

  constructor(spec?: string) {
    for (const { key, value } of parseSpecPairs(spec)) {
      if (key === 'filter') {
        this.include.push(value);
        continue;
      }
      if (key === 'exclude') {
        this.exclude.push(value);
        continue;
      }
      if (key === 'sort' && (value === 'priority' || value === 'lastmod')) {
        this.sort = value;
        continue;
      }
      if (key === 'limit' && Number.parseInt(value, 10) > 0) {
        this.limit = Number.parseInt(value, 10);
        continue;
      }
      tag('warning').log(`Ignoring URL filter pair ${key}:${value} (use filter|exclude:<url pattern>, sort:priority|lastmod, limit:<n>)`);
    }
  }

  allows(url: string): boolean {
    const path = urlPath(url);
    if (this.include.length > 0 && !this.include.some((pattern) => matchesUrl(pattern, path))) return false;
    return !this.exclude.some((pattern) => matchesUrl(pattern, path));
  }

  admit(url: string): boolean {
    if (!this.allows(url)) return false;
    const path = urlPath(url);
    if (this.admitted.has(path)) return true;
    if (this.admitted.size >= this.limit) return false;
    this.admitted.add(path);
    return true;
  }
}

function urlPath(url: string): string {
  const parsed = new URL(url, 'http://localhost');
  return `${parsed.pathname}${parsed.search}`;
}
