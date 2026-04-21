import dedent from 'dedent';
import type { ActionResult } from '../action-result.js';
import { type ExperienceTracker, renderExperienceToc } from '../experience-tracker.js';
import type { KnowledgeTracker } from '../knowledge-tracker.js';
import { createDebug, pluralize, tag } from '../utils/logger.js';

const debugLog = createDebug('explorbot:task-agent');
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
  protected abstract readonly ACTION_TOOLS: string[];

  private _historian: Historian | null = null;
  private _quartermaster: Quartermaster | null = null;

  protected abstract getNavigator(): Navigator;
  protected abstract getExperienceTracker(): ExperienceTracker;
  protected abstract getKnowledgeTracker(): KnowledgeTracker;
  protected abstract getProvider(): Provider;

  protected getKnowledge(actionResult: ActionResult): string {
    const knowledgeFiles = this.getKnowledgeTracker().getRelevantKnowledge(actionResult);

    if (knowledgeFiles.length === 0) return '';

    const knowledgeContent = knowledgeFiles
      .map((k) => k.content)
      .filter((k) => !!k)
      .join('\n\n');

    tag('substep').log(`Found ${knowledgeFiles.length} relevant knowledge ${pluralize(knowledgeFiles.length, 'file')}`);
    return dedent`
      <knowledge>
      Here is relevant knowledge for this page:

      ${knowledgeContent}
      </knowledge>
    `;
  }

  protected getExperience(actionResult: ActionResult): string {
    const tracker = this.getExperienceTracker();
    const toc = tracker.getExperienceTableOfContents(actionResult);
    if (toc.length === 0) return '';

    const totalSections = toc.reduce((sum, entry) => sum + entry.sections.length, 0);
    debugLog(`injecting experience TOC (${toc.length} files, ${totalSections} sections)`);
    tag('substep').log(`Found ${toc.length} experience ${pluralize(toc.length, 'file')} (${totalSections} sections)`);
    return renderExperienceToc(toc);
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
