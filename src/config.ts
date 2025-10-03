import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path, { dirname, join, resolve } from 'node:path';
import { log } from './utils/logger.js';

interface PlaywrightConfig {
  browser: 'chromium' | 'firefox' | 'webkit';
  url: string;
  show?: boolean;
  windowSize?: string;
  slowMo?: number;
  chromium?: {
    args?: string[];
  };
  firefox?: {
    args?: string[];
  };
  webkit?: {
    args?: string[];
  };
  timeout?: number;
  waitForNavigation?: 'load' | 'domcontentloaded' | 'networkidle';
  waitForTimeout?: number;
  ignoreHTTPSErrors?: boolean;
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
}

interface AIConfig {
  provider: any;
  model: string;
  apiKey?: string;
  config?: Record<string, any>;
  tools?: {
    enabled: boolean;
    maxConcurrency: number;
    timeout: number;
  };
  vision?: boolean;
  maxAttempts?: number;
  retryDelay?: number;
}

interface HtmlConfig {
  minimal?: {
    include?: string[];
    exclude?: string[];
  };
  combined?: {
    include?: string[];
    exclude?: string[];
  };
  text?: {
    include?: string[];
    exclude?: string[];
  };
}

interface ActionConfig {
  delay?: number;
  retries?: number;
}

interface ExplorbotConfig {
  playwright: PlaywrightConfig;
  ai: AIConfig;
  html?: HtmlConfig;
  action?: ActionConfig;
  dirs?: {
    knowledge: string;
    experience: string;
    output: string;
  };
}

const config: ExplorbotConfig = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
  },

  ai: {
    provider: null,
    model: 'gpt-4o',
  },
};

export type { ExplorbotConfig, PlaywrightConfig, AIConfig, HtmlConfig, ActionConfig };

export class ConfigParser {
  private static instance: ConfigParser;
  private config: ExplorbotConfig | null = null;
  private configPath: string | null = null;

  private constructor() {}

  public static getInstance(): ConfigParser {
    if (!ConfigParser.instance) {
      ConfigParser.instance = new ConfigParser();
    }
    return ConfigParser.instance;
  }

  public async loadConfig(options?: {
    config?: string;
    path?: string;
  }): Promise<ExplorbotConfig> {
    if (this.config && !options?.config && !options?.path) {
      return this.config;
    }

    // Store the initial working directory for reference
    if (!process.env.INITIAL_CWD) {
      process.env.INITIAL_CWD = process.cwd();
    }

    // If path is provided, change to that directory and load .env
    const originalCwd = process.cwd();
    if (options?.path) {
      const resolvedWorkingPath = resolve(options.path);
      process.chdir(resolvedWorkingPath);
    }

    try {
      const resolvedPath = options?.config || this.findConfigFile();

      if (!resolvedPath) {
        throw new Error('No configuration file found. Please create explorbot.config.js or explorbot.config.ts');
      }

      const configModule = await this.loadConfigModule(resolvedPath);
      const loadedConfig = configModule.default || configModule;

      if (!loadedConfig) {
        throw new Error('Configuration file is empty or invalid');
      }

      this.config = loadedConfig as ExplorbotConfig;
      this.configPath = resolvedPath;

      log(`Configuration loaded from: ${resolvedPath}`);

      // Restore original directory after successful config load
      if (options?.path && originalCwd !== process.cwd()) {
        process.chdir(originalCwd);
      }

      return this.config;
    } catch (error) {
      // Restore original directory on error
      if (options?.path && originalCwd !== process.cwd()) {
        process.chdir(originalCwd);
      }
      throw new Error(`Failed to load configuration: ${error}`);
    }
  }

  public getConfig(): ExplorbotConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }

  public getConfigPath(): string | null {
    return this.configPath;
  }

  public getOutputDir(): string {
    const config = this.getConfig();
    const configPath = this.getConfigPath();
    if (!configPath) throw new Error('Config path not found');
    return path.join(path.dirname(configPath), config.dirs?.output || 'output');
  }

  // For testing purposes only
  public static resetForTesting(): void {
    if (ConfigParser.instance) {
      ConfigParser.instance.config = null;
      ConfigParser.instance.configPath = null;
    }
  }

  // For testing purposes only - sets up minimal default config
  public static setupTestConfig(): void {
    const instance = ConfigParser.getInstance();
    // Create unique directory names for this test run to ensure isolation
    const testId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const testBaseDir = join(process.cwd(), 'test-dirs', testId);

    instance.config = {
      playwright: {
        url: 'https://example.com',
        browser: 'chromium',
        show: false,
      },
      ai: {
        provider: () => ({ model: 'test' }),
        model: 'test-model',
        config: {},
        vision: false,
      },
      dirs: {
        knowledge: join(testBaseDir, 'knowledge'),
        experience: join(testBaseDir, 'experience'),
        output: join(testBaseDir, 'output'),
      },
    };
    instance.configPath = join(testBaseDir, 'test-config');
  }

  // For testing purposes only - get test directories for cleanup
  public static getTestDirectories(): string[] {
    const instance = ConfigParser.getInstance();
    if (!instance.config?.dirs) return [];

    return [instance.config.dirs.knowledge, instance.config.dirs.experience, instance.config.dirs.output, dirname(instance.configPath || '')].filter((dir) => dir?.includes('test-dirs'));
  }

  // For testing purposes only - clean up all test directories
  public static cleanupAllTestDirectories(): void {
    try {
      const testDirsBase = join(process.cwd(), 'test-dirs');
      if (existsSync(testDirsBase)) {
        rmSync(testDirsBase, { recursive: true, force: true });
      }
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  private findConfigFile(): string | null {
    const possiblePaths = [
      'explorbot.config.js',
      'explorbot.config.mjs',
      'explorbot.config.ts',
      'config/explorbot.config.js',
      'config/explorbot.config.mjs',
      'config/explorbot.config.ts',
      'src/config/explorbot.config.js',
      'src/config/explorbot.config.mjs',
      'src/config/explorbot.config.ts',
    ];

    for (const path of possiblePaths) {
      const fullPath = resolve(process.cwd(), path);
      if (existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }

  private async loadConfigModule(configPath: string): Promise<any> {
    const ext = configPath.split('.').pop();

    if (ext === 'ts') {
      try {
        const module = await import(configPath);
        return module;
      } catch (error) {
        const require = (await import('node:module')).createRequire(import.meta.url);
        return require(configPath);
      }
    } else if (ext === 'js' || ext === 'mjs') {
      const module = await import(configPath);
      return module;
    } else {
      const content = readFileSync(configPath, 'utf8');
      return JSON.parse(content);
    }
  }

  public validateConfig(config: ExplorbotConfig): void {
    const requiredFields = ['playwright.url', 'ai.provider', 'ai.model'];

    for (const field of requiredFields) {
      const value = this.getNestedValue(config, field);
      if (value === undefined || value === null) {
        throw new Error(`Missing required configuration field: ${field}`);
      }
    }

    try {
      new URL(config.playwright.url);
    } catch {
      throw new Error(`Invalid URL in configuration: ${config.playwright.url}`);
    }
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  public mergeWithDefaults(config: Partial<ExplorbotConfig>): ExplorbotConfig {
    const defaults = {
      playwright: {
        browser: 'chromium',
        show: false, // we need headless
      },
      action: {
        delay: 1000,
        retries: 3,
      },
      dirs: {
        knowledge: 'knowledge',
        experience: 'experience',
        output: 'output',
      },
    };

    return this.deepMerge(defaults, config);
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  public ensureDirectory(path: string): void {
    if (!existsSync(path)) {
      mkdirSync(path, { recursive: true });
    }
  }
}
