import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { ConfigParser } from '../../src/config';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

describe('ConfigParser', () => {
  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = ConfigParser.getInstance();
      const instance2 = ConfigParser.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('validateConfig', () => {
    it('should validate required fields', () => {
      const parser = ConfigParser.getInstance();
      const validConfig = {
        playwright: {
          url: 'https://example.com',
          browser: 'chromium' as const,
          show: false,
        },
        ai: {
          provider: 'groq',
          model: 'mixtral-8x7b-32768',
        },
        dirs: {
          knowledge: 'knowledge',
          experience: 'experience',
          output: 'output',
        },
      };

      expect(() => parser.validateConfig(validConfig)).not.toThrow();
    });

    it('should throw for missing playwright.url', () => {
      const parser = ConfigParser.getInstance();
      const config = {
        playwright: {
          browser: 'chromium' as const,
          show: false,
        },
        ai: {
          provider: 'groq',
          model: 'mixtral-8x7b-32768',
        },
        dirs: {
          knowledge: 'knowledge',
          experience: 'experience',
          output: 'output',
        },
      };

      expect(() => parser.validateConfig(config)).toThrow(
        'Missing required configuration field: playwright.url'
      );
    });

    it('should throw for missing ai.provider', () => {
      const parser = ConfigParser.getInstance();
      const config = {
        playwright: {
          url: 'https://example.com',
          browser: 'chromium' as const,
          show: false,
        },
        ai: {
          model: 'mixtral-8x7b-32768',
        },
        dirs: {
          knowledge: 'knowledge',
          experience: 'experience',
          output: 'output',
        },
      };

      expect(() => parser.validateConfig(config)).toThrow(
        'Missing required configuration field: ai.provider'
      );
    });

    it('should throw for invalid URL', () => {
      const parser = ConfigParser.getInstance();
      const config = {
        playwright: {
          url: 'invalid-url',
          browser: 'chromium' as const,
          show: false,
        },
        ai: {
          provider: 'groq',
          model: 'mixtral-8x7b-32768',
        },
        dirs: {
          knowledge: 'knowledge',
          experience: 'experience',
          output: 'output',
        },
      };

      expect(() => parser.validateConfig(config)).toThrow(
        'Invalid URL in configuration: invalid-url'
      );
    });
  });

  describe('mergeWithDefaults', () => {
    it('should merge partial config with defaults', () => {
      const parser = ConfigParser.getInstance();
      const partialConfig = {
        playwright: {
          url: 'https://example.com',
          browser: 'chromium' as const,
          show: false,
        },
        ai: {
          provider: 'groq',
          model: 'mixtral-8x7b-32768',
        },
      };

      const merged = parser.mergeWithDefaults(partialConfig);

      expect(merged.playwright.url).toBe('https://example.com');
      expect(merged.playwright.browser).toBe('chromium');
      expect(merged.playwright.show).toBe(false);
      expect(merged.dirs?.knowledge).toBe('knowledge');
      expect(merged.dirs?.experience).toBe('experience');
      expect(merged.dirs?.output).toBe('output');
    });

    it('should preserve provided values over defaults', () => {
      const parser = ConfigParser.getInstance();
      const partialConfig = {
        playwright: {
          url: 'https://example.com',
          browser: 'firefox' as const,
          show: true,
        },
        ai: {
          provider: 'groq',
          model: 'mixtral-8x7b-32768',
        },
        dirs: {
          knowledge: 'custom-knowledge',
        },
      };

      const merged = parser.mergeWithDefaults(partialConfig);

      expect(merged.playwright.browser).toBe('firefox');
      expect(merged.playwright.show).toBe(true);
      expect(merged.dirs?.knowledge).toBe('custom-knowledge');
      expect(merged.dirs?.experience).toBe('experience');
    });
  });

  describe('getNestedValue', () => {
    it('should get nested values', () => {
      const parser = ConfigParser.getInstance();
      const obj = {
        a: { b: { c: 42 } },
      };

      expect((parser as any).getNestedValue(obj, 'a.b.c')).toBe(42);
      expect((parser as any).getNestedValue(obj, 'a.b.d')).toBeUndefined();
    });
  });

  describe('deepMerge', () => {
    it('should deeply merge nested objects', () => {
      const parser = ConfigParser.getInstance();
      const target = {
        a: { b: 1, c: 2 },
        d: 3,
      };
      const source = {
        a: { b: 10, e: 5 },
        f: 6,
      };

      const result = (parser as any).deepMerge(target, source);

      expect(result.a.b).toBe(10);
      expect(result.a.c).toBe(2);
      expect(result.a.e).toBe(5);
      expect(result.d).toBe(3);
      expect(result.f).toBe(6);
    });
  });

  describe('loadConfig with path option', () => {
    const testDir = join(process.cwd(), 'test-config-dir');
    const originalCwd = process.cwd();
    const originalEnv: Record<string, string | undefined> = {};

    beforeEach(() => {
      // Store original env vars that we might modify
      originalEnv.TEST_VAR = process.env.TEST_VAR;
      originalEnv.ANOTHER_VAR = process.env.ANOTHER_VAR;
      originalEnv.CUSTOM_VAR = process.env.CUSTOM_VAR;

      // Clean up any existing test directory
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      mkdirSync(testDir, { recursive: true });

      // Reset singleton instance to ensure clean state
      ConfigParser.resetForTesting();
    });

    afterEach(() => {
      // Restore original working directory
      process.chdir(originalCwd);

      // Restore original env vars
      if (originalEnv.TEST_VAR !== undefined) {
        process.env.TEST_VAR = originalEnv.TEST_VAR;
      } else {
        delete process.env.TEST_VAR;
      }
      if (originalEnv.ANOTHER_VAR !== undefined) {
        process.env.ANOTHER_VAR = originalEnv.ANOTHER_VAR;
      } else {
        delete process.env.ANOTHER_VAR;
      }
      if (originalEnv.CUSTOM_VAR !== undefined) {
        process.env.CUSTOM_VAR = originalEnv.CUSTOM_VAR;
      } else {
        delete process.env.CUSTOM_VAR;
      }

      // Clean up test directory
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }

      // Reset singleton instance properly
      ConfigParser.resetForTesting();
    });

    it('should change to specified path and load config from there', async () => {
      // Create a config file in the test directory
      const configContent = `
export default {
  playwright: {
    url: 'https://test1.example.com',
    browser: 'chromium',
    show: false,
  },
  ai: {
    provider: 'groq',
    model: 'test1-model',
  },
};`;
      writeFileSync(join(testDir, 'explorbot.config.js'), configContent);

      const parser = ConfigParser.getInstance();
      const config = await parser.loadConfig({ path: testDir });

      expect(config.playwright.url).toBe('https://test1.example.com');
      expect(config.ai.model).toBe('test1-model');
      expect(process.cwd()).toBe(originalCwd); // ConfigParser should restore original directory
    });

    it('should load config from specified path', async () => {
      // Set test env vars manually since ConfigParser doesn't load .env files
      process.env.TEST_VAR = 'test_value';
      process.env.ANOTHER_VAR = 'another_value';

      // Use unique filename to avoid module caching
      const configFileName = `test-config-${Date.now()}.js`;
      // Create config file that uses env vars
      const configContent = `
export default {
  playwright: {
    url: process.env.TEST_VAR || 'https://default.com',
    browser: 'chromium',
    show: false,
  },
  ai: {
    provider: 'groq',
    model: process.env.ANOTHER_VAR || 'default-model',
  },
};`;
      writeFileSync(join(testDir, configFileName), configContent);

      const parser = ConfigParser.getInstance();
      const config = await parser.loadConfig({
        path: testDir,
        config: join(testDir, configFileName),
      });

      expect(config.playwright.url).toBe('test_value');
      expect(config.ai.model).toBe('another_value');
    });

    it('should work without .env file if it does not exist', async () => {
      // Use unique filename to avoid module caching
      const configFileName = `test-config-noenv-${Date.now()}.js`;
      // Create config file without .env
      const configContent = `
export default {
  playwright: {
    url: 'https://noenv.example.com',
    browser: 'chromium',
    show: false,
  },
  ai: {
    provider: 'groq',
    model: 'noenv-model',
  },
};`;
      writeFileSync(join(testDir, configFileName), configContent);

      const parser = ConfigParser.getInstance();
      const config = await parser.loadConfig({
        path: testDir,
        config: join(testDir, configFileName),
      });

      expect(config.playwright.url).toBe('https://noenv.example.com');
      expect(config.ai.model).toBe('noenv-model');
    });

    it('should restore original directory on config load error', async () => {
      // Use unique filename to avoid module caching
      const configFileName = `test-config-invalid-${Date.now()}.js`;
      // Create invalid config file
      const configContent = 'invalid javascript content {{{{';
      writeFileSync(join(testDir, configFileName), configContent);

      const parser = ConfigParser.getInstance();

      await expect(
        parser.loadConfig({
          path: testDir,
          config: join(testDir, configFileName),
        })
      ).rejects.toThrow();
      expect(process.cwd()).toBe(originalCwd);
    });

    it('should handle custom config path with working path', async () => {
      // Set test env var manually
      process.env.CUSTOM_VAR = 'custom_value';

      // Create custom config file
      const customConfigPath = join(testDir, 'custom.config.js');
      const configContent = `
export default {
  playwright: {
    url: 'https://custom.example.com',
    browser: 'chromium',
    show: false,
  },
  ai: {
    provider: 'groq',
    model: 'custom-model',
  },
};`;
      writeFileSync(customConfigPath, configContent);

      const parser = ConfigParser.getInstance();
      const config = await parser.loadConfig({
        path: testDir,
        config: customConfigPath,
      });

      expect(config.playwright.url).toBe('https://custom.example.com');
      expect(config.ai.model).toBe('custom-model');
      expect(process.env.CUSTOM_VAR).toBe('custom_value');
    });

    it('should not change directory or reload config if no options provided and config already loaded', async () => {
      // Use unique filename to avoid module caching
      const configFileName = `test-config-cache-${Date.now()}.js`;
      // Create config file first
      const configContent = `
export default {
  playwright: {
    url: 'https://first.example.com',
    browser: 'chromium',
    show: false,
  },
  ai: {
    provider: 'groq',
    model: 'first-model',
  },
};`;
      writeFileSync(join(testDir, configFileName), configContent);

      const parser = ConfigParser.getInstance();

      // Load config first time
      const config1 = await parser.loadConfig({
        path: testDir,
        config: join(testDir, configFileName),
      });
      expect(config1.ai.model).toBe('first-model');

      // Change back to original directory
      process.chdir(originalCwd);

      // Call loadConfig again without options - should return cached config
      const config2 = await parser.loadConfig();
      expect(config2.ai.model).toBe('first-model');
      expect(process.cwd()).toBe(originalCwd); // Should not have changed directory
    });
  });
});
