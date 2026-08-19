import { describe, expect, it } from 'bun:test';
import { Navigator } from '../../src/ai/navigator.ts';

describe('Navigator failure reason', () => {
  function createNavigator(reason: string | null) {
    const navigator = Object.create(Navigator.prototype) as Navigator;
    (navigator as any).lastFailureReason = reason;
    return navigator;
  }

  it('reports what the navigator stopped on', () => {
    const navigator = createNavigator('login form requires credentials, none were provided');
    const error = (navigator as any).navigationError('/defects', 'redirected to /users/sign_in and could not resolve');

    expect(error.message).toBe('Navigation to /defects failed: login form requires credentials, none were provided');
  });

  it('falls back when nothing reported a reason', () => {
    const navigator = createNavigator(null);
    const error = (navigator as any).navigationError('/defects', 'redirected to /users/sign_in and could not resolve');

    expect(error.message).toBe('Navigation to /defects failed: redirected to /users/sign_in and could not resolve');
  });

  it('names the page a run has nothing to go on, without its query', () => {
    const navigator = createNavigator(null);
    const reason = (navigator as any).failureReason(null, '', '/users/sign_in?info=You+must+be+logged+in');

    expect(reason).toContain('no knowledge is set for /users/sign_in ');
    expect(reason).toContain('learn "/users/sign_in"');
    expect(reason).not.toContain('info=');
  });

  it('keeps the stop reason, and stays quiet about knowledge it already had', () => {
    const navigator = createNavigator(null);
    const reason = (navigator as any).failureReason('the login form rejected the credentials in knowledge', '<knowledge>…</knowledge>', '/users/sign_in');

    expect(reason).toBe('the login form rejected the credentials in knowledge');
  });

  it('has nothing to add when the run knew the page and stopped for no stated reason', () => {
    const navigator = createNavigator(null);

    expect((navigator as any).failureReason(null, '<knowledge>…</knowledge>', '/users/sign_in')).toBeNull();
  });
});
