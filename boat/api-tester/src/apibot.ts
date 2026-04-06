import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { AIProvider } from '../../../src/ai/provider.ts';
import { Reporter } from '../../../src/reporter.ts';
import { Plan } from '../../../src/test-plan.ts';
import { setVerboseMode, tag } from '../../../src/utils/logger.ts';
import { Chief } from './ai/chief.ts';
import { Curler } from './ai/curler.ts';
import { ApiClient } from './api-client.ts';
import { type ApibotConfig, ApibotConfigParser } from './config.ts';
import { RequestStore } from '../../../src/api/request-store.ts';
import { extractEndpointDefinition, loadSpec, searchEndpoints, validateSpecs } from '../../../src/api/spec-reader.ts';

export class ApiBot {
  private configParser: ApibotConfigParser;
  private provider!: AIProvider;
  private config!: ApibotConfig;
  private agents: Record<string, any> = {};
  private currentPlan?: Plan;
  private apiClient!: ApiClient;
  private requestState!: RequestStore;
  private reporter!: Reporter;
  private options: ApibotOptions;
  private apiSpec: any;

  constructor(options: ApibotOptions = {}) {
    this.options = options;
    this.configParser = ApibotConfigParser.getInstance();
    if (this.options.verbose) {
      process.env.DEBUG = 'apibot:*';
      setVerboseMode(true);
    }
  }

  async start(): Promise<void> {
    this.config = await this.configParser.loadConfig({ config: this.options.config, path: this.options.path });
    this.provider = new AIProvider(this.config.ai);
    await this.provider.validateConnection();

    this.apiClient = new ApiClient(this.config.api.baseEndpoint, this.config.api.headers || {}, {
      bootstrap: this.config.api.bootstrap,
      teardown: this.config.api.teardown,
    });
    await this.apiClient.bootstrap();

    const outputDir = this.configParser.getOutputDir();
    this.configParser.ensureDirectory(outputDir);
    this.requestState = new RequestStore(outputDir);
    this.reporter = new Reporter(this.config.reporter);

    validateSpecs(this.config.api.spec);
    this.apiSpec = await loadSpec(this.config.api.spec!, outputDir);
    tag('info').log('OpenAPI spec loaded');

    await this.healthCheck();
  }

  private async healthCheck(): Promise<void> {
    const baseUrl = this.config.api.baseEndpoint;
    const headers = this.config.api.headers || {};
    const headerSummary = Object.entries(headers)
      .map(([k, v]) => {
        const lower = k.toLowerCase();
        if (lower === 'authorization' || lower === 'x-api-key') return `${k}: ${v.slice(0, 12)}...`;
        return `${k}: ${v}`;
      })
      .join(', ');

    tag('info').log(`Connecting to ${baseUrl}`);
    if (headerSummary) tag('info').log(`Headers: ${headerSummary}`);

    const result = await this.apiClient.request({ method: 'GET', path: '/' });

    if (result.error) {
      tag('error').log(`Connection failed: ${result.error}`);
      throw new Error(`Cannot connect to ${baseUrl}: ${result.error}`);
    }

    tag('success').log(`Connected to ${baseUrl} (${result.status} ${result.statusText})`);
  }

  async stop(): Promise<void> {
    await this.reporter?.finishRun();
    await this.apiClient?.teardown();
  }

  createAgent<T>(factory: (deps: { ai: AIProvider; config: ApibotConfig; apiClient: ApiClient; requestState: RequestStore }) => T): T {
    return factory({
      ai: this.provider,
      config: this.config,
      apiClient: this.apiClient,
      requestState: this.requestState,
    });
  }

  agentChief(): Chief {
    return (this.agents.chief ||= this.createAgent(({ ai, config, apiClient }) => new Chief(ai, config, apiClient)));
  }

  agentCurler(): Curler {
    return (this.agents.curler ||= this.createAgent(({ ai, apiClient, requestState }) => new Curler(ai, apiClient, requestState, this.reporter)));
  }

  async plan(endpoint: string, opts: { style?: string; fresh?: boolean } = {}): Promise<Plan> {
    if (opts.fresh) {
      this.currentPlan = undefined;
      this.agents.chief = undefined;
    }

    const chief = this.agentChief();
    const specDefinition = this.getEndpointDefinition(endpoint);
    this.currentPlan = await chief.plan(endpoint, { style: opts.style, specDefinition });
    const savedPath = this.savePlan();
    if (savedPath) {
      tag('info').log(`Plan saved to: ${path.relative(process.cwd(), savedPath)}`);
    }
    return this.currentPlan;
  }

  loadPlan(filename: string): Plan {
    const plansDir = this.configParser.getPlansDir();
    let planPath = filename;

    if (!path.isAbsolute(filename)) {
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

  savePlan(filename?: string): string | null {
    if (!this.currentPlan) return null;

    const plansDir = this.configParser.getPlansDir();
    if (!existsSync(plansDir)) {
      mkdirSync(plansDir, { recursive: true });
    }

    const planFilename = filename || this.generatePlanFilename();
    const planPath = path.join(plansDir, planFilename);
    this.currentPlan.saveToMarkdown(planPath);
    return planPath;
  }

  getCurrentPlan(): Plan | undefined {
    return this.currentPlan;
  }

  getProvider(): AIProvider {
    return this.provider;
  }

  getConfig(): ApibotConfig {
    return this.config;
  }

  getConfigParser(): ApibotConfigParser {
    return this.configParser;
  }

  getRequestState(): RequestStore {
    return this.requestState;
  }

  getEndpointDefinition(endpoint: string): string {
    return extractEndpointDefinition(this.apiSpec, endpoint, this.config.api.baseEndpoint);
  }

  searchSpec(query: string): string {
    return searchEndpoints(this.apiSpec, query, this.config.api.baseEndpoint);
  }

  tryGetEndpointDefinition(endpoint: string): string | undefined {
    try {
      return this.getEndpointDefinition(endpoint);
    } catch (e) {
      tag('warning').log(e instanceof Error ? e.message : 'Could not extract spec for endpoint');
      return undefined;
    }
  }

  private generatePlanFilename(): string {
    const endpoint = this.currentPlan?.url || '/';
    const sanitized = endpoint.replace(/^\//, '').replace(/[^a-zA-Z0-9]/g, '_') || 'root';
    return `${sanitized.slice(0, 200)}.md`;
  }
}

interface ApibotOptions {
  verbose?: boolean;
  config?: string;
  path?: string;
}

export type { ApibotOptions };
