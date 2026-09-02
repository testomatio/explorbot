import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parentPort } from 'node:worker_threads';
import { computeHtmlFingerprint } from '../../utils/html-diff.ts';
import { isSamePageFamily } from '../../utils/url-matcher.ts';
import { diceSimilarity } from '../../utils/similarity.ts';

parentPort!.on('message', (data: FingerprintRequest) => {
  const { html, statesDir, maxAgeMs, threshold, url } = data;

  if (!existsSync(statesDir)) {
    parentPort!.postMessage({ matchHash: null, similarity: 0 });
    return;
  }

  const currentFingerprint = new Set(computeHtmlFingerprint(html));
  if (currentFingerprint.size === 0) {
    parentPort!.postMessage({ matchHash: null, similarity: 0 });
    return;
  }

  const now = Date.now();
  const files = readdirSync(statesDir).filter((f) => f.endsWith('.fingerprint'));

  let bestHash: string | null = null;
  let bestSimilarity = 0;
  let bestUrl: string | undefined;

  for (const file of files) {
    const filePath = join(statesDir, file);
    const mtime = statSync(filePath).mtimeMs;
    if (now - mtime > maxAgeMs) continue;

    const record = readFingerprint(filePath);
    if (url && record.url && !isSamePageFamily(url, record.url)) continue;
    const storedFingerprint = new Set(record.entries);
    const similarity = diceSimilarity(currentFingerprint, storedFingerprint);

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestHash = file.replace('.fingerprint', '');
      bestUrl = record.url;
    }
  }

  const matched = bestSimilarity >= threshold;
  parentPort!.postMessage({ matchHash: matched ? bestHash : null, similarity: bestSimilarity, url: matched ? bestUrl : undefined });
});

function readFingerprint(filePath: string): FingerprintRecord {
  const content = readFileSync(filePath, 'utf8');
  try {
    const record = JSON.parse(content);
    if (Array.isArray(record.entries)) return record;
  } catch {
    return { entries: content.split('\n').filter(Boolean) };
  }
  return { entries: content.split('\n').filter(Boolean) };
}

type FingerprintRecord = { entries: string[]; url?: string };
type FingerprintRequest = { html: string; statesDir: string; maxAgeMs: number; threshold: number; url?: string };
