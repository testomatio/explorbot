import { describe, expect, it } from 'bun:test';
import { BrowserRecoveryError, isFatalBrowserError, isNavigationTransitionError } from '../../src/utils/browser-errors.ts';

describe('browser error classification', () => {
  it('treats navigation context loss as a transition error', () => {
    const error = new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');

    expect(isFatalBrowserError(error)).toBe(true);
    expect(isNavigationTransitionError(error)).toBe(true);
  });

  it('treats page closure as fatal but not a navigation transition', () => {
    const error = new Error('Target page, context or browser has been closed');

    expect(isFatalBrowserError(error)).toBe(true);
    expect(isNavigationTransitionError(error)).toBe(false);
  });

  it('keeps browser recovery errors fatal without classifying them as transitions', () => {
    const error = new BrowserRecoveryError('visit', new Error('Protocol error'), true);

    expect(isFatalBrowserError(error)).toBe(true);
    expect(isNavigationTransitionError(error)).toBe(false);
  });
});
