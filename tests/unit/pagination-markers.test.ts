import 'parse5';
import { describe, expect, it } from 'bun:test';
import { detectPaginationMarkers } from '../../src/utils/pagination.ts';

describe('pagination markers', () => {
  it('reads rel=next and rel=prev as controls', () => {
    const html = '<nav><a href="?p=1" rel="prev">Back</a><a href="?p=3" rel="next">On</a></nav>';

    expect(detectPaginationMarkers(html)).toBe('controls');
  });

  it('reads role=feed as infinite', () => {
    const html = '<div role="feed"><article>One</article></div>';

    expect(detectPaginationMarkers(html)).toBe('infinite');
  });

  it('reads aria-setsize=-1 as infinite', () => {
    const html = '<ul><li aria-setsize="-1" aria-posinset="1">One</li></ul>';

    expect(detectPaginationMarkers(html)).toBe('infinite');
  });

  it('ignores aria-current in every value', () => {
    const html = '<nav><a href="/a" aria-current="page">A</a><a href="/b" aria-current="true">B</a></nav>';

    expect(detectPaginationMarkers(html)).toBeNull();
  });

  it('prefers controls when both kinds of marker are present', () => {
    const html = '<div role="feed"></div><a href="?p=2" rel="next">On</a>';

    expect(detectPaginationMarkers(html)).toBe('controls');
  });

  it('returns null for a plain list', () => {
    const html = '<ul><li>One</li><li>Two</li></ul>';

    expect(detectPaginationMarkers(html)).toBeNull();
  });

  it('returns null for empty html', () => {
    expect(detectPaginationMarkers('')).toBeNull();
  });
});
