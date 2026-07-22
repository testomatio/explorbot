import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { basename, dirname, join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import matter from 'gray-matter';
import { log } from './utils/logger.js';

export const PROVIDERS: Record<string, () => Promise<(modelId: string) => any>> = {
  openai: async () => (await import('@ai-sdk/openai')).createOpenAI(),
  anthropic: async () => (await import('@ai-sdk/anthropic')).createAnthropic(),
  google: async () => (await import('@ai-sdk/google')).createGoogleGenerativeAI(),
  groq: async () => (await import('@ai-sdk/groq')).createGroq(),
  mistral: async () => (await import('@ai-sdk/mistral')).createMistral(),
  openrouter: async () => (await import('@openrouter/ai-sdk-provider')).createOpenRouter(),
  sambanova: async () => (await import('sambanova-ai-provider')).createSambaNova(),
};

let cachedOutputRoot: string | null = null;

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
  waitForAction?: number;
  waitForNavigation?: 'load' | 'domcontentloaded' | 'networkidle';
  waitForTimeout?: number;
  spinnerSelectors?: string[];
  ignoreHTTPSErrors?: boolean;
  userAgent?: string;
  viewport?: {
    width: number;
    height: number;
  };
  args?: string[];
}

type PlaywrightHookFn = (ctx: { page: any; url: string }) => Promise<void> | void;
type CodeceptJSHookFn = (ctx: { I: any; url: string }) => Promise<void> | void;

interface PlaywrightHook {
  type: 'playwright';
  hook: PlaywrightHookFn;
}

interface CodeceptJSHook {
  type: 'codeceptjs';
  hook: CodeceptJSHookFn;
}

type Hook = PlaywrightHook | CodeceptJSHook;
type HookPatternMap = Record<string, Hook>;
type HookConfig = Hook | HookPatternMap;

interface HooksConfig {
  beforeHook?: HookConfig;
  afterHook?: HookConfig;
}

interface AgentConfig extends HooksConfig {
  model?: any;
  enabled?: boolean;
  systemPrompt?: string;
  rules?: RuleEntry[];
  providerOptions?: Record<string, any>;
  reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

interface ResearcherAgentConfig extends AgentConfig {
  excludeSelectors?: string[];
  includeSelectors?: string[];
  stopWords?: string[];
  maxElementsToExplore?: number;
  maxExpandableClicks?: number;
  retries?: number;
  sections?: string[];
  focusSections?: string[];
  errorPageTimeout?: number;
}

interface TesterAgentConfig extends AgentConfig {
  progressCheckInterval?: number;
}

interface PilotAgentConfig extends AgentConfig {
  stepsToReview?: number;
}

interface NavigatorAgentConfig extends AgentConfig {
  addHtmlOnTry?: number;
  maxAttempts?: number;
  verifyAttempts?: number;
  verifyTimeout?: number;
}

type HealFn = (ctx: { I: any }) => Promise<void> | void;

interface HealRecipe {
  priority?: number;
  steps?: string[];
  fn: (context: { step: any; error: Error; prevSteps?: any[] }) => HealFn | Promise<HealFn | null> | null;
}

interface RerunnerAgentConfig extends AgentConfig {
  healLimit?: number;
  ariaSnapshotLimit?: number;
  retryFailedStep?: Record<string, any>;
  screenshotOnFail?: Record<string, any>;
  recipes?: Record<string, HealRecipe>;
}

interface PlannerAgentConfig extends AgentConfig {
  styles?: string[];
  stylesDir?: string;
}

interface ScreencastConfig {
  size?: { width: number; height: number };
  quality?: number;
}

interface HistorianAgentConfig extends AgentConfig {
  framework?: 'codeceptjs' | 'playwright';
  screencast?: boolean | ScreencastConfig;
}

interface AgentsConfig {
  tester?: TesterAgentConfig;
  navigator?: NavigatorAgentConfig;
  researcher?: ResearcherAgentConfig;
  planner?: PlannerAgentConfig;
  pilot?: PilotAgentConfig;
  driller?: AgentConfig;
  'experience-compactor'?: AgentConfig;
  captain?: AgentConfig;
  quartermaster?: AgentConfig;
  historian?: HistorianAgentConfig;
  fisherman?: AgentConfig;
  chief?: AgentConfig;
  curler?: AgentConfig;
  rerunner?: RerunnerAgentConfig;
  analyst?: AgentConfig;
}

interface AIConfig {
  model: any;
  apiKey?: string;
  config?: Record<string, any>;
  langfuse?: {
    enabled?: boolean;
    publicKey?: string;
    secretKey?: string;
    baseUrl?: string;
  };
  tools?: {
    enabled: boolean;
    maxConcurrency: number;
    timeout: number;
  };
  vision?: boolean;
  visionModel?: any;
  agenticModel?: any;
  maxAttempts?: number;
  retryDelay?: number;
  agents?: AgentsConfig;
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

interface ReporterConfig {
  enabled?: boolean;
  html?: boolean;
  markdown?: boolean;
  runGroup?: string | null;
}

type ApiHookFn = (ctx: { headers: Record<string, string>; baseEndpoint: string }) => Promise<Record<string, string> | undefined> | Record<string, string> | undefined;

interface ApiConfig {
  baseEndpoint?: string;
  spec?: string[];
  headers?: Record<string, string>;
  bootstrap?: ApiHookFn;
  teardown?: ApiHookFn;
}

interface WebConfig {
  url: string;
}

interface ExplorbotConfig {
  web?: WebConfig;
  playwright: PlaywrightConfig;
  ai: AIConfig;
  html?: HtmlConfig;
  action?: ActionConfig;
  dirs?: {
    knowledge: string;
    experience: string;
    output: string;
  };
  experience?: {
    maxReadLines?: number;
    disabled?: boolean;
  };
  reporter?: ReporterConfig;
  api?: ApiConfig;
  stepsFile?: string;
  files?: Record<string, string>;
  dynamicPageRegex?: string;
}

const config: ExplorbotConfig = {
  playwright: {
    browser: 'chromium',
    url: 'http://localhost:3000',
  },

  ai: {
    model: null as any,
  },
};

type RuleEntry = string | Record<string, string>;

export const EXPLORBOT_CONFIG_PATHS = ['explorbot.config.js', 'explorbot.config.mjs', 'explorbot.config.ts'];

export const EXPLORBOT_ENV_VARS: EnvVar[] = [
  { name: 'EXPLORBOT_AI_PROVIDER', required: true, description: 'Provider name; fills every model role from its recommended models. Turns on config-free mode' },
  { name: 'EXPLORBOT_AI_MODEL', description: 'Pins the main model — a model id for the provider, or a standalone provider/model-id' },
  { name: 'EXPLORBOT_URL', required: true, description: 'Base URL to test; the API boat reads it as the base endpoint' },
  { name: 'EXPLORBOT_VISION_MODEL', description: 'Screenshot analysis; overrides the provider recommendation' },
  { name: 'EXPLORBOT_AGENTIC_MODEL', description: 'Captain and Pilot decisions; overrides the provider recommendation' },
  { name: 'EXPLORBOT_OUTPUT', description: 'Output root for states, plans, research, and reports. Defaults to a fresh temp directory' },
  { name: 'EXPLORBOT_KNOWLEDGE', description: 'Inline knowledge text, applied to every page' },
  { name: 'EXPLORBOT_KNOWLEDGE_FILE', description: 'Path to a knowledge markdown file' },
  { name: 'EXPLORBOT_API_SPEC', description: 'OpenAPI spec path for the API boat' },
  { name: 'EXPLORBOT_NO_BANNER', description: 'Suppress the startup banner, for machine-readable output' },
];

export type {
  ExplorbotConfig,
  PlaywrightConfig,
  AIConfig,
  HtmlConfig,
  ActionConfig,
  AgentConfig,
  AgentsConfig,
  HistorianAgentConfig,
  ResearcherAgentConfig,
  NavigatorAgentConfig,
  PlannerAgentConfig,
  RerunnerAgentConfig,
  HealRecipe,
  Hook,
  HookConfig,
  HooksConfig,
  PlaywrightHook,
  CodeceptJSHook,
  HookPatternMap,
  RuleEntry,
  ReporterConfig,
  ApiConfig,
  WebConfig,
  ApiHookFn,
};

export class ConfigParser {
  private static instance: ConfigParser;
  private static recommended: Record<string, Record<string, string>> | null = null;
  private config: ExplorbotConfig | null = null;
  private configPath: string | null = null;
  private runtimeBaseUrlOverride: string | null = null;

  private constructor() {}

  public static loadEnv(filePath: string): void {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) return;
    Object.assign(process.env, parseEnv(readFileSync(resolved, 'utf8')));
  }

  public static recommendedModels(): Record<string, Record<string, string>> {
    ConfigParser.recommended ||= JSON.parse(readFileSync(new URL('../models.json', import.meta.url), 'utf8'));
    return ConfigParser.recommended!;
  }

  public static getInstance(): ConfigParser {
    if (!ConfigParser.instance) {
      ConfigParser.instance = new ConfigParser();
    }
    return ConfigParser.instance;
  }

  public async loadConfig(options?: {
    config?: string;
    path?: string;
    baseUrl?: string;
  }): Promise<ExplorbotConfig> {
    if (this.config && !options?.config && !options?.path && this.runtimeBaseUrlOverride === (options?.baseUrl || null)) {
      return this.config;
    }

    // Store the initial working directory for reference
    if (!process.env.INITIAL_CWD) {
      process.env.INITIAL_CWD = process.cwd();
    }

    const originalCwd = process.cwd();
    if (options?.path) {
      const resolvedWorkingPath = resolve(options.path);
      process.chdir(resolvedWorkingPath);
    }

    ConfigParser.loadEnv('.env');

    try {
      const resolvedPath = options?.config || this.findConfigFile();

      let loadedConfig: ExplorbotConfig | null = null;
      let sourcePath = resolvedPath;

      if (resolvedPath) {
        const configModule = await this.loadConfigModule(resolvedPath);
        loadedConfig = configModule.default || configModule;

        if (!loadedConfig) {
          throw new Error('Configuration file is empty or invalid');
        }

        log(`Configuration loaded from: ${resolvedPath}`);
      }

      if (!resolvedPath) {
        const outputRoot = resolveOutputRoot();
        loadedConfig = await this.buildEnvConfig(options?.baseUrl, outputRoot);
        sourcePath = join(outputRoot, 'explorbot.config.js');

        log(`Configuration built from EXPLORBOT_* environment variables. Output: ${outputRoot}`);
      }

      this.config = this.resolveConfig(loadedConfig as ExplorbotConfig, options);
      this.runtimeBaseUrlOverride = options?.baseUrl || null;
      this.configPath = sourcePath;

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

  public getProjectRoot(): string {
    const configPath = this.getConfigPath();
    if (configPath) return path.dirname(configPath);
    return process.cwd();
  }

  public resolveProjectDir(relativeDir: string): string {
    const configPath = this.getConfigPath();
    if (!configPath) return relativeDir;
    return path.join(path.dirname(configPath), relativeDir);
  }

  public getStatesDir(): string {
    return outputPath('states');
  }

  public getPlansDir(): string {
    return outputPath('plans');
  }

  public getTestsDir(): string {
    return outputPath('tests');
  }

  // For testing purposes only
  public static resetForTesting(): void {
    cachedOutputRoot = null;
    if (ConfigParser.instance) {
      ConfigParser.instance.config = null;
      ConfigParser.instance.configPath = null;
      ConfigParser.instance.runtimeBaseUrlOverride = null;
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
        model: { modelId: 'test-model', provider: 'test' },
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

  private async buildEnvConfig(baseUrl: string | undefined, outputRoot: string): Promise<ExplorbotConfig> {
    const provider = process.env.EXPLORBOT_AI_PROVIDER;
    const modelSpec = process.env.EXPLORBOT_AI_MODEL;
    if (!provider && !modelSpec) {
      throw new Error('No configuration file found. Please create explorbot.config.js or set EXPLORBOT_URL and EXPLORBOT_AI_PROVIDER environment variables');
    }
    if (modelSpec && !provider && !modelSpec.includes('/')) {
      throw new Error('EXPLORBOT_AI_MODEL needs a provider — set EXPLORBOT_AI_PROVIDER, or write it as "provider/model-id"');
    }

    const url = process.env.EXPLORBOT_URL || baseUrl;
    if (!url) {
      throw new Error('No URL to explore. Set EXPLORBOT_URL or pass a URL to the command');
    }

    materializeKnowledge(outputRoot);

    let model: any;
    if (provider && modelSpec) model = await createModel(provider, modelSpec);
    if (provider && !modelSpec) model = await resolveModel(provider, 'model');
    if (!provider) model = await resolveModel(modelSpec!, 'model');

    const ai: AIConfig = {
      model,
      agents: { historian: { enabled: false } },
    };

    let recommended: Record<string, string> = {};
    if (provider) recommended = ConfigParser.recommendedModels()[provider] || {};

    const visionSpec = process.env.EXPLORBOT_VISION_MODEL;
    if (visionSpec) ai.visionModel = await resolveModel(visionSpec, 'visionModel');
    if (!visionSpec && recommended.visionModel) ai.visionModel = await resolveModel(provider!, 'visionModel');

    const agenticSpec = process.env.EXPLORBOT_AGENTIC_MODEL;
    if (agenticSpec) ai.agenticModel = await resolveModel(agenticSpec, 'agenticModel');
    if (!agenticSpec && recommended.agenticModel) ai.agenticModel = await resolveModel(provider!, 'agenticModel');

    return {
      playwright: { browser: 'chromium', url, show: false },
      ai,
      dirs: { knowledge: 'knowledge', experience: 'experience', output: '.' },
      experience: { disabled: true },
    };
  }

  private findConfigFile(): string | null {
    const possiblePaths = [...EXPLORBOT_CONFIG_PATHS, 'config/explorbot.config.js', 'config/explorbot.config.mjs', 'config/explorbot.config.ts', 'src/config/explorbot.config.js', 'src/config/explorbot.config.mjs', 'src/config/explorbot.config.ts'];

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

  private resolveConfig(config: ExplorbotConfig, options?: { baseUrl?: string }): ExplorbotConfig {
    if (config.web?.url && !config.playwright?.url) {
      config.playwright = config.playwright || { browser: 'chromium', url: '' };
      config.playwright.url = config.web.url;
    }

    if (options?.baseUrl) {
      config.playwright = config.playwright || { browser: 'chromium', url: '' };
      config.playwright.url = options.baseUrl;
    }

    return config;
  }

  public validateConfig(config: ExplorbotConfig): void {
    if (!config.ai?.model) {
      throw new Error('Missing required configuration field: ai.model');
    }

    const url = config.playwright?.url || config.web?.url;
    if (!url) {
      throw new Error('Missing required configuration: web.url or playwright.url');
    }

    try {
      new URL(url);
    } catch {
      throw new Error(`Invalid URL in configuration: ${url}`);
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
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key].constructor === Object) {
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

export function outputPath(...segments: string[]): string {
  return path.join(ConfigParser.getInstance().getOutputDir(), ...segments);
}

export async function resolveModel(spec: string, role: ModelRole = 'model'): Promise<any> {
  const separator = spec.indexOf('/');
  if (separator > 0) {
    return createModel(spec.slice(0, separator), spec.slice(separator + 1));
  }

  const recommended = ConfigParser.recommendedModels()[spec];
  if (!recommended) {
    throw new Error(`No recommended models for "${spec}". Write it as "provider/model-id", or use a provider with recommendations: ${Object.keys(ConfigParser.recommendedModels()).join(', ')}`);
  }

  const modelId = recommended[role];
  if (!modelId) {
    throw new Error(`Provider "${spec}" has no recommended ${role}. Set it explicitly as "provider/model-id".`);
  }

  return createModel(spec, modelId);
}

export function resolveOutputRoot(): string {
  if (cachedOutputRoot) return cachedOutputRoot;

  const configured = process.env.EXPLORBOT_OUTPUT;
  if (!configured) {
    cachedOutputRoot = mkdtempSync(join(tmpdir(), 'explorbot-'));
    return cachedOutputRoot;
  }

  cachedOutputRoot = resolve(configured);
  mkdirSync(cachedOutputRoot, { recursive: true });
  return cachedOutputRoot;
}

export function materializeKnowledge(outputRoot: string): void {
  const inline = process.env.EXPLORBOT_KNOWLEDGE;
  const knowledgeFile = process.env.EXPLORBOT_KNOWLEDGE_FILE;
  if (!inline && !knowledgeFile) return;

  const knowledgeDir = join(outputRoot, 'knowledge');
  mkdirSync(knowledgeDir, { recursive: true });

  if (inline) {
    writeFileSync(join(knowledgeDir, 'global.md'), matter.stringify(inline, { url: '*', endpoint: '*' }));
  }

  if (!knowledgeFile) return;

  const source = resolve(knowledgeFile);
  if (!existsSync(source)) {
    throw new Error(`Knowledge file from EXPLORBOT_KNOWLEDGE_FILE not found: ${source}`);
  }
  copyFileSync(source, join(knowledgeDir, basename(source)));
}

export async function createModel(provider: string, modelId: string): Promise<any> {
  const factory = PROVIDERS[provider];
  if (!factory) {
    throw new Error(`Unknown AI provider "${provider}". Supported providers: ${Object.keys(PROVIDERS).join(', ')}`);
  }
  return (await factory())(modelId);
}

type ModelRole = 'model' | 'visionModel' | 'agenticModel';

interface EnvVar {
  name: string;
  description: string;
  required?: boolean;
}

export type { ModelRole, EnvVar };
