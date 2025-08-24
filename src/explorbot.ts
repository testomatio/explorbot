import path from 'node:path';
import fs from 'node:fs';
import Explorer from './explorer.ts';
import { ConfigParser } from './config.ts';
import { log, setVerboseMode } from './utils/logger.ts';
import type { ExplorbotConfig } from '../explorbot.config.ts';
import { AiError } from './ai/provider.ts';
import { ExperienceCompactor } from './ai/experience-compactor.ts';

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
      setVerboseMode(true);
    }
  }

  async loadConfig(): Promise<void> {
    const configParser = ConfigParser.getInstance();
    this.config = await configParser.loadConfig(this.options);
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
      await this.explorer.compactPreviousExperiences();
      await this.explorer.start();
    } catch (error) {
      console.log(`\n❌ Failed to start:`);
      if (error instanceof AiError) {
        console.log('  ', error.message);
      } else if (error instanceof Error) {
        console.log('  ', error.stack);
      } else {
        console.log('  ', error);
      }
      process.exit(1);
    }
  }

  async visitInitialState(): Promise<void> {
    const url = this.options.from || '/';
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

  getOptions(): ExplorBotOptions {
    return this.options;
  }

  isReady(): boolean {
    return this.explorer !== null && this.explorer.isStarted;
  }
}
