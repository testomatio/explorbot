import type { ActionResult } from '../action-result.js';
import type { ExplorbotConfig } from '../config.ts';
import type { ExperienceTracker } from '../experience-tracker.js';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.js';
import type { StateManager } from '../state-manager.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import type { AgentDeps, ToolDeps } from './agent.ts';
import { Historian } from './historian.js';
import type { Navigator } from './navigator.js';
import type { Provider } from './provider.js';
import { Quartermaster } from './quartermaster.js';

export function isInteractive(): boolean {
  return process.env.INK_RUNNING === 'true';
}

function createNullProxy<T extends object>(): T {
  return new Proxy({} as T, {
    get: () => async () => {},
  });
}

export abstract class TaskAgent {
  explorer!: Explorer;
  provider!: Provider;
  config!: ExplorbotConfig;
  stateManager!: StateManager;
  knowledgeTracker!: KnowledgeTracker;
  protected hooksRunner!: HooksRunner;
  protected consecutiveFailures = 0;
  protected consecutiveEmptyResults = 0;
  protected recentToolCalls: any[] = [];
  protected readonly ACTION_TOOLS: string[] = [];

  private _historian: Historian | null = null;
  private _quartermaster: Quartermaster | null = null;

  constructor(deps?: AgentDeps) {
    if (!deps) return;
    this.explorer = deps.explorer;
    this.provider = deps.ai;
    this.config = deps.config;
    this.stateManager = deps.stateManager;
    this.knowledgeTracker = deps.knowledgeTracker;
    this.hooksRunner = new HooksRunner(deps.explorer, deps.config);
  }

  setHistorian(historian: Historian): void {
    this._historian = historian;
  }

  setQuartermaster(quartermaster: Quartermaster): void {
    this._quartermaster = quartermaster;
  }

  protected abstract getNavigator(): Navigator;

  protected get toolDeps(): ToolDeps {
    return { explorer: this.explorer, stateManager: this.stateManager, ai: this.provider };
  }

  protected getExperienceTracker(): ExperienceTracker {
    return this.stateManager.getExperienceTracker();
  }

  protected getKnowledgeTracker(): KnowledgeTracker {
    return this.knowledgeTracker;
  }

  protected getProvider(): Provider {
    return this.provider;
  }

  protected getKnowledge(actionResult: ActionResult): string {
    return this.getKnowledgeTracker().renderRelevantKnowledge(actionResult);
  }

  protected getExperience(actionResult: ActionResult): string {
    return this.getExperienceTracker().renderExperienceTocFor(actionResult);
  }

  protected getHistorian(): Historian {
    if (this._historian) return this._historian;
    return createNullProxy<Historian>();
  }

  protected getQuartermaster(): Quartermaster {
    if (this._quartermaster) return this._quartermaster;
    return createNullProxy<Quartermaster>();
  }

  protected trackToolExecutions(toolExecutions: any[]): void {
    if (toolExecutions.length === 0) {
      this.consecutiveEmptyResults++;
      return;
    }
    this.consecutiveEmptyResults = 0;

    const failedActions = toolExecutions.filter((e) => !e.wasSuccessful && this.ACTION_TOOLS.includes(e.toolName));
    const successActions = toolExecutions.filter((e) => e.wasSuccessful && this.ACTION_TOOLS.includes(e.toolName));
    const hasAnyActionTool = toolExecutions.some((e) => this.ACTION_TOOLS.includes(e.toolName));

    if (hasAnyActionTool) {
      this.recentToolCalls.push(...toolExecutions);
      if (this.recentToolCalls.length > 20) {
        this.recentToolCalls = this.recentToolCalls.slice(-20);
      }
    }

    if (failedActions.length > 0) {
      this.consecutiveFailures += failedActions.length;
    }
    if (successActions.length > 0) {
      this.consecutiveFailures = 0;
    }
  }

  protected resetFailureCount(): void {
    this.consecutiveFailures = 0;
    this.consecutiveEmptyResults = 0;
    this.recentToolCalls = [];
  }
}
