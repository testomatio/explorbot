import path from 'node:path';
import fs from 'node:fs';
import Explorer from './explorer.ts';
import { ConfigParser } from './config.ts';
import { log, setVerboseMode } from './utils/logger.ts';
import type { ExplorbotConfig } from './config.js';
import { AiError } from './ai/provider.ts';
import { ExperienceCompactor } from './ai/experience-compactor.ts';
import type { Task } from './ai/planner.ts';

export interface ExplorBotOptions {
  from?: string;
  verbose?: boolean;
  config?: string;
  path?: string;
}

export type UserResolveFunction = (error?: Error) => Promise<string | null>;

export class ExplorBot {
  private explorer!: Explorer;
  private config: ExplorbotConfig | null = null;
  private options: ExplorBotOptions;
  private userResolveFn: UserResolveFunction | null = null;
  public needsInput = false;

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
      if (this.userResolveFn) this.explorer.setUserResolve(this.userResolveFn);
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
    await this.explorer.visit(url);
    if (this.userResolveFn) {
      log(
        'What should we do next? Consider /research, /plan, /navigate commands'
      );
      this.userResolveFn();
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

  getTasks(): Task[] {
    return this.explorer ? this.explorer.scenarios : [];
  }

  isReady(): boolean {
    return this.explorer !== null && this.explorer.isStarted;
  }
}
