// Playwright and CodeceptJS surface browser/page disposal as plain Error objects,
// not typed exceptions. Keep those external message markers in one adapter so
// recovery decisions are not duplicated across agents/actions.
const FATAL_BROWSER_ERROR_MARKERS = ['Frame was detached', 'Target closed', 'Target page, context or browser has been closed', 'Execution context was destroyed', 'Protocol error', 'Session closed'];
const NAVIGATION_TRANSITION_ERROR_MARKERS = ['most likely because of a navigation', 'navigating and changing the content'];

export class BrowserRecoveryError extends Error {
  constructor(
    label: string,
    public originalError: unknown,
    public recovered: boolean
  ) {
    super(`${label} failed ${recovered ? 'after browser recovery' : 'because browser could not be recovered'}: ${browserErrorMessage(originalError)}`);
    this.name = 'BrowserRecoveryError';
  }
}

export function isFatalBrowserError(error: unknown): boolean {
  if (error instanceof BrowserRecoveryError) return true;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return FATAL_BROWSER_ERROR_MARKERS.some((marker) => message.includes(marker.toLowerCase()));
}

export function isNavigationTransitionError(error: unknown): boolean {
  const message = browserErrorMessage(error).toLowerCase();
  return NAVIGATION_TRANSITION_ERROR_MARKERS.some((marker) => message.includes(marker.toLowerCase()));
}

export function browserErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
