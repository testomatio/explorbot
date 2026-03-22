import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { AIConfig } from '../../../src/config.ts';

export type { AIConfig };

type HookFn = (ctx: { headers: Record<string, string>; baseEndpoint: string }) => Promise<Record<string, string> | void> | Record<string, string> | void;

interface ApiConfig {
  baseEndpoint: string;
  spec?: string[];
  specs?: string[];
  headers?: Record<string, string>;
  bootstrap?: HookFn;
  teardown?: HookFn;
}

interface ApibotConfig {
  ai: AIConfig;
  api: ApiConfig;
  dirs?: {
    output: string;
    knowledge?: string;
  };
}

export class ApibotConfigParser {
  private static instance: ApibotConfigParser;
  private config: ApibotConfig | null = null;
  private configPath: string | null = null;

  private constructor() {}

  static getInstance(): ApibotConfigParser {
    if (!ApibotConfigParser.instance) {
      ApibotConfigParser.instance = new ApibotConfigParser();
    }
    return ApibotConfigParser.instance;
  }

  static loadEnv(filePath: string): void {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) return;
    Object.assign(process.env, parseEnv(readFileSync(resolved, 'utf8')));
  }

  async loadConfig(options?: { config?: string; path?: string }): Promise<ApibotConfig> {
    if (this.config && !options?.config && !options?.path) return this.config;

    const originalCwd = process.cwd();
    if (options?.path) {
      process.chdir(resolve(options.path));
    }

    ApibotConfigParser.loadEnv('.env');

    const resolvedPath = options?.config || this.findConfigFile();
    if (!resolvedPath) {
      if (options?.path) process.chdir(originalCwd);
      throw new Error('No configuration file found. Create apibot.config.js or apibot.config.ts');
    }

    try {
      const configModule = await this.loadConfigModule(resolvedPath);
      const loadedConfig = configModule.default || configModule;

      if (!loadedConfig) {
        throw new Error('Configuration file is empty or invalid');
      }

      this.config = this.mergeWithDefaults(loadedConfig);
      this.configPath = resolvedPath;
      this.validateConfig(this.config);

      return this.config;
    } finally {
      if (options?.path && originalCwd !== process.cwd()) {
        process.chdir(originalCwd);
      }
    }
  }

  getConfig(): ApibotConfig {
    if (!this.config) throw new Error('Configuration not loaded. Call loadConfig() first.');
    return this.config;
  }

  getConfigPath(): string | null {
    return this.configPath;
  }

  getOutputDir(): string {
    const config = this.getConfig();
    const configPath = this.getConfigPath();
    if (!configPath) throw new Error('Config path not found');
    return path.join(path.dirname(configPath), config.dirs?.output || 'output');
  }

  getPlansDir(): string {
    return path.join(this.getOutputDir(), 'plans');
  }

  getRequestsDir(): string {
    return path.join(this.getOutputDir(), 'requests');
  }

  getKnowledgeDir(): string {
    const config = this.getConfig();
    const configPath = this.getConfigPath();
    if (!configPath) throw new Error('Config path not found');
    return path.join(path.dirname(configPath), config.dirs?.knowledge || 'knowledge');
  }

  ensureDirectory(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  private findConfigFile(): string | null {
    const possiblePaths = ['apibot.config.js', 'apibot.config.mjs', 'apibot.config.ts'];

    for (const p of possiblePaths) {
      const fullPath = resolve(process.cwd(), p);
      if (existsSync(fullPath)) return fullPath;
    }

    return null;
  }

  private async loadConfigModule(configPath: string): Promise<any> {
    const ext = configPath.split('.').pop();

    if (ext === 'ts') {
      try {
        return await import(configPath);
      } catch {
        const require = (await import('node:module')).createRequire(import.meta.url);
        return require(configPath);
      }
    }

    if (ext === 'js' || ext === 'mjs') {
      return await import(configPath);
    }

    const content = readFileSync(configPath, 'utf8');
    return JSON.parse(content);
  }

  private validateConfig(config: ApibotConfig): void {
    if (!config.ai?.model) {
      throw new Error('Missing required configuration: ai.model');
    }
    if (!config.api?.baseEndpoint) {
      throw new Error('Missing required configuration: api.baseEndpoint');
    }
    if (config.api.specs && !config.api.spec) {
      config.api.spec = config.api.specs;
    }
  }

  private mergeWithDefaults(config: Partial<ApibotConfig>): ApibotConfig {
    return this.deepMerge({ dirs: { output: 'output' } }, config);
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key].constructor === Object) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}

export type { ApibotConfig, ApiConfig, HookFn };
