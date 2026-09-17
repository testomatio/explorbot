import { describe, expect, it } from 'bun:test';
import { Navigator } from '../../src/ai/navigator.ts';

describe('Navigator origin guard', () => {
  function createNavigator(baseUrl = 'http://192.168.1.162:3000') {
    const navigator = Object.create(Navigator.prototype) as Navigator & { config: any };
    navigator.config = {
      playwright: {
        url: baseUrl,
      },
    };
    return navigator;
  }

  it('rejects external origins for relative expected URLs', () => {
    const navigator = createNavigator();
    const stateManager = {
      getCurrentState: () => ({
        url: '/',
        fullUrl: 'https://your-domain.com/',
      }),
    };

    expect((navigator as any).isOnExpectedPage('/', stateManager)).toBe(false);
  });

  it('accepts the host the configured origin redirects to', () => {
    const navigator = createNavigator('https://example.com');
    const stateManager = {
      getCurrentState: () => ({
        url: '/',
        fullUrl: 'https://www.example.com/',
      }),
    };

    expect((navigator as any).isOnExpectedPage('/', stateManager)).toBe(true);
  });

  it('accepts the configured origin for relative expected URLs', () => {
    const navigator = createNavigator();
    const stateManager = {
      getCurrentState: () => ({
        url: '/',
        fullUrl: 'http://192.168.1.162:3000/',
      }),
    };

    expect((navigator as any).isOnExpectedPage('/', stateManager)).toBe(true);
  });
});
