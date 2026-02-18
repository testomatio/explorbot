import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import figureSet from 'figures';
import { Agent } from './ai/agent.ts';
import { Bosun } from './ai/bosun.ts';
import { Captain } from './ai/captain.ts';
import { ExperienceCompactor } from './ai/experience-compactor.ts';
import { Historian } from './ai/historian.ts';
import { Navigator } from './ai/navigator.ts';
import { Pilot } from './ai/pilot.ts';
import { Planner } from './ai/planner.ts';
import { AIProvider, AiError } from './ai/provider.ts';
import { Quartermaster } from './ai/quartermaster.ts';
import { Researcher } from './ai/researcher.ts';
import { Tester } from './ai/tester.ts';
import { createAgentTools } from './ai/tools.ts';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.ts';
import Explorer from './explorer.ts';
import { KnowledgeTracker } from './knowledge-tracker.ts';
import { WebPageState } from './state-manager.ts';
import { Plan } from './test-plan.ts';
import { log, setVerboseMode, tag } from './utils/logger.ts';
import { sanitizeFilename } from './utils/strings.ts';

const planId = 0;
export interface ExplorBotOptions {
  from?: string;
  verbose?: boolean;
  config?: string;
  path?: string;
  show?: boolean;
  headless?: boolean;
  incognito?: boolean;
  session?: string;
}

export type UserResolveFunction = (error?: Error, showWelcome?: boolean) => Promise<string | null>;

export class ExplorBot {
  private configParser: ConfigParser;
  private explorer!: Explorer;
  private provider!: AIProvider;
  private config!: ExplorbotConfig;
  private options: ExplorBotOptions;
  private userResolveFn: UserResolveFunction | null = null;
  public needsInput = false;
  private currentPlan?: Plan;
  private planFeature?: string;
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
    if (this.explorer?.isStarted) {
      return;
    }

    try {
      this.config = await this.configParser.loadConfig(this.options);
      this.provider = new AIProvider(this.config.ai);
      await this.provider.validateConnection();
      this.explorer = new Explorer(this.config, this.provider, this.options);
      await this.explorer.start();
      if (!this.options.incognito) {
        await this.agentExperienceCompactor().compactAllExperiences();
      }
      if (this.userResolveFn) this.explorer.setUserResolve(this.userResolveFn);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('\nFailed to start:', message);
      process.exit(1);
    }
  }

  async stop(): Promise<void> {
    this.agents.quartermaster?.stop();
    await this.explorer.stop();
  }

  async visitInitialState(): Promise<void> {
    const url = this.options.from || '/';
    await this.visit(url);
  }

  async visit(url: string): Promise<void> {
    return this.agentNavigator().visit(url);
  }

  getCurrentState(): WebPageState | null {
    return this.explorer.getStateManager().getCurrentState();
  }

  getExplorer(): Explorer {
    return this.explorer;
  }

  getKnowledgeTracker(): KnowledgeTracker {
    if (this.explorer) {
      return this.explorer.getKnowledgeTracker();
    }
    return new KnowledgeTracker();
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
      return new Navigator(explorer, ai, this.agentExperienceCompactor(), explorer.getStateManager().getExperienceTracker());
    }));
  }

  agentPlanner(): Planner {
    return (this.agents.planner ||= this.createAgent(({ ai, explorer }) => new Planner(explorer, ai)));
  }

  agentPilot(): Pilot {
    return (this.agents.pilot ||= this.createAgent(({ ai, explorer }) => {
      const researcher = this.agentResearcher();
      const navigator = this.agentNavigator();
      const tools = createAgentTools({ explorer, researcher, navigator });
      return new Pilot(ai, tools, researcher);
    }));
  }

  agentTester(): Tester {
    if (!this.agents.tester) {
      this.agents.tester = this.createAgent(({ ai, explorer }) => {
        const researcher = this.agentResearcher();
        const navigator = this.agentNavigator();
        const tools = createAgentTools({ explorer, researcher, navigator });
        return new Tester(explorer, ai, researcher, navigator, tools);
      });

      const qm = this.agentQuartermaster();
      if (qm) this.agents.tester.setQuartermaster(qm);
      this.agents.tester.setHistorian(this.agentHistorian());
      this.agents.tester.setPilot(this.agentPilot());
    }
    return this.agents.tester;
  }

  agentCaptain(): Captain {
    if (!this.agents.captain) {
      this.agents.captain = new Captain(this);

      const qm = this.agentQuartermaster();
      if (qm) this.agents.captain.setQuartermaster(qm);
      this.agents.captain.setHistorian(this.agentHistorian());
    }
    return this.agents.captain;
  }

  agentExperienceCompactor(): ExperienceCompactor {
    return (this.agents.experienceCompactor ||= this.createAgent(({ ai, explorer }) => {
      const experienceTracker = explorer.getStateManager().getExperienceTracker();
      return new ExperienceCompactor(ai, experienceTracker);
    }));
  }

  agentQuartermaster(): Quartermaster | null {
    const config = this.config.ai?.agents?.quartermaster;
    if (config?.enabled !== true) return null;

    if (!this.agents.quartermaster) {
      this.agents.quartermaster = new Quartermaster(this.provider, {
        model: config?.model,
      });
      this.agents.quartermaster.start(this.explorer.playwrightHelper, this.explorer.getStateManager());
    }
    return this.agents.quartermaster;
  }

  agentHistorian(): Historian {
    return (this.agents.historian ||= this.createAgent(({ ai, explorer }) => {
      const experienceTracker = explorer.getStateManager().getExperienceTracker();
      const reporter = explorer.getReporter();
      return new Historian(ai, experienceTracker, reporter);
    }));
  }

  agentBosun(): Bosun {
    return (this.agents.bosun ||= this.createAgent(({ ai, explorer }) => {
      const researcher = this.agentResearcher();
      const navigator = this.agentNavigator();
      const tools = createAgentTools({ explorer, researcher, navigator });
      return new Bosun(explorer, ai, researcher, navigator, tools);
    }));
  }

  getCurrentPlan(): Plan | undefined {
    return this.currentPlan;
  }

  getPlanFeature(): string | undefined {
    return this.planFeature;
  }

  clearPlan(): void {
    this.currentPlan = undefined;
    delete this.agents.planner;
  }

  async plan(feature?: string, opts: { fresh?: boolean } = {}) {
    this.planFeature = feature;

    if (opts.fresh) {
      this.clearPlan();
    }

    if (this.currentPlan?.url) {
      const currentUrl = this.explorer?.getStateManager().getCurrentState()?.url;
      if (currentUrl && currentUrl !== this.currentPlan.url) {
        tag('info').log(`Different page detected, clearing previous plan`);
        this.clearPlan();
      }
    }

    if (!this.currentPlan && !opts.fresh) {
      const planFilename = this.generatePlanFilename();
      const planPath = path.join(this.getPlansDir(), planFilename);
      if (existsSync(planPath)) {
        tag('info').log(`Loading existing plan from ${planFilename}`);
        this.currentPlan = Plan.fromMarkdown(planPath);
      }
    }

    const planner = this.agentPlanner();
    if (this.currentPlan) {
      planner.setPlan(this.currentPlan);
    }
    this.currentPlan = await planner.plan(feature);

    const savedPath = this.savePlan();
    if (savedPath) {
      const relativePath = path.relative(process.cwd(), savedPath);
      tag('info').log(`Plan saved to: ${relativePath}`);
      tag('info').log(`Edit the plan file and run /plan:load ${relativePath} to reload it`);
    }

    return this.currentPlan;
  }

  getPlansDir(): string {
    const outputDir = this.configParser.getOutputDir();
    return path.join(outputDir, 'plans');
  }

  savePlan(filename?: string): string | null {
    if (!this.currentPlan) return null;

    const plansDir = this.getPlansDir();
    if (!existsSync(plansDir)) {
      mkdirSync(plansDir, { recursive: true });
    }

    const planFilename = filename || this.generatePlanFilename();
    const planPath = path.join(plansDir, planFilename);
    this.currentPlan.saveToMarkdown(planPath);
    return planPath;
  }

  private generatePlanFilename(): string {
    const state = this.explorer?.getStateManager().getCurrentState();
    const urlPath = state?.url || '/';
    const urlPart = sanitizeFilename(urlPath) || 'root';
    const suffix = '.md';
    if (!this.planFeature) return urlPart.slice(0, 256 - suffix.length) + suffix;
    const featurePart = '_' + sanitizeFilename(this.planFeature);
    const maxFeatureLen = 256 - suffix.length - urlPart.length;
    if (maxFeatureLen <= 1) return urlPart.slice(0, 256 - suffix.length) + suffix;
    return urlPart + featurePart.slice(0, maxFeatureLen) + suffix;
  }

  loadPlan(filename: string): Plan {
    const plansDir = this.getPlansDir();
    let planPath = filename;

    if (!path.isAbsolute(filename)) {
      planPath = path.join(plansDir, filename);
      if (!existsSync(planPath) && !filename.endsWith('.md')) {
        planPath = path.join(plansDir, filename + '.md');
      }
    }

    if (!existsSync(planPath)) {
      throw new Error(`Plan file not found: ${planPath}`);
    }

    this.currentPlan = Plan.fromMarkdown(planPath);
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

  async freeride(): Promise<void> {
    await this.visitInitialState();
    const { loop } = await import('./utils/loop.js');

    await loop(
      async () => {
        await this.explore();
        const navigator = this.agentNavigator();
        const suggestion = await navigator.freeSail();
        if (!suggestion) {
          tag('info').log('No navigation suggestion available');
          return;
        }
        tag('info').log(`Navigating to: ${suggestion.target} - ${suggestion.reason}`);
        await this.visit(suggestion.target);
      },
      { maxAttempts: Number.POSITIVE_INFINITY }
    );
  }
}
