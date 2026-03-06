import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigParser } from '../../config.ts';
import { debugLog } from './mixin.ts';

const CACHE_TTL_MS = 60 * 60 * 1000;

const memoryCache: Record<string, string> = {};
const memoryCacheTimestamps: Record<string, number> = {};

export function getCachedResearch(hash: string): string {
  if (!hash) return '';
  const now = Date.now();
  const timestamp = memoryCacheTimestamps[hash];
  if (timestamp && now - timestamp <= CACHE_TTL_MS) {
    return memoryCache[hash] || '';
  }
  const outputDir = ConfigParser.getInstance().getOutputDir();
  const researchFile = join(outputDir, 'research', `${hash}.md`);
  if (!existsSync(researchFile)) return '';
  const stats = statSync(researchFile);
  if (now - stats.mtimeMs > CACHE_TTL_MS) return '';
  const cached = readFileSync(researchFile, 'utf8');
  memoryCache[hash] = cached;
  memoryCacheTimestamps[hash] = now;
  return cached;
}

export function saveResearch(hash: string, text: string): string {
  const outputDir = ConfigParser.getInstance().getOutputDir();
  const researchDir = join(outputDir, 'research');
  const researchFile = join(researchDir, `${hash}.md`);
  if (!existsSync(researchDir)) mkdirSync(researchDir, { recursive: true });
  writeFileSync(researchFile, text);
  memoryCache[hash] = text;
  memoryCacheTimestamps[hash] = Date.now();
  debugLog(`Research saved to ${researchFile}`);
  return researchFile;
}
