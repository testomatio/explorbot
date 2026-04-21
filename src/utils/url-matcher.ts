import micromatch from 'micromatch';
import { ConfigParser } from '../config.js';

export function isDynamicSegment(segment: string): boolean {
  try {
    const configRegex = ConfigParser.getInstance().getConfig().dynamicPageRegex;
    if (configRegex) return new RegExp(configRegex, 'i').test(segment);
  } catch {
    /* config not loaded yet */
  }

  // numeric: /users/123
  if (/^\d+$/.test(segment)) return true;
  // UUID: /items/550e8400-e29b-41d4-a716-446655440000
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(segment)) return true;
  // ULID: /items/01ARZ3NDEKTSV4RRFFQ69G5FAV
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(segment)) return true;
  // hex ID (4+ chars): /suite/70dae98a
  if (/^[a-f0-9]{4,}$/i.test(segment)) return true;
  // hex-prefixed slug (8+ hex before dash): /suite/95ef0c94-mobile
  if (/^[a-f0-9]{8,}-/i.test(segment)) return true;
  // short mixed alphanumeric (digits + letters, ≤8 chars, no dash): /item/x7f2
  if (segment.length <= 8 && !segment.includes('-') && /\d/.test(segment) && /[a-z]/i.test(segment)) return true;
  return false;
}

export function hasDynamicUrlSegment(url: string): boolean {
  return url.split('/').some((seg) => seg.length > 0 && isDynamicSegment(seg));
}

export function generalizeSegment(segment: string): string {
  if (/^\d+$/.test(segment)) return '\\d+';
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(segment)) return '[a-f0-9-]+';
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/.test(segment)) return '[0-9A-HJKMNP-TV-Z]+';
  if (/^[a-f0-9]+$/i.test(segment)) return '[a-f0-9]+';
  return '[^/]+';
}

export function generalizeUrl(url: string): string {
  return url
    .split('/')
    .map((seg) => (seg.length > 0 && isDynamicSegment(seg) ? generalizeSegment(seg) : seg))
    .join('/');
}

export function matchesUrl(pattern: string, path: string): boolean {
  if (pattern === '*') return true;
  const norm = (s: string) => s?.replace(/\/+$/, '').toLowerCase();
  if (norm(pattern) === norm(path)) return true;

  if (pattern.endsWith('/*')) {
    const base = pattern.slice(0, -2).replace(/\/+$/, '');
    const normPath = path.replace(/\/+$/, '');
    if (normPath === base || path.startsWith(`${base}/`)) return true;
  }

  if (pattern.startsWith('^')) {
    try {
      return new RegExp(pattern.slice(1)).test(path);
    } catch {
      return false;
    }
  }

  if (pattern.startsWith('~') && pattern.endsWith('~') && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(path);
    } catch {
      return false;
    }
  }

  try {
    return micromatch.isMatch(path, pattern);
  } catch {
    return false;
  }
}

export function extractStatePath(url: string): string {
  if (url.startsWith('/')) return url;
  try {
    const urlObj = new URL(url);
    return urlObj.pathname + urlObj.hash;
  } catch {
    return url;
  }
}
