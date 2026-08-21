import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { outputPath } from '../../config.ts';
import { TTLCache } from '../../utils/cache.ts';
import { computeHtmlFingerprint } from '../../utils/html-diff.ts';
import { tag } from '../../utils/logger.ts';
import { debugLog } from './mixin.ts';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FINGERPRINT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const FINGERPRINT_WORKER_TIMEOUT_MS = 10_000;
const SIMILARITY_THRESHOLD = 90;

const memoryCache = new TTLCache<string>(CACHE_TTL_MS);

let fingerprintWorker: Worker | null = null;

export function researchPath(hash: string): string {
  return outputPath('research', `${hash}.md`);
}

export function reportResearch(hash: string, text: string): void {
  tag('data').log('research', { path: researchPath(hash), hash, content: text });
}

function getStatesDir(): string {
  return outputPath('states');
}

function getFingerprintWorker(): Worker {
  if (!fingerprintWorker) {
    const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
    fingerprintWorker = new Worker(new URL(`./fingerprint-worker${ext}`, import.meta.url));
  }
  return fingerprintWorker;
}

export function clearResearchCache(): void {
  memoryCache.clear();
}

export function getCachedResearch(hash: string): string {
  if (!hash) return '';
  const cached = memoryCache.get(hash);
  if (cached !== undefined) return cached;
  const researchFile = researchPath(hash);
  if (!existsSync(researchFile)) return '';
  const stats = statSync(researchFile);
  if (Date.now() - stats.mtimeMs > CACHE_TTL_MS) return '';
  const fromDisk = readFileSync(researchFile, 'utf8');
  memoryCache.set(hash, fromDisk);
  return fromDisk;
}

export function getPreviousResearch(hash: string): string {
  if (!hash) return '';
  const researchFile = researchPath(hash);
  if (!existsSync(researchFile)) return '';
  return readFileSync(researchFile, 'utf8');
}

export function saveResearch(hash: string, text: string, combinedHtml?: string, url?: string): string {
  const researchDir = outputPath('research');
  const researchFile = join(researchDir, `${hash}.md`);
  if (!existsSync(researchDir)) mkdirSync(researchDir, { recursive: true });
  writeFileSync(researchFile, text);
  memoryCache.set(hash, text);
  reportResearch(hash, text);
  debugLog(`Research saved to ${researchFile}`);

  if (combinedHtml) {
    const statesDir = getStatesDir();
    if (!existsSync(statesDir)) mkdirSync(statesDir, { recursive: true });
    const fingerprint = computeHtmlFingerprint(combinedHtml);
    const fingerprintFile = join(statesDir, `${hash}.fingerprint`);
    const record: FingerprintRecord = { entries: fingerprint };
    if (url) record.url = url;
    writeFileSync(fingerprintFile, JSON.stringify(record));
    debugLog(`Fingerprint saved to ${fingerprintFile}`);
  }

  return researchFile;
}

function findSimilarMatch(combinedHtml: string, url?: string): Promise<FingerprintMatch | null> {
  const statesDir = getStatesDir();
  if (!existsSync(statesDir)) return Promise.resolve(null);

  const worker = getFingerprintWorker();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      debugLog('Fingerprint worker timed out');
      resolve(null);
    }, FINGERPRINT_WORKER_TIMEOUT_MS);

    worker.on('message', (data: { matchHash: string | null; similarity: number; url?: string }) => {
      clearTimeout(timeout);
      const { matchHash, similarity } = data;
      if (!matchHash) {
        resolve(null);
        return;
      }

      debugLog(`Similar fingerprint found: ${matchHash} (${similarity}% similar)`);
      resolve({ hash: matchHash, similarity, url: data.url });
    });

    worker.postMessage({
      html: combinedHtml,
      statesDir,
      maxAgeMs: FINGERPRINT_MAX_AGE_MS,
      threshold: SIMILARITY_THRESHOLD,
      url,
    });
  });
}

export async function findSimilarResearch(combinedHtml: string, url?: string): Promise<string | null> {
  const match = await findSimilarMatch(combinedHtml, url);
  if (!match) return null;
  return getCachedResearch(match.hash) || null;
}

export async function findSimilarStateHash(combinedHtml: string, url?: string): Promise<string | null> {
  const match = await findSimilarMatch(combinedHtml, url);
  return match?.hash || null;
}

type FingerprintRecord = { entries: string[]; url?: string };
type FingerprintMatch = { hash: string; similarity: number; url?: string };
