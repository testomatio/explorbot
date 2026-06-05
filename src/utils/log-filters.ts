export class RecentStepFilter {
  private recentStepKeys = new Map<string, number>();

  constructor(private ttlMs = 15000) {}

  shouldSuppress(content: string, now = Date.now()): boolean {
    const key = normalizeStepCommand(content);
    if (!key) return false;

    for (const [existingKey, timestamp] of this.recentStepKeys) {
      if (now - timestamp > this.ttlMs) {
        this.recentStepKeys.delete(existingKey);
      }
    }

    if (this.recentStepKeys.has(key)) return true;
    this.recentStepKeys.set(key, now);
    return false;
  }
}

function normalizeStepCommand(content: string): string | null {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized.startsWith('I.')) return null;
  return normalized.toLowerCase();
}
