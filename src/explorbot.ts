import fs from 'node:fs';
import path from 'node:path';
import figureSet from 'figures';
import { Agent } from './ai/agent.ts';
import { Captain } from './ai/captain.ts';
import { ExperienceCompactor } from './ai/experience-compactor.ts';
import { Navigator } from './ai/navigator.ts';
import { Planner } from './ai/planner.ts';
import { AIProvider, AiError } from './ai/provider.ts';
import { Researcher } from './ai/researcher.ts';
import { Tester } from './ai/tester.ts';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.ts';
import Explorer from './explorer.ts';
import { Plan } from './test-plan.ts';
import { log, setVerboseMode, tag } from './utils/logger.ts';

const planId = 0;
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
  private currentPlan?: Plan;
  private agents: Record<string, any> = {};

  constructor(options: ExplorBotOptions = {}) {
    this.options = options;
    this.configParser = ConfigParser.getInstance();
    if (this.options.verbose) {
      process.env.DEBUG = 'explorbot:*';
      setVerboseMode(true);
    }
  }

  get isExploring(): boolean {
    return this.explorer?.isStarted;
  }

  setUserResolve(fn: UserResolveFunction): void {
    this.userResolveFn = fn;
  }

  async start(): Promise<void> {
    try {
      this.config = await this.configParser.loadConfig(this.options);
      this.provider = new AIProvider(this.config.ai);
      this.explorer = new Explorer(this.config, this.provider, this.options);
      await this.explorer.start();
      await this.agentExperienceCompactor().compactAllExperiences();
      if (this.userResolveFn) this.explorer.setUserResolve(this.userResolveFn);
    } catch (error) {
      console.log('\n❌ Failed to start:');
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

  async stop(): Promise<void> {
    await this.explorer.stop();
  }

  async visitInitialState(): Promise<void> {
    const url = this.options.from || '/';
    await this.visit(url);
    if (this.userResolveFn) {
      log('What should we do next? Consider /explore /plan /navigate commands');
      this.userResolveFn();
    } else {
      log('No user resolve function provided, exiting...');
    }
  }

  async visit(url: string): Promise<void> {
    return this.agentNavigator().visit(url);
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
    return this.explorer?.isStarted;
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
    tag('debug').log(`Created ${agentName} agent`);

    // Agent is stored by the calling method using a string key

    return agent;
  }

  agentResearcher(): Researcher {
    return (this.agents.researcher ||= this.createAgent(({ ai, explorer }) => new Researcher(explorer, ai)));
  }

  agentNavigator(): Navigator {
    return (this.agents.navigator ||= this.createAgent(({ ai, explorer }) => {
      return new Navigator(explorer, ai, this.agentExperienceCompactor());
    }));
  }

  agentPlanner(): Planner {
    return (this.agents.planner ||= this.createAgent(({ ai, explorer }) => new Planner(explorer, ai)));
  }

  agentTester(): Tester {
    return (this.agents.tester ||= this.createAgent(({ ai, explorer }) => new Tester(explorer, ai)));
  }

  agentCaptain(): Captain {
    return (this.agents.captain ||= new Captain(this));
  }

  agentExperienceCompactor(): ExperienceCompactor {
    return (this.agents.experienceCompactor ||= this.createAgent(({ ai, explorer }) => {
      const experienceTracker = explorer.getStateManager().getExperienceTracker();
      return new ExperienceCompactor(ai, experienceTracker);
    }));
  }

  getCurrentPlan(): Plan | undefined {
    return this.currentPlan;
  }

  async plan(feature?: string) {
    const planner = this.agentPlanner();
    if (this.currentPlan) {
      planner.setPreviousPlan(this.currentPlan);
    }
    this.currentPlan = await planner.plan(feature);
    return this.currentPlan;
  }

  async explore(feature?: string) {
    const planner = this.agentPlanner();
    this.currentPlan = await planner.plan(feature);
    const tester = this.agentTester();
    for (const test of this.currentPlan.tests) {
      await tester.test(test);
    }
    tag('info').log(`Completed testing: ${this.currentPlan.title}} ${this.currentPlan.url}`);

    for (const test of this.currentPlan.tests) {
      if (test.isSuccessful) {
        tag('success').log(`Test: ${test.scenario}`);
      } else {
        tag('error').log(`Test: ${test.scenario}`);
      }
      test.getPrintableNotes().forEach((note) => {
        tag('step').log(note);
      });
    }
    tag('info').log(`${figureSet.tick} ${this.currentPlan.tests.length} tests completed`);
  }

  async testOneByOne() {
    const tester = this.agentTester();
    if (!this.currentPlan) {
      throw new Error('No plan found');
    }
    const test = this.currentPlan.getPendingTests()[0];
    if (!test) {
      throw new Error('No test to test');
    }
    await tester.test(test);
  }
}
