import path from 'node:path';
import Explorer from './explorer.ts';
import { ConfigParser } from './config.ts';
import { log } from './utils/logger.ts';
import type { ExplorbotConfig } from '../explorbot.config.ts';
import { AiError } from './ai/provider.ts';

export interface ExplorBotOptions {
  from?: string;
  verbose?: boolean;
  config?: string;
  path?: string;
}

export type UserResolveFunction = (error: Error) => Promise<string | null>;

export class ExplorBot {
  private explorer!: Explorer;
  private config: ExplorbotConfig | null = null;
  private options: ExplorBotOptions;
  private userResolveFn: UserResolveFunction | null = null;
  public needsInput = true;

  constructor(options: ExplorBotOptions = {}) {
    this.options = options;
    if (this.options.verbose) {
      process.env.DEBUG = 'explorbot:*';
    }
  }

  async loadConfig(): Promise<void> {
    const configParser = ConfigParser.getInstance();
    this.config = await configParser.loadConfig(this.options);
    log('✅ Configuration loaded successfully');
  }

  get isExploring(): boolean {
    return this.explorer !== null && this.explorer.isStarted;
  }

  setUserResolve(fn: UserResolveFunction): void {
    this.userResolveFn = fn;
  }

  async start(): Promise<void> {
    try {
      this.explorer = new Explorer();
      await this.explorer.start();

      if (this.options.from) {
        await this.visitWithFallback(this.options.from);
      }
    } catch (error) {
      log(`❌ Failed to start: ${error}`);
      if (error instanceof AiError) {
        console.log(error.message);
        process.exit(1);
      }
      throw error;
    }
  }

  private async visitWithFallback(url: string): Promise<void> {
    try {
      await this.explorer.visit(url);
      this.needsInput = false;
    } catch (error: any) {
      log('❌ Failed to visit:', error);
      this.needsInput = true;
      if (!this.userResolveFn) throw error;

      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      await this.userResolveFn(errorObj);
    }
  }

  getExplorer(): Explorer {
    return this.explorer;
  }

  getConfig(): ExplorbotConfig | null {
    return this.config;
  }

  isReady(): boolean {
    return this.explorer !== null && this.explorer.isStarted;
  }
}
