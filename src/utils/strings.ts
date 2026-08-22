import { createHash } from 'node:crypto';
import stripAnsi from 'strip-ansi';

export function truncateJson(input: any): string {
  if (!input) return '';
  const str = JSON.stringify(input);
  return str.length <= 80 ? str : `${str.slice(0, 77)}...`;
}

export function slugify(text: string): string {
  return text
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
}

export function normalizeInlineText(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
}

export function safeFilename(name: string, ext = '', maxBytes = 240): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const extBytes = Buffer.byteLength(ext, 'utf8');
  const budget = maxBytes - extBytes;
  if (Buffer.byteLength(sanitized, 'utf8') <= budget) return sanitized + ext;

  const hash = createHash('sha1').update(name).digest('hex').slice(0, 8);
  const suffix = `_${hash}`;
  let truncated = sanitized;
  while (Buffer.byteLength(truncated + suffix, 'utf8') > budget && truncated.length > 0) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + suffix + ext;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

const MAX_COMPACT_ERROR = 400;

export function compactErrorMessage(error: unknown): string {
  let text = stripAnsi(String(error));
  for (const strip of STRIP_STRATEGIES) {
    text = strip(text);
  }
  return truncate(text, MAX_COMPACT_ERROR);
}

function stripCallLog(text: string): string {
  const CALL_LOG = 'Call log:';
  const NOISE = ['attempting', 'retrying', 'waiting'];

  const [headline, ...log] = text.split(CALL_LOG);
  if (!log.length) return text;

  const lines = new Set<string>();
  for (const line of log.join(CALL_LOG).split('\n')) {
    const cleaned = normalizeInlineText(line);
    if (!cleaned) continue;
    if (NOISE.some((noise) => cleaned.includes(noise))) continue;
    lines.add(cleaned);
  }

  return [headline.trim(), ...lines].join(' ');
}

const STRIP_STRATEGIES = [stripCallLog];
