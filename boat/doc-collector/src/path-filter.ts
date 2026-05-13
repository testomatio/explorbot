import { normalizeUrl } from '../../../src/state-manager.ts';
import { matchesUrl, generalizeUrl } from '../../../src/utils/url-matcher.ts';
import type { DocbotConfig } from './config.ts';

const DEFAULT_DENIED_PATH_SEGMENTS = ['callback', 'callbacks', 'logout', 'signout', 'sign_out', 'destroy', 'delete', 'remove'];

export function shouldCrawlDocPath(nextPath: string, config: DocbotConfig = {}): boolean {
  const parsed = new URL(nextPath, 'http://localhost');
  const segments = parsed.pathname
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean);
  const normalizedPath = parsed.pathname || '/';

  const includePaths = config.docs?.includePaths || [];
  if (includePaths.length > 0) {
    return includePaths.some((pattern) => matchesUrl(pattern, normalizedPath));
  }

  const excludePaths = config.docs?.excludePaths || [];
  if (excludePaths.some((pattern) => matchesUrl(pattern, normalizedPath))) {
    return false;
  }

  if (segments.length === 0) {
    return true;
  }

  const terminalActions = new Set((config.docs?.deniedPathSegments || DEFAULT_DENIED_PATH_SEGMENTS).map((segment) => segment.trim().toLowerCase()).filter(Boolean));
  if (segments.some((segment) => terminalActions.has(segment))) {
    return false;
  }

  return true;
}

export function getDocPageKey(pageUrl: string, config: DocbotConfig = {}): string {
  const normalized = normalizeUrl(pageUrl || '/');
  const path = normalized.startsWith('/') ? normalized : `/${normalized}`;

  if (config.docs?.collapseDynamicPages === false) {
    return normalizeUrl(path);
  }

  return normalizeUrl(generalizeUrl(path));
}
