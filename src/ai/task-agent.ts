import dedent from 'dedent';
import type { ActionResult } from '../action-result.js';
import { ConfigParser } from '../config.js';
import type { ExperienceTracker } from '../experience-tracker.js';
import type { KnowledgeTracker } from '../knowledge-tracker.js';
import { pluralize, tag } from '../utils/logger.js';
import { pause } from '../utils/loop.js';
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
  protected consecutiveNonActionCalls = 0;
  protected recentFailedExecutions: any[] = [];
  protected recentToolCalls: any[] = [];
  protected readonly FAILURE_THRESHOLD = 5;
  protected readonly NON_ACTION_THRESHOLD = 5;
  protected readonly PROGRESS_CHECK_INTERVAL = 5;
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
    const relevantExperience = this.getExperienceTracker().getRelevantExperience(actionResult);

    if (relevantExperience.length === 0) return '';

    const experienceContent = relevantExperience
      .map((e) => e.content)
      .filter((e) => !!e)
      .join('\n\n---\n\n');

    tag('substep').log(`Found ${relevantExperience.length} experience ${pluralize(relevantExperience.length, 'file')}`);
    return dedent`
      <experience>
      Here is past experience of interacting with this page.
      Use successful solutions first. Avoid repeating failed actions.

      ${experienceContent}
      </experience>
    `;
  }

  protected getHistorian(): Historian {
    if (this._historian) return this._historian;

    const config = ConfigParser.getInstance().getConfig().ai?.agents?.historian;
    if (config?.enabled === false) {
      return createNullProxy<Historian>();
    }

    this._historian = new Historian(this.getProvider(), this.getExperienceTracker());
    return this._historian;
  }

  setQuartermaster(quartermaster: Quartermaster): void {
    this._quartermaster = quartermaster;
  }

  protected getQuartermaster(): Quartermaster {
    if (this._quartermaster) return this._quartermaster;
    return createNullProxy<Quartermaster>();
  }

  protected trackToolExecutions(toolExecutions: any[]): void {
    const failedActions = toolExecutions.filter((e) => !e.wasSuccessful && this.ACTION_TOOLS.includes(e.toolName));
    const successActions = toolExecutions.filter((e) => e.wasSuccessful && this.ACTION_TOOLS.includes(e.toolName));
    const hasAnyActionTool = toolExecutions.some((e) => this.ACTION_TOOLS.includes(e.toolName));

    if (hasAnyActionTool) {
      this.consecutiveNonActionCalls = 0;
      this.recentToolCalls.push(...toolExecutions);
      if (this.recentToolCalls.length > 20) {
        this.recentToolCalls = this.recentToolCalls.slice(-20);
      }
    } else if (toolExecutions.length > 0) {
      this.consecutiveNonActionCalls += toolExecutions.length;
    }

    if (failedActions.length > 0) {
      this.consecutiveFailures += failedActions.length;
      this.recentFailedExecutions.push(...failedActions);
      if (this.recentFailedExecutions.length > 10) {
        this.recentFailedExecutions = this.recentFailedExecutions.slice(-10);
      }
    }
    if (successActions.length > 0) {
      this.consecutiveFailures = 0;
      this.recentFailedExecutions = [];
    }
  }

  protected shouldAskUser(): boolean {
    if (!isInteractive()) return false;
    return this.consecutiveFailures >= this.FAILURE_THRESHOLD || this.consecutiveNonActionCalls >= this.NON_ACTION_THRESHOLD;
  }

  protected isStuckWithoutActions(): boolean {
    return this.consecutiveNonActionCalls >= this.NON_ACTION_THRESHOLD;
  }

  protected shouldAnalyzeProgress(iteration: number): boolean {
    if (this.isStuckWithoutActions()) return true;
    if (this.consecutiveFailures >= 3) return true;
    return iteration > 1 && iteration % this.PROGRESS_CHECK_INTERVAL === 0;
  }

  protected async handleUserHelp(context: string, actionResult: ActionResult, conversation: any): Promise<void> {
    if (!this.shouldAskUser()) return;

    const userHelp = await this.askUserForHelp(context);

    this.consecutiveFailures = 0;
    this.consecutiveNonActionCalls = 0;
    this.recentFailedExecutions = [];

    if (!userHelp) return;

    const success = await this.executeUserSuggestion(actionResult, context, userHelp);
    if (!success) {
      this.injectUserHelpToConversation(conversation, userHelp);
    }
  }

  protected async askUserForHelp(context: string): Promise<string | null> {
    if (!isInteractive()) return null;

    let prompt: string;

    if (this.isStuckWithoutActions()) {
      prompt = `Stuck: Not making progress on "${context}"\n\nAI is not performing any actions. How should I proceed? (enter to skip):`;
    } else {
      const purposes = [...new Set(this.recentFailedExecutions.map((t) => t.input?.explanation).filter(Boolean))];
      const purpose = purposes[0] || context;

      const attempts = this.recentFailedExecutions.map((t) => {
        const locator = t.input?.locator || t.input?.text || t.input?.codeBlock || t.input?.commands?.[0] || t.input?.explanation || 'unknown';
        return `  - ${t.toolName}: ${typeof locator === 'object' ? JSON.stringify(locator) : locator}`;
      });

      if (attempts.length > 0) {
        prompt = `Failed to ${purpose}\n\nTried:\n${attempts.join('\n')}\n\nWhat should I try? (enter to skip):`;
      } else {
        prompt = `${context}\nWhat should I try? (enter to skip):`;
      }
    }

    const userInput = await pause(prompt);

    if (!userInput) return null;
    return userInput;
  }

  protected async executeUserSuggestion(actionResult: ActionResult, originalIntent: string, userInput: string): Promise<boolean> {
    tag('info').log(`Trying user suggestion: ${userInput}`);

    const success = await this.getNavigator().resolveState(userInput, actionResult);

    if (success) {
      tag('success').log('User suggestion worked!');
      await this.getExperienceTracker().saveSuccessfulResolution(actionResult, originalIntent, userInput, 'User-provided solution');
      this.consecutiveFailures = 0;
      return true;
    }

    tag('warning').log('User suggestion did not succeed');
    return false;
  }

  protected injectUserHelpToConversation(conversation: any, userInput: string): void {
    conversation.addUserText(`<user_help>User suggestion: ${userInput}</user_help>\nTry the user's suggestion using interact() tool.`);
  }

  protected resetFailureCount(): void {
    this.consecutiveFailures = 0;
    this.consecutiveNonActionCalls = 0;
    this.recentFailedExecutions = [];
    this.recentToolCalls = [];
  }
}
