import fs from 'node:fs';
import path from 'node:path';
import { ExperienceCompactor } from './ai/experience-compactor.ts';
import { Navigator } from './ai/navigator.ts';
import { Planner, type Task } from './ai/planner.ts';
import { AIProvider, AiError } from './ai/provider.ts';
import { Researcher } from './ai/researcher.ts';
import { Tester } from './ai/tester.ts';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.ts';
import Explorer from './explorer.ts';
import { log, setVerboseMode } from './utils/logger.ts';

export interface ExplorBotOptions {
  from?: string;
  verbose?: boolean;
  config?: string;
  path?: string;
  show?: boolean;
  headless?: boolean;
}

export type UserResolveFunction = (error?: Error) => Promise<string | null>;

export class ExplorBot {
  private configParser: ConfigParser;
  private explorer!: Explorer;
  private provider!: AIProvider;
  private config!: ExplorbotConfig;
  private options: ExplorBotOptions;
  private userResolveFn: UserResolveFunction | null = null;
  public needsInput = false;

  constructor(options: ExplorBotOptions = {}) {
    this.options = options;
    if (this.options.verbose) {
      process.env.DEBUG = 'explorbot:*';
      setVerboseMode(true);
    }
    this.configParser = ConfigParser.getInstance();
  }

  async loadConfig(): Promise<void> {
    this.config = await this.configParser.loadConfig(this.options);
    this.provider = new AIProvider(this.config.ai);
    this.explorer = new Explorer(this.config, this.provider, this.options);
  }

  get isExploring(): boolean {
    return this.explorer !== null && this.explorer.isStarted;
  }

  setUserResolve(fn: UserResolveFunction): void {
    this.userResolveFn = fn;
  }

  async start(): Promise<void> {
    try {
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
    const navigator = this.agentNavigator();
    await navigator.visit(url, this.explorer);
    if (this.userResolveFn) {
      log('What should we do next? Consider /research, /plan, /navigate commands');
      this.userResolveFn();
    } else {
      log('No user resolve function provided, exiting...');
    }
  }

  getExplorer(): Explorer {
    return this.explorer;
  }

  getConfig(): ExplorbotConfig {
    return this.config;
  }

  getOptions(): ExplorBotOptions {
    return this.options;
  }
  isReady(): boolean {
    return this.explorer !== null && this.explorer.isStarted;
  }

  getConfigParser(): ConfigParser {
    return this.configParser;
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  createAgent<T>(factory: (deps: { explorer: Explorer; ai: AIProvider; config: ExplorbotConfig }) => T): T {
    const agent = factory({
      explorer: this.explorer,
      ai: this.provider,
      config: this.config,
    });

    const agentEmoji = (agent as any).emoji || '';
    const agentName = (agent as any).constructor.name.toLowerCase();
    log(`${agentEmoji} Created ${agentName} agent`);

    return agent;
  }

  agentResearch(): Researcher {
    return this.createAgent(({ ai, explorer }) => new Researcher(explorer, ai));
  }

  agentNavigator(): Navigator {
    return this.createAgent(({ ai }) => new Navigator(ai));
  }

  agentPlanner(): Planner {
    return this.createAgent(({ ai, explorer }) => new Planner(explorer, ai));
  }

  agentTester(): Tester {
    return this.createAgent(({ explorer, ai }) => new Tester(explorer, ai));
  }

  async research() {
    log('Researching...');
    const researcher = this.agentResearch();
    researcher.setActor(this.explorer.actor);
    const conversation = await researcher.research();
    return conversation;
  }

  async plan() {
    log('Researching...');
    const researcher = this.agentResearch();
    researcher.setActor(this.explorer.actor);
    await researcher.research();
    log('Planning...');
    const planner = this.agentPlanner();
    const scenarios = await planner.plan();
    this.explorer.scenarios = scenarios;
    return scenarios;
  }
}
