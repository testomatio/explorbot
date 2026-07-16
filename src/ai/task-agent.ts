import type { ActionResult } from '../action-result.js';
import type { ExperienceTracker } from '../experience-tracker.js';
import type { KnowledgeTracker } from '../knowledge-tracker.js';
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
  protected consecutiveFailures = 0;
  protected consecutiveEmptyResults = 0;
  protected recentToolCalls: any[] = [];
  protected readonly ACTION_TOOLS: string[] = [];

  private _historian: Historian | null = null;
  private _quartermaster: Quartermaster | null = null;

  protected abstract getNavigator(): Navigator;
  protected abstract getExperienceTracker(): ExperienceTracker;
  protected abstract getKnowledgeTracker(): KnowledgeTracker;
  protected abstract getProvider(): Provider;

  protected getKnowledge(actionResult: ActionResult): string {
    return this.getKnowledgeTracker().renderRelevantKnowledge(actionResult);
  }

  protected getExperience(actionResult: ActionResult): string {
    return this.getExperienceTracker().renderExperienceTocFor(actionResult);
  }

  setHistorian(historian: Historian): void {
    this._historian = historian;
  }

  protected getHistorian(): Historian {
    if (this._historian) return this._historian;
    return createNullProxy<Historian>();
  }

  setQuartermaster(quartermaster: Quartermaster): void {
    this._quartermaster = quartermaster;
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
