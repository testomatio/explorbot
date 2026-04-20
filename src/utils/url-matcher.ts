import micromatch from 'micromatch';

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
    return `${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
  } catch {
    return url;
  }
}
