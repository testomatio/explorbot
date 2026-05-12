import { beforeEach, describe, expect, it } from 'bun:test';
import { ConfigParser } from '../../src/config.ts';

describe('ConfigParser runtime baseUrl overrides', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
  });

  it('reloads config when runtime baseUrl override changes', async () => {
    const parser = ConfigParser.getInstance();
    const originalLoadConfigModule = (parser as any).loadConfigModule;
    const originalFindConfigFile = (parser as any).findConfigFile;

    (parser as any).findConfigFile = () => '/virtual/explorbot.config.ts';
    (parser as any).loadConfigModule = async () => ({
      default: {
        playwright: {
          url: 'https://default.example.com',
          browser: 'chromium',
        },
        ai: {
          model: { modelId: 'test-model', provider: 'test' },
          config: {},
        },
      },
    });

    try {
      const first = await parser.loadConfig({ baseUrl: 'https://one.example.com' });
      const second = await parser.loadConfig({ baseUrl: 'https://two.example.com' });
      const fallback = await parser.loadConfig();

      expect(first.playwright.url).toBe('https://one.example.com');
      expect(second.playwright.url).toBe('https://two.example.com');
      expect(fallback.playwright.url).toBe('https://default.example.com');
    } finally {
      (parser as any).loadConfigModule = originalLoadConfigModule;
      (parser as any).findConfigFile = originalFindConfigFile;
      ConfigParser.resetForTesting();
    }
  });
});
