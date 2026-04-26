import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { ActionResult } from './action-result.ts';
import { Bosun } from './ai/bosun.ts';
import { Captain } from './ai/captain.ts';
import { ExperienceCompactor } from './ai/experience-compactor.ts';
import { Fisherman } from './ai/fisherman.ts';
import { Historian } from './ai/historian.ts';
import { Navigator } from './ai/navigator.ts';
import { Pilot } from './ai/pilot.ts';
import { Planner } from './ai/planner.ts';
import { AIProvider } from './ai/provider.ts';
import { Quartermaster } from './ai/quartermaster.ts';
import { Rerunner } from './ai/rerunner.ts';
import { Researcher } from './ai/researcher.ts';
import { Tester } from './ai/tester.ts';
import { createAgentTools } from './ai/tools.ts';
import { ApiClient } from './api/api-client.ts';
import { RequestStore } from './api/request-store.ts';
import { loadSpec } from './api/spec-reader.ts';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.ts';
import { ExperienceTracker } from './experience-tracker.ts';
import Explorer from './explorer.ts';
import { KnowledgeTracker } from './knowledge-tracker.ts';
import { WebPageState } from './state-manager.ts';
import type { Suite } from './suite.ts';
import { Plan } from './test-plan.ts';
import { setVerboseMode, tag } from './utils/logger.ts';
import { sanitizeFilename } from './utils/strings.ts';

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
  lastPlanError: Error | null = null;
  lastSavedPlanPath: string | null = null;
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
      await this.startProviderOnly();
      this.explorer = new Explorer(this.config, this.provider, this.options);
      await this.explorer.start();
      if (!this.options.incognito) {
        await this.agentExperienceCompactor().autocompact();
      }
      if (this.userResolveFn) this.explorer.setUserResolve(this.userResolveFn);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('\nFailed to start:', message);
      process.exit(1);
    }
  }

  async startProviderOnly(): Promise<void> {
    if (this.provider) return;
    this.config = await this.configParser.loadConfig(this.options);
    this.provider = new AIProvider(this.config.ai);
    await this.provider.validateConnection();
  }

  async stop(): Promise<void> {
    this.agents.quartermaster?.stop();
    await this.explorer?.stop();
  }

  async visitInitialState(): Promise<void> {
    const url = this.options.from || '/';
    await this.visit(url);
  }

  async visit(url: string): Promise<void> {
    return this.agentNavigator().visit(url);
  }

  async openFreshTab(): Promise<void> {
    await this.explorer.openFreshTab();
  }

  getCurrentState(): WebPageState | null {
    return this.explorer?.getStateManager().getCurrentState() ?? null;
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

  getExperienceTracker(): ExperienceTracker {
    if (this.explorer) {
      return this.explorer.getStateManager().getExperienceTracker();
    }
    return new ExperienceTracker();
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
    if (!this.agents.planner) {
      this.agents.planner = this.createAgent(({ ai, explorer }) => new Planner(explorer, ai));
      const fisherman = this.agentFisherman();
      if (fisherman) this.agents.planner.setFisherman(fisherman);
    }
    return this.agents.planner;
  }

  agentPilot(): Pilot {
    return (this.agents.pilot ||= this.createAgent(({ ai, explorer }) => {
      const researcher = this.agentResearcher();
      const navigator = this.agentNavigator();
      const stateManager = explorer.getStateManager();
      const experienceTracker = stateManager.getExperienceTracker();
      const getState = () => {
        const state = stateManager.getCurrentState();
        return state ? ActionResult.fromState(state) : null;
      };
      const tools = createAgentTools({ explorer, researcher, navigator, experienceTracker, getState });
      return new Pilot(ai, tools, researcher, explorer, experienceTracker);
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
      this.agents.tester.setCaptain(this.agentCaptain());

      const fisherman = this.agentFisherman();
      if (fisherman) this.agentPilot().setFisherman(fisherman);
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
    return (this.agents.experienceCompactor ||= new ExperienceCompactor(this.provider, this.getExperienceTracker()));
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
    return (this.agents.historian ||= this.createAgent(({ ai, explorer, config }) => {
      const experienceTracker = explorer.getStateManager().getExperienceTracker();
      const reporter = explorer.getReporter();
      return new Historian(ai, experienceTracker, reporter, explorer.getStateManager(), config, explorer.getPlaywrightRecorder());
    }));
  }

  agentRerunner(): Rerunner {
    if (!this.agents.rerunner) {
      this.agents.rerunner = this.createAgent(({ ai, explorer }) => {
        const researcher = this.agentResearcher();
        const navigator = this.agentNavigator();
        const tools = createAgentTools({ explorer, researcher, navigator });
        return new Rerunner(explorer, ai, tools);
      });
      const qm = this.agentQuartermaster();
      if (qm) this.agents.rerunner.setQuartermaster(qm);
      this.agents.rerunner.setHistorian(this.agentHistorian());
    }
    return this.agents.rerunner;
  }

  agentBosun(): Bosun {
    return (this.agents.bosun ||= this.createAgent(({ ai, explorer }) => {
      const researcher = this.agentResearcher();
      const navigator = this.agentNavigator();
      const tools = createAgentTools({ explorer, researcher, navigator });
      return new Bosun(explorer, ai, researcher, navigator, tools);
    }));
  }

  agentFisherman(): Fisherman | null {
    const fishermanConfig = this.config.ai?.agents?.fisherman;
    const hasApiConfig = !!this.config.api;

    if (!hasApiConfig && fishermanConfig?.enabled !== true) return null;

    if (!this.agents.fisherman) {
      const apiConfig = this.config.api;
      const outputDir = this.configParser.getOutputDir();
      const requestStore = this.explorer.getRequestStore() || new RequestStore(outputDir);
      const baseEndpoint = apiConfig?.baseEndpoint || this.config.playwright.url;
      const configHeaders = apiConfig?.headers || {};
      const apiClient = new ApiClient(baseEndpoint);

      const specPaths = apiConfig?.spec;
      const specLoader = async () => {
        if (!specPaths?.length) return null;
        try {
          return await loadSpec(specPaths, outputDir);
        } catch {
          return null;
        }
      };

      const cookieProvider = () => this.explorer.extractCookies();

      this.agents.fisherman = this.createAgent(({ ai }) => {
        return new Fisherman(ai, apiClient, requestStore, specLoader, baseEndpoint, cookieProvider, configHeaders, hasApiConfig);
      });
    }
    return this.agents.fisherman;
  }

  getCurrentPlan(): Plan | undefined {
    return this.currentPlan;
  }

  getSuite(): Suite | null {
    return this.agentPlanner().getSuite();
  }

  getPlanFeature(): string | undefined {
    return this.planFeature;
  }

  clearPlan(): void {
    this.currentPlan = undefined;
    this.agents.planner = undefined;
  }

  async plan(feature?: string, opts: { fresh?: boolean; style?: string; extend?: Plan; completedPlans?: Plan[] } = {}) {
    this.planFeature = feature;

    if (opts.fresh) {
      this.clearPlan();
    }

    if (!opts.extend && this.currentPlan?.url) {
      const currentUrl = this.explorer?.getStateManager().getCurrentState()?.url;
      if (currentUrl && currentUrl !== this.currentPlan.url) {
        tag('info').log('Different page detected, clearing previous plan');
        this.clearPlan();
      }
    }

    const planner = this.agentPlanner();
    planner.freshStart = !!opts.fresh;
    if (this.currentPlan) {
      planner.setPlan(this.currentPlan);
    }
    this.lastPlanError = null;
    try {
      this.currentPlan = await planner.plan(feature, opts.style, opts.extend, opts.completedPlans);
    } catch (err) {
      this.lastPlanError = err instanceof Error ? err : new Error(String(err));
      tag('warning').log(`Planning failed: ${this.lastPlanError.message}`);
      if (!this.currentPlan) return undefined;
      return this.currentPlan;
    }

    this.savePlan();

    return this.currentPlan;
  }

  getPlansDir(): string {
    const outputDir = this.configParser.getOutputDir();
    return path.join(outputDir, 'plans');
  }

  savePlan(filename?: string): string | null {
    if (!this.currentPlan) return null;
    return this.savePlans([this.currentPlan], filename);
  }

  savePlans(plans: Plan[], filename?: string): string | null {
    if (plans.length === 0) return null;

    const plansDir = this.getPlansDir();
    if (!existsSync(plansDir)) {
      mkdirSync(plansDir, { recursive: true });
    }

    const planFilename = filename || this.generatePlanFilename();
    const planPath = path.join(plansDir, planFilename);
    Plan.saveMultipleToMarkdown(plans, planPath);
    this.lastSavedPlanPath = planPath;
    return planPath;
  }

  generatePlanFilename(): string {
    const state = this.explorer?.getStateManager().getCurrentState();
    const urlPath = state?.url || '/';
    const urlPart = sanitizeFilename(urlPath) || 'root';
    const suffix = '.md';
    if (!this.planFeature) return urlPart.slice(0, 256 - suffix.length) + suffix;
    const featurePart = `_${sanitizeFilename(this.planFeature)}`;
    const maxFeatureLen = 256 - suffix.length - urlPart.length;
    if (maxFeatureLen <= 1) return urlPart.slice(0, 256 - suffix.length) + suffix;
    return urlPart + featurePart.slice(0, maxFeatureLen) + suffix;
  }

  loadPlan(filename: string): Plan {
    let planPath = filename;

    if (path.isAbsolute(filename)) {
      if (!existsSync(planPath) && !filename.endsWith('.md')) {
        planPath = `${filename}.md`;
      }
    } else if (existsSync(filename) || existsSync(`${filename}.md`)) {
      planPath = existsSync(filename) ? filename : `${filename}.md`;
    } else {
      const plansDir = this.getPlansDir();
      planPath = path.join(plansDir, filename);
      if (!existsSync(planPath) && !filename.endsWith('.md')) {
        planPath = path.join(plansDir, `${filename}.md`);
      }
    }

    if (!existsSync(planPath)) {
      throw new Error(`Plan file not found: ${planPath}`);
    }

    this.currentPlan = Plan.fromMarkdown(planPath);
    return this.currentPlan;
  }

  setCurrentPlan(plan?: Plan): void {
    this.currentPlan = plan;
  }
}
