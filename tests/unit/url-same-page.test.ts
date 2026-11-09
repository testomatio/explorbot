import { describe, expect, it } from 'bun:test';
import { isSamePageIgnoringQuery } from '../../src/utils/url-matcher.ts';

describe('isSamePageIgnoringQuery', () => {
  it('treats query-only changes as the same page', () => {
    expect(isSamePageIgnoringQuery('/issues', '/issues?q=login&status=open')).toBe(true);
    expect(isSamePageIgnoringQuery('http://localhost:3000/issues?new=1', 'http://localhost:3000/issues')).toBe(true);
  });

  it('treats a different path as a different page', () => {
    expect(isSamePageIgnoringQuery('/issues', '/issues/6')).toBe(false);
  });

  it('treats a different hash route as a different page', () => {
    expect(isSamePageIgnoringQuery('/#/issues', '/#/settings')).toBe(false);
  });
});
