import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigParser } from '../../config.ts';
import { computeHtmlFingerprint } from '../../utils/html-diff.ts';
import { debugLog } from './mixin.ts';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FINGERPRINT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const FINGERPRINT_WORKER_TIMEOUT_MS = 10_000;
const SIMILARITY_THRESHOLD = 90;

const memoryCache: Record<string, string> = {};
const memoryCacheTimestamps: Record<string, number> = {};

let fingerprintWorker: Worker | null = null;

function getStatesDir(): string {
  return join(ConfigParser.getInstance().getOutputDir(), 'states');
}

function getFingerprintWorker(): Worker {
  if (!fingerprintWorker) {
    fingerprintWorker = new Worker(new URL('./fingerprint-worker.ts', import.meta.url).href);
  }
  return fingerprintWorker;
}

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

export function saveResearch(hash: string, text: string, combinedHtml?: string): string {
  const outputDir = ConfigParser.getInstance().getOutputDir();
  const researchDir = join(outputDir, 'research');
  const researchFile = join(researchDir, `${hash}.md`);
  if (!existsSync(researchDir)) mkdirSync(researchDir, { recursive: true });
  writeFileSync(researchFile, text);
  memoryCache[hash] = text;
  memoryCacheTimestamps[hash] = Date.now();
  debugLog(`Research saved to ${researchFile}`);

  if (combinedHtml) {
    const statesDir = getStatesDir();
    if (!existsSync(statesDir)) mkdirSync(statesDir, { recursive: true });
    const fingerprint = computeHtmlFingerprint(combinedHtml);
    const fingerprintFile = join(statesDir, `${hash}.fingerprint`);
    writeFileSync(fingerprintFile, fingerprint.join('\n'));
    debugLog(`Fingerprint saved to ${fingerprintFile}`);
  }

  return researchFile;
}

export function findSimilarResearch(combinedHtml: string): Promise<string | null> {
  const statesDir = getStatesDir();
  if (!existsSync(statesDir)) return Promise.resolve(null);

  const worker = getFingerprintWorker();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      debugLog('Fingerprint worker timed out');
      resolve(null);
    }, FINGERPRINT_WORKER_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timeout);
      const { matchHash, similarity } = event.data as { matchHash: string | null; similarity: number };
      if (!matchHash) {
        resolve(null);
        return;
      }

      debugLog(`Similar research found: ${matchHash} (${similarity}% similar)`);
      const research = getCachedResearch(matchHash);
      if (research) {
        resolve(research);
        return;
      }
      resolve(null);
    };

    worker.postMessage({
      html: combinedHtml,
      statesDir,
      maxAgeMs: FINGERPRINT_MAX_AGE_MS,
      threshold: SIMILARITY_THRESHOLD,
    });
  });
}
