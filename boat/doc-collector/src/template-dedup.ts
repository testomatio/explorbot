import { ariaTemplateSignature } from '../../../src/utils/aria.ts';
import { diceSimilarity } from '../../../src/utils/similarity.ts';

const TEMPLATE_MIN_SIGNATURE_SIZE = 8;
const TEMPLATE_SIMILARITY_THRESHOLD = 90;

export function buildTemplateRecord(url: string, snapshot: string | null): TemplateRecord | null {
  const signature = ariaTemplateSignature(snapshot);
  if (signature.size < TEMPLATE_MIN_SIGNATURE_SIZE) return null;
  return { url, signature };
}

export function findTemplateMatch(snapshot: string | null, known: TemplateRecord[], threshold: number = TEMPLATE_SIMILARITY_THRESHOLD): string | null {
  const signature = ariaTemplateSignature(snapshot);
  if (signature.size < TEMPLATE_MIN_SIGNATURE_SIZE) return null;
  let bestUrl: string | null = null;
  let bestScore = 0;
  for (const record of known) {
    const score = diceSimilarity(signature, record.signature);
    if (score < bestScore) continue;
    bestScore = score;
    bestUrl = record.url;
  }
  if (bestScore < threshold) return null;
  return bestUrl;
}

export interface TemplateRecord {
  url: string;
  signature: Set<string>;
}
