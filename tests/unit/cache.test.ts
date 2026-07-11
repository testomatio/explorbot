import { describe, expect, it } from 'bun:test';
import { TTLCache } from '../../src/utils/cache.ts';

describe('TTLCache', () => {
  it('stores and returns values by key', () => {
    const cache = new TTLCache<string>();
    cache.set('a', 'x');
    expect(cache.get('a')).toBe('x');
    expect(cache.get('missing')).toBeUndefined();
  });

  it('computes only on miss with getOrCompute', async () => {
    const cache = new TTLCache<string>();
    let calls = 0;
    const compute = async () => {
      calls++;
      return 'value';
    };
    expect(await cache.getOrCompute('k', compute)).toBe('value');
    expect(await cache.getOrCompute('k', compute)).toBe('value');
    expect(calls).toBe(1);
  });

  it('expires entries after the TTL elapses', async () => {
    const cache = new TTLCache<string>(1);
    cache.set('a', 'x');
    await new Promise((r) => setTimeout(r, 20));
    expect(cache.get('a')).toBeUndefined();
  });

  it('never expires when no TTL is given', () => {
    const cache = new TTLCache<string>();
    cache.set('a', 'x');
    expect(cache.get('a')).toBe('x');
  });

  it('deletes and clears entries', () => {
    const cache = new TTLCache<string>();
    cache.set('a', 'x');
    cache.set('b', 'y');
    cache.delete('a');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('y');
    cache.clear();
    expect(cache.get('b')).toBeUndefined();
  });
});
