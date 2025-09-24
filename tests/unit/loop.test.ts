import { describe, it, expect, vi } from 'vitest';
import { loop, StopError } from '../../src/utils/loop.js';

describe('loop', () => {
  it('should succeed on first attempt', async () => {
    const request = vi.fn().mockResolvedValue('success');

    const result = await loop(request, async ({ stop }) => {
      stop();
    });

    expect(result).toBe('success');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('should stop when handler calls stop()', async () => {
    const request = vi.fn().mockResolvedValue('success');
    let callCount = 0;

    const result = await loop(request, async ({ stop, iteration }) => {
      callCount++;
      if (iteration === 2) {
        stop();
      }
    });

    expect(result).toBe('success');
    expect(request).toHaveBeenCalledTimes(2);
    expect(callCount).toBe(2);
  });

  it('should respect maxIterations', async () => {
    const request = vi.fn().mockResolvedValue('success');

    const result = await loop(
      request,
      async () => {
        // Don't stop, let it run max iterations
      },
      2
    );

    expect(result).toBe('success');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('should handle StopError correctly', async () => {
    const request = vi.fn().mockResolvedValue('success');

    const result = await loop(request, async ({ stop }) => {
      stop(); // This throws StopError internally
    });

    expect(result).toBe('success');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('should return undefined result after max iterations', async () => {
    const request = vi.fn().mockResolvedValue(undefined);

    const result = await loop(request, async () => {}, 2);
    expect(result).toBe(undefined);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('should propagate non-StopError exceptions', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Network error'));

    await expect(loop(request, async () => {})).rejects.toThrow(
      'Network error'
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('should work with async request function', async () => {
    const request = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 'async-result';
    };

    const result = await loop(request, async ({ stop }) => {
      stop();
    });

    expect(result).toBe('async-result');
  });
});
