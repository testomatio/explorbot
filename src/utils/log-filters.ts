interface LogFilterEntry {
  type: string;
  content: string;
}

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

export function isLowValueConsoleLog(entry: LogFilterEntry): boolean {
  if (entry.type !== 'substep') return false;
  return isLowValueSubstep(entry.content);
}

export function isLowValueTuiLog(entry: LogFilterEntry): boolean {
  if (entry.type !== 'substep') return false;
  return isLowValueSubstep(entry.content);
}

function isLowValueSubstep(content: string): boolean {
  if (content.startsWith('Saved screencast:')) return true;
  if (content.startsWith('Validated ') && content.includes(' locators:')) return true;
  if (content.startsWith('Research file saved to:')) return true;
  if (content.startsWith('Historian saved session for:')) return true;
  if (content.startsWith('Saved plan tests to:')) return true;
  return false;
}

function normalizeStepCommand(content: string): string | null {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (!normalized.startsWith('I.')) return null;
  return normalized.toLowerCase();
}
