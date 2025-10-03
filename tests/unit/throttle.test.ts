import { afterEach, describe, expect, it, vi } from 'vitest';
import { __clearThrottleCacheForTests, throttle } from '../../src/utils/throttle.js';

afterEach(() => {
  __clearThrottleCacheForTests();
  vi.restoreAllMocks();
});

describe('throttle', () => {
  it('calls function immediately when not throttled', async () => {
    const spy = vi.fn().mockReturnValue('value');
    const result = await throttle(() => spy());
    expect(result).toBe('value');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('skips call within default interval', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    const spy = vi.fn();
    await throttle(() => spy());
    nowSpy.mockReturnValue(1000);
    await throttle(() => spy());
    expect(spy).toHaveBeenCalledTimes(1);
    nowSpy.mockReturnValue(30000);
    await throttle(() => spy());
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('respects custom interval', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    const spy = vi.fn();
    await throttle(() => spy(), 10);
    nowSpy.mockReturnValue(9000);
    await throttle(() => spy(), 10);
    expect(spy).toHaveBeenCalledTimes(1);
    nowSpy.mockReturnValue(10000);
    await throttle(() => spy(), 10);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throttles functions with identical source code', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    const spy = vi.fn();
    const createCaller = () => () => spy();
    const first = createCaller();
    const second = createCaller();
    await throttle(first);
    await throttle(second);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('awaits async functions', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValue(0);
    const spy = vi.fn().mockResolvedValue('async');
    const result = await throttle(() => spy());
    expect(result).toBe('async');
    expect(spy).toHaveBeenCalledTimes(1);
    nowSpy.mockReturnValue(1000);
    const skipped = await throttle(() => spy());
    expect(skipped).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
