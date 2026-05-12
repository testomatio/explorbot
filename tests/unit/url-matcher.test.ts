import { beforeEach, describe, expect, it } from 'bun:test';
import { ConfigParser } from '../../src/config';
import { normalizeUrl } from '../../src/state-manager';
import { extractStatePath, generalizeSegment, generalizeUrl, hasDynamicUrlSegment, isDynamicSegment, matchesUrl } from '../../src/utils/url-matcher';

describe('url-matcher', () => {
  beforeEach(() => {
    const instance = ConfigParser.getInstance();
    (instance as any).config = { ...(instance as any).config, dynamicPageRegex: undefined };
  });

  describe('isDynamicSegment', () => {
    it('detects numeric segments', () => {
      expect(isDynamicSegment('123')).toBe(true);
      expect(isDynamicSegment('0')).toBe(true);
      expect(isDynamicSegment('999999')).toBe(true);
    });

    it('detects UUIDs', () => {
      expect(isDynamicSegment('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isDynamicSegment('123E4567-E89B-12D3-A456-426614174000')).toBe(true);
    });

    it('detects ULIDs', () => {
      expect(isDynamicSegment('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
    });

    it('detects hex IDs (4+ chars)', () => {
      expect(isDynamicSegment('abcd')).toBe(true);
      expect(isDynamicSegment('70dae98a')).toBe(true);
      expect(isDynamicSegment('cddb14a6')).toBe(true);
    });

    it('detects hex-prefixed slugs (8+ hex before dash)', () => {
      expect(isDynamicSegment('95ef0c94-mobile')).toBe(true);
      expect(isDynamicSegment('cddb14a6-quality-suite-20260408')).toBe(true);
    });

    it('detects short mixed alphanumerics', () => {
      expect(isDynamicSegment('x7f2')).toBe(true);
      expect(isDynamicSegment('abc123')).toBe(true);
      expect(isDynamicSegment('t1')).toBe(true);
    });

    it('rejects plain words', () => {
      expect(isDynamicSegment('login')).toBe(false);
      expect(isDynamicSegment('about')).toBe(false);
      expect(isDynamicSegment('users')).toBe(false);
      expect(isDynamicSegment('dashboard')).toBe(false);
      expect(isDynamicSegment('new-test')).toBe(false);
    });

    it('respects user-provided dynamicPageRegex override', () => {
      const instance = ConfigParser.getInstance();
      (instance as any).config = { ...(instance as any).config, dynamicPageRegex: '^custom-\\d+$' };

      expect(isDynamicSegment('custom-42')).toBe(true);
      expect(isDynamicSegment('custom-X')).toBe(false);
    });
  });

  describe('hasDynamicUrlSegment', () => {
    it('returns true when any segment is dynamic', () => {
      expect(hasDynamicUrlSegment('/users/1')).toBe(true);
      expect(hasDynamicUrlSegment('/items/550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(hasDynamicUrlSegment('/suite/70dae98a/edit')).toBe(true);
    });

    it('returns false for fully static URLs', () => {
      expect(hasDynamicUrlSegment('/about')).toBe(false);
      expect(hasDynamicUrlSegment('/users/profile')).toBe(false);
      expect(hasDynamicUrlSegment('/projects/new')).toBe(false);
    });

    it('ignores empty segments from leading/trailing slashes', () => {
      expect(hasDynamicUrlSegment('/')).toBe(false);
      expect(hasDynamicUrlSegment('/about/')).toBe(false);
    });
  });

  describe('generalizeSegment', () => {
    it('maps numeric to \\d+', () => {
      expect(generalizeSegment('123')).toBe('\\d+');
      expect(generalizeSegment('0')).toBe('\\d+');
    });

    it('maps UUID to [a-f0-9-]+', () => {
      expect(generalizeSegment('550e8400-e29b-41d4-a716-446655440000')).toBe('[a-f0-9-]+');
    });

    it('maps ULID to [0-9A-HJKMNP-TV-Z]+', () => {
      expect(generalizeSegment('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe('[0-9A-HJKMNP-TV-Z]+');
    });

    it('maps plain hex to [a-f0-9]+', () => {
      expect(generalizeSegment('70dae98a')).toBe('[a-f0-9]+');
      expect(generalizeSegment('abcd')).toBe('[a-f0-9]+');
    });

    it('maps everything else to [^/]+', () => {
      expect(generalizeSegment('95ef0c94-mobile')).toBe('[^/]+');
      expect(generalizeSegment('x7f2')).toBe('[^/]+');
    });
  });

  describe('generalizeUrl', () => {
    it('rewrites only dynamic segments', () => {
      expect(generalizeUrl('/users/1')).toBe('/users/\\d+');
      expect(generalizeUrl('/users/1/posts/42')).toBe('/users/\\d+/posts/\\d+');
      expect(generalizeUrl('/items/550e8400-e29b-41d4-a716-446655440000/edit')).toBe('/items/[a-f0-9-]+/edit');
    });

    it('leaves static URLs unchanged', () => {
      expect(generalizeUrl('/about')).toBe('/about');
      expect(generalizeUrl('/users/profile')).toBe('/users/profile');
      expect(generalizeUrl('/projects/new')).toBe('/projects/new');
    });

    it('handles trailing slash', () => {
      expect(generalizeUrl('/users/1/')).toBe('/users/\\d+/');
    });

    it('preserves empty segments from double slashes', () => {
      expect(generalizeUrl('/')).toBe('/');
    });
  });

  describe('matchesUrl', () => {
    it('matches wildcard', () => {
      expect(matchesUrl('*', '/anything')).toBe(true);
    });

    it('matches exact (case-insensitive, trailing slash tolerant)', () => {
      expect(matchesUrl('/About', '/about')).toBe(true);
      expect(matchesUrl('/about/', '/about')).toBe(true);
    });

    it('matches prefix /x/*', () => {
      expect(matchesUrl('/users/*', '/users/123')).toBe(true);
      expect(matchesUrl('/users/*', '/users')).toBe(true);
      expect(matchesUrl('/users/*', '/posts/1')).toBe(false);
    });

    it('matches regex with ^ prefix', () => {
      expect(matchesUrl('^/users/\\d+$', '/users/42')).toBe(true);
      expect(matchesUrl('^/users/\\d+$', '/users/foo')).toBe(false);
    });

    it('matches regex with ~...~ delimiters', () => {
      expect(matchesUrl('~/users/\\d+~', '/users/42')).toBe(true);
      expect(matchesUrl('~/users/\\d+~', '/users/foo')).toBe(false);
    });

    it('falls back to micromatch glob', () => {
      expect(matchesUrl('/{foo,bar}', '/foo')).toBe(true);
      expect(matchesUrl('/{foo,bar}', '/baz')).toBe(false);
    });

    it('ignores query string on path when pattern has no query', () => {
      expect(matchesUrl('/users/sign_in', '/users/sign_in?info=You+must+be+logged+in')).toBe(true);
      expect(matchesUrl('/users/*', '/users/123?tab=profile')).toBe(true);
    });
  });

  describe('extractStatePath', () => {
    it('returns the path when already relative', () => {
      expect(extractStatePath('/dashboard')).toBe('/dashboard');
    });

    it('collapses repeated leading slashes for path-like URLs', () => {
      expect(extractStatePath('///series/page/57/')).toBe('/series/page/57/');
    });

    it('strips host from absolute URL, keeps hash', () => {
      expect(extractStatePath('https://example.com/page#section')).toBe('/page#section');
    });

    it('collapses repeated leading slashes in absolute URL paths', () => {
      expect(extractStatePath('https://example.com///series/page/57/')).toBe('/series/page/57/');
    });

    it('returns original string when URL is unparseable', () => {
      expect(extractStatePath('not a url')).toBe('not a url');
    });
  });

  describe('normalizeUrl', () => {
    it('treats repeated leading slashes as a relative path, not a protocol-relative URL', () => {
      expect(normalizeUrl('///series/page/57/')).toBe('series/page/57');
      expect(normalizeUrl('/series/page/57/')).toBe('series/page/57');
    });
  });
});
