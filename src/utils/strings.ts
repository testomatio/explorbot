import { createHash } from 'node:crypto';

export function truncateJson(input: any): string {
  if (!input) return '';
  const str = JSON.stringify(input);
  return str.length <= 80 ? str : `${str.slice(0, 77)}...`;
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
