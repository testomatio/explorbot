import { describe, expect, test } from 'bun:test';
import { UrlFilter } from '../../src/utils/url-filter.ts';

describe('UrlFilter', () => {
  test('allows everything when empty', () => {
    const filter = new UrlFilter();
    expect(filter.allows('/anything')).toBe(true);
    expect(filter.admit('https://example.com/x')).toBe(true);
  });

  test('matches includes and excludes by path', () => {
    const filter = new UrlFilter('filter:/admin/*;filter:/settings;exclude:/admin/logs/*');
    expect(filter.allows('https://example.com/admin/users?page=2')).toBe(true);
    expect(filter.allows('/settings')).toBe(true);
    expect(filter.allows('/admin/logs/today')).toBe(false);
    expect(filter.allows('/blog')).toBe(false);
  });

  test('admits distinct pages up to the limit', () => {
    const filter = new UrlFilter('limit=2');
    expect(filter.admit('/a')).toBe(true);
    expect(filter.admit('https://example.com/a')).toBe(true);
    expect(filter.admit('/b')).toBe(true);
    expect(filter.admit('/c')).toBe(false);
    expect(filter.admit('/a')).toBe(true);
  });

  test('keeps sort for sitemaps', () => {
    expect(new UrlFilter('sort:lastmod').sort).toBe('lastmod');
  });
});
