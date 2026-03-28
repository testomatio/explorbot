import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { computeHtmlFingerprint } from '../../utils/html-diff.ts';

declare const self: Worker;

function diceSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const total = a.size + b.size;
  if (total === 0) return 100;
  return Math.round(((2 * intersection) / total) * 100);
}

self.onmessage = (event: MessageEvent) => {
  const { html, statesDir, maxAgeMs, threshold } = event.data as {
    html: string;
    statesDir: string;
    maxAgeMs: number;
    threshold: number;
  };

  if (!existsSync(statesDir)) {
    self.postMessage({ matchHash: null, similarity: 0 });
    return;
  }

  const currentFingerprint = new Set(computeHtmlFingerprint(html));
  if (currentFingerprint.size === 0) {
    self.postMessage({ matchHash: null, similarity: 0 });
    return;
  }

  const now = Date.now();
  const files = readdirSync(statesDir).filter((f) => f.endsWith('.fingerprint'));

  let bestHash: string | null = null;
  let bestSimilarity = 0;

  for (const file of files) {
    const filePath = join(statesDir, file);
    const mtime = statSync(filePath).mtimeMs;
    if (now - mtime > maxAgeMs) continue;

    const lines = readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    const storedFingerprint = new Set(lines);
    const similarity = diceSimilarity(currentFingerprint, storedFingerprint);

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestHash = file.replace('.fingerprint', '');
    }
  }

  const matched = bestSimilarity >= threshold;
  self.postMessage({ matchHash: matched ? bestHash : null, similarity: bestSimilarity });
};
