export function diceSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const total = a.size + b.size;
  if (total === 0) return 100;
  return Math.round(((2 * intersection) / total) * 100);
}
