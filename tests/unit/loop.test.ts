import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StopError, loop } from '../../src/utils/loop.js';
import { ConfigParser } from '../../src/config.js';

describe('loop', () => {
  beforeEach(() => {
    ConfigParser.setupTestConfig();
  });

  it('should succeed on first attempt', async () => {
    const handler = vi.fn().mockImplementation(async ({ stop }) => {
      const value = 'success';
      stop();
      return value;
    });

    const result = await loop(handler);

    expect(result).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should stop when handler calls stop()', async () => {
    let callCount = 0;

    const result = await loop(async ({ stop, iteration }) => {
      callCount++;
      if (iteration === 2) {
        stop();
      }
      return 'success';
    });

    expect(result).toBe('success');
    expect(callCount).toBe(2);
  });

  it('should respect maxAttempts', async () => {
    const handler = vi.fn().mockImplementation(async () => 'success');

    const result = await loop(handler, { maxAttempts: 2 });

    expect(result).toBe('success');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should handle StopError correctly', async () => {
    const handler = vi.fn().mockImplementation(async ({ stop }) => {
      stop();
      return 'success';
    });

    const result = await loop(handler);

    expect(result).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should return undefined result after max attempts', async () => {
    const handler = vi.fn().mockImplementation(async () => undefined);

    const result = await loop(handler, { maxAttempts: 2 });

    expect(result).toBe(undefined);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should propagate non-StopError exceptions', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(loop(handler)).rejects.toThrow('Network error');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should work with async handler function', async () => {
    const handler = async ({ stop }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      stop();
      return 'async-result';
    };

    const result = await loop(handler);

    expect(result).toBeUndefined();
  });

  it('should handle catch handler and continue when no error thrown', async () => {
    const catchHandler = vi.fn();
    let iteration = 0;

    const result = await loop(
      async ({ iteration: iter }) => {
        iteration = iter;
        if (iter === 1) {
          throw new Error('Expected error');
        }
        return 'success';
      },
      {
        maxAttempts: 2,
        catch: async ({ error }) => {
          catchHandler(error);
        },
      }
    );

    expect(result).toBe('success');
    expect(iteration).toBe(2);
    expect(catchHandler).toHaveBeenCalledWith(expect.any(Error));
  });

  it('should stop when catch handler calls stop()', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Expected error'));

    const result = await loop(handler, {
      catch: async ({ stop }) => {
        stop();
      },
    });

    expect(result).toBe(undefined);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should propagate errors from catch handler', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Expected error'));

    await expect(
      loop(handler, {
        catch: async () => {
          throw new Error('Catch handler error');
        },
      })
    ).rejects.toThrow('Catch handler error');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should work with default maxAttempts when no options provided', async () => {
    const handler = vi.fn().mockImplementation(async () => 'success');

    const result = await loop(handler);

    expect(result).toBe('success');
    expect(handler).toHaveBeenCalledTimes(5);
  });
});
