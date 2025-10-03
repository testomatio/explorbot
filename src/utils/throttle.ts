const DEFAULT_INTERVAL_SECONDS = 30;

const lastExecutionByKey = new Map<string, number>();

export async function throttle<T>(fn: () => Promise<T> | T, intervalSeconds = DEFAULT_INTERVAL_SECONDS): Promise<T | undefined> {
  const key = fn.toString();
  const now = Date.now();
  const lastExecution = lastExecutionByKey.get(key);
  if (lastExecution !== undefined && now - lastExecution < intervalSeconds * 1000) {
    return undefined;
  }
  lastExecutionByKey.set(key, now);
  return await fn();
}

export function __clearThrottleCacheForTests(): void {
  lastExecutionByKey.clear();
}
