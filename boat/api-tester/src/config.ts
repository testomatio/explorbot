import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { type AIConfig, type ApiHookFn, type ApiConfig as BaseApiConfig, ConfigMissingError, EXPLORBOT_CONFIG_PATHS, createModel, envConfigRequested, materializeKnowledge, missingConfigMessage, resolveConfigModels, resolveModel, resolveOutputRoot } from '../../../src/config.ts';
import { type SiteRecord, findGlobalConfig, globalEnvPath, isGlobalConfigPath, registerSite, resolveSiteTarget } from '../../../src/global-config.ts';

export type { AIConfig };

type HookFn = ApiHookFn;

interface ApiConfig extends BaseApiConfig {
  baseEndpoint: string;
  specs?: string[];
}

interface ApibotConfig {
  ai: AIConfig;
  api: ApiConfig;
  dirs?: {
    output: string;
    knowledge?: string;
    styles?: string;
  };
}

export class ApibotConfigParser {
  private static instance: ApibotConfigParser;
  private config: ApibotConfig | null = null;
  private configPath: string | null = null;
  private site: SiteRecord | null = null;

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

  async loadConfig(options?: { config?: string; path?: string; endpoint?: string; baseEndpoint?: string; spec?: string }): Promise<ApibotConfig> {
    if (this.config && !options?.config && !options?.path) return this.config;

    const originalCwd = process.cwd();
    if (options?.path) {
      process.chdir(resolve(options.path));
    }

    ApibotConfigParser.loadEnv(globalEnvPath());
    ApibotConfigParser.loadEnv('.env');
    this.applyRunOptions(options);

    const resolvedPath = options?.config || this.findConfigFile();
    if (!resolvedPath) {
      try {
        return await this.loadEnvConfig();
      } finally {
        if (options?.path && originalCwd !== process.cwd()) process.chdir(originalCwd);
      }
    }

    try {
      const configModule = await this.loadConfigModule(resolvedPath);
      let loadedConfig = configModule.default || configModule;

      if (!loadedConfig) {
        throw new Error('Configuration file is empty or invalid');
      }

      if (loadedConfig.playwright || loadedConfig.web) {
        loadedConfig = {
          ai: loadedConfig.ai,
          api: loadedConfig.api || {},
          dirs: loadedConfig.dirs,
        };
      }

      this.config = this.mergeWithDefaults(loadedConfig);
      this.applyEnvSpec(this.config.api);
      if (options?.baseEndpoint) this.config.api.baseEndpoint = options.baseEndpoint.replace(/\/$/, '');
      await resolveConfigModels(this.config.ai);
      this.configPath = resolvedPath;
      this.site = null;

      if (isGlobalConfigPath(resolvedPath)) {
        this.enterGlobalMode(this.config, options?.endpoint);
      }

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
    return path.join(this.getProjectRoot(), config.dirs?.output || 'output');
  }

  getProjectRoot(): string {
    if (this.site) return this.site.dir;
    const configPath = this.getConfigPath();
    if (!configPath) throw new Error('Config path not found');
    return path.dirname(configPath);
  }

  resolveEndpointPath(endpoint: string): string {
    if (!this.site) return endpoint;

    const resolved = resolveSiteTarget(endpoint, this.site.url);
    if (resolved.baseUrl !== this.site.url) return endpoint;

    const basePath = new URL(this.getConfig().api.baseEndpoint).pathname.replace(/\/$/, '');
    if (!basePath) return resolved.path;
    if (resolved.path === basePath) return '/';
    if (resolved.path.startsWith(`${basePath}/`)) return resolved.path.slice(basePath.length);
    return resolved.path;
  }

  getPlansDir(): string {
    return path.join(this.getOutputDir(), 'plans');
  }

  getRequestsDir(): string {
    return path.join(this.getOutputDir(), 'requests');
  }

  getKnowledgeDir(): string {
    const config = this.getConfig();
    return path.join(this.getProjectRoot(), config.dirs?.knowledge || 'knowledge');
  }

  ensureDirectory(dirPath: string): void {
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }
  }

  private applyRunOptions(options?: { baseEndpoint?: string; spec?: string }): void {
    if (options?.baseEndpoint) process.env.EXPLORBOT_URL = options.baseEndpoint;
    if (options?.spec) process.env.EXPLORBOT_API_SPEC = options.spec;
  }

  private applyEnvSpec(api: ApiConfig): void {
    if (!process.env.EXPLORBOT_API_SPEC) return;
    api.spec = [process.env.EXPLORBOT_API_SPEC];
  }

  private enterGlobalMode(config: ApibotConfig, endpoint?: string): void {
    const site = resolveSiteTarget(endpoint);
    this.site = registerSite(site.baseUrl);

    let baseEndpoint = site.baseUrl;
    const envUrl = process.env.EXPLORBOT_URL;
    if (envUrl && URL.parse(envUrl)?.origin === site.baseUrl) baseEndpoint = envUrl.replace(/\/$/, '');

    config.dirs = { output: 'output', knowledge: 'knowledge' };
    config.api = { ...config.api, baseEndpoint };
    materializeKnowledge(this.site.dir);
  }

  private async loadEnvConfig(): Promise<ApibotConfig> {
    const provider = process.env.EXPLORBOT_AI_PROVIDER;
    const modelSpec = process.env.EXPLORBOT_AI_MODEL;
    if (!provider && !modelSpec) {
      throw new ConfigMissingError(missingConfigMessage('apibot.config.js'));
    }
    if (modelSpec && !provider && !modelSpec.includes('/')) {
      throw new Error('EXPLORBOT_AI_MODEL needs a provider — set EXPLORBOT_AI_PROVIDER, or write it as "provider/model-id"');
    }

    const baseEndpoint = process.env.EXPLORBOT_URL;
    if (!baseEndpoint) {
      throw new Error('No API endpoint to test. Pass --endpoint or set EXPLORBOT_URL to the API base endpoint');
    }

    const outputRoot = resolveOutputRoot();
    materializeKnowledge(outputRoot);

    const api: ApiConfig = { baseEndpoint };
    this.applyEnvSpec(api);

    let model: any;
    if (provider && modelSpec) model = await createModel(provider, modelSpec);
    if (provider && !modelSpec) model = await resolveModel(provider, 'model');
    if (!provider) model = await resolveModel(modelSpec!, 'model');

    this.config = {
      ai: { model },
      api,
      dirs: { output: '.', knowledge: 'knowledge' },
    };
    this.configPath = path.join(outputRoot, 'apibot.config.js');
    this.validateConfig(this.config);

    return this.config;
  }

  private findConfigFile(): string | null {
    const apibotPaths = ['apibot.config.js', 'apibot.config.mjs', 'apibot.config.ts'];
    for (const p of apibotPaths) {
      const fullPath = resolve(process.cwd(), p);
      if (existsSync(fullPath)) return fullPath;
    }

    for (const p of EXPLORBOT_CONFIG_PATHS) {
      const fullPath = resolve(process.cwd(), p);
      if (existsSync(fullPath)) return fullPath;
    }

    if (envConfigRequested()) return null;
    return findGlobalConfig();
  }

  private async loadConfigModule(configPath: string): Promise<any> {
    const ext = configPath.split('.').pop();
    const moduleUrl = pathToFileURL(resolve(configPath)).href;

    if (ext === 'ts') {
      try {
        return await import(moduleUrl);
      } catch {
        const require = (await import('node:module')).createRequire(import.meta.url);
        return require(configPath);
      }
    }

    if (ext === 'js' || ext === 'mjs') {
      return await import(moduleUrl);
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
    return this.deepMerge({ dirs: { output: 'output' }, api: {} }, config);
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
