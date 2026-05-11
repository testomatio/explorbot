import { existsSync, readFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { ConfigParser } from '../../../src/config.ts';

class DocbotConfigParser {
  private static instance: DocbotConfigParser;
  private config: DocbotConfig | null = null;
  private configPath: string | null = null;

  private constructor() {}

  static getInstance(): DocbotConfigParser {
    if (!DocbotConfigParser.instance) {
      DocbotConfigParser.instance = new DocbotConfigParser();
    }
    return DocbotConfigParser.instance;
  }

  static loadEnv(filePath: string): void {
    const resolved = resolve(filePath);
    if (!existsSync(resolved)) return;
    Object.assign(process.env, parseEnv(readFileSync(resolved, 'utf8')));
  }

  async loadConfig(options?: { config?: string; path?: string }): Promise<DocbotConfig> {
    if (this.config && !options?.config && !options?.path) {
      return this.config;
    }

    const originalCwd = process.cwd();
    if (options?.path) {
      process.chdir(resolve(options.path));
    }

    DocbotConfigParser.loadEnv('.env');

    try {
      const resolvedPath = options?.config || this.findConfigFile();
      if (!resolvedPath) {
        this.config = this.mergeWithDefaults({});
        this.configPath = null;
        return this.config;
      }

      const configModule = await this.loadConfigModule(resolvedPath);
      const loadedConfig = configModule.default || configModule;
      this.config = this.mergeWithDefaults(loadedConfig || {});
      this.configPath = resolvedPath;
      return this.config;
    } finally {
      if (options?.path && originalCwd !== process.cwd()) {
        process.chdir(originalCwd);
      }
    }
  }

  getConfig(): DocbotConfig {
    if (this.config) {
      return this.config;
    }
    return this.mergeWithDefaults({});
  }

  getConfigPath(): string | null {
    return this.configPath;
  }

  getOutputDir(): string {
    const outputDir = ConfigParser.getInstance().getOutputDir();
    const docsOutput = this.getConfig().docs?.output;
    if (!docsOutput) {
      return path.join(outputDir, 'docs');
    }
    return path.join(outputDir, docsOutput);
  }

  private findConfigFile(): string | null {
    const possiblePaths = ['docbot.config.js', 'docbot.config.mjs', 'docbot.config.ts'];

    for (const candidate of possiblePaths) {
      const fullPath = resolve(process.cwd(), candidate);
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
        return await import(configPath);
      } catch {
        const require = (await import('node:module')).createRequire(import.meta.url);
        return require(configPath);
      }
    }

    if (ext === 'js' || ext === 'mjs') {
      return await import(configPath);
    }

    return JSON.parse(readFileSync(configPath, 'utf8'));
  }

  private mergeWithDefaults(config: Partial<DocbotConfig>): DocbotConfig {
    return this.deepMerge(
      {
        docs: {
          maxPages: 100,
          output: 'docs',
          screenshot: true,
          collapseDynamicPages: true,
          scope: 'site',
          includePaths: [],
          excludePaths: [],
          deniedPathSegments: ['callback', 'callbacks', 'logout', 'signout', 'sign_out', 'destroy', 'delete', 'remove'],
          minCanActions: 1,
          minInteractiveElements: 3,
        },
      },
      config
    );
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) && source[key].constructor === Object) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
        continue;
      }
      result[key] = source[key];
    }

    return result;
  }
}

interface DocbotConfig {
  docs?: {
    maxPages?: number;
    output?: string;
    screenshot?: boolean;
    prompt?: string;
    collapseDynamicPages?: boolean;
    scope?: 'site' | 'section' | 'subtree';
    includePaths?: string[];
    excludePaths?: string[];
    deniedPathSegments?: string[];
    minCanActions?: number;
    minInteractiveElements?: number;
  };
}

export { DocbotConfigParser };
export type { DocbotConfig };
