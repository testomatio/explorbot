import type { ActionResult } from '../action-result.js';
import type { ExplorbotConfig } from '../config.ts';
import { executionController } from '../execution-controller.ts';
import { renderExperienceToc, type ExperienceTracker, type ExperienceTocEntry } from '../experience-tracker.js';
import type Explorer from '../explorer.ts';
import type { KnowledgeTracker } from '../knowledge-tracker.js';
import type { StateManager } from '../state-manager.ts';
import { HooksRunner } from '../utils/hooks-runner.ts';
import type { AgentDeps, ToolDeps } from './agent.ts';
import { Historian } from './historian.js';
import type { Judge, JudgeQuestion } from './judge.ts';
import type { Navigator } from './navigator.js';
import type { Provider } from './provider.js';
import { Quartermaster } from './quartermaster.js';

const EXPERIENCE_CONFIDENCE = 0.7;
const EXPERIENCE_BLOCK_CAP = 600;
const EXPERIENCE_PAGE_CAP = 12000;

export function isInteractive(): boolean {
  if (process.env.INK_RUNNING === 'true') return true;
  return executionController.hasInputCallback();
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
  protected judge?: Judge;
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
    this.judge = deps.judge;
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
    return { explorer: this.explorer, stateManager: this.stateManager, ai: this.provider, judge: this.judge };
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
    return this.getKnowledgeTracker().renderRelevantContext(actionResult);
  }

  protected async getExperience(actionResult: ActionResult): Promise<string> {
    const toc = this.getExperienceTracker().getExperienceTableOfContents(actionResult);
    if (toc.length === 0) return '';

    const blocks = toc.map(renderTocEntryBlock);
    const page = actionResult.getCompactARIA().slice(0, EXPERIENCE_PAGE_CAP);
    const kept = await filterExperienceBlocks(this.judge, blocks, page);
    const keptBlocks = new Set(kept);
    const filteredToc = toc.filter((_, index) => keptBlocks.has(blocks[index]));

    return renderExperienceToc(filteredToc);
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

export async function filterExperienceBlocks(judge: Judge | undefined, blocks: string[], page: string): Promise<string[]> {
  if (!judge?.directEnabled) return blocks;
  if (blocks.length < 2) return blocks;

  const questions: Record<string, JudgeQuestion> = {};
  blocks.forEach((block, index) => {
    questions[`b${index}`] = { instructions: `Does this recorded note apply to the current page? Note: ${block.slice(0, EXPERIENCE_BLOCK_CAP)}` };
  });

  const answers = await judge.ask({ page }, questions);
  if (!answers) return blocks;

  return blocks.filter((_, index) => {
    const answer = answers[`b${index}`];
    if (!answer) return true;
    if (answer.answer !== 'no') return true;
    return answer.confidence < EXPERIENCE_CONFIDENCE;
  });
}

function renderTocEntryBlock(entry: ExperienceTocEntry): string {
  const titles = entry.sections.map((section) => section.title).join('; ');
  return `${entry.url}: ${titles}`;
}
