import { tag } from './logger.js';

export function parseSpecPairs(raw: string | undefined): SpecPair[] {
  const pairs: SpecPair[] = [];
  for (const pair of (raw || '').split(';')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const sepMatch = trimmed.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
    if (!sepMatch) {
      tag('warning').log(`Ignoring malformed spec pair: ${trimmed}`);
      continue;
    }
    pairs.push({ key: sepMatch[1].trim().toLowerCase(), value: sepMatch[2].trim() });
  }
  return pairs;
}

export interface SpecPair {
  key: string;
  value: string;
}
