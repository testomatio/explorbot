import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { ExperienceTracker, type PageChange, type SessionExperienceEntry, type SessionStep } from '../experience-tracker.ts';
import type { Test, Task } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import type { Conversation } from './conversation.ts';
import type { Provider } from './provider.ts';

const debugLog = createDebug('explorbot:historian');

interface ToolExecution {
  toolName: string;
  input: any;
  output: any;
  wasSuccessful: boolean;
}

export class Historian {
  private provider: Provider;
  private experienceTracker: ExperienceTracker;

  constructor(provider: Provider, experienceTracker?: ExperienceTracker) {
    this.provider = provider;
    this.experienceTracker = experienceTracker || new ExperienceTracker();
  }

  async saveTestSession(task: Test, initialState: ActionResult, toolExecutions: ToolExecution[], conversation: Conversation): Promise<void> {
    debugLog('Saving test session experience');

    const steps = this.extractSteps(task, toolExecutions);
    const pageChanges = await this.buildPageChanges(task, toolExecutions);
    const result = this.determineResult(task);
    const nextStep = this.determineNextStep(task);

    const entry: SessionExperienceEntry = {
      timestamp: new Date().toISOString(),
      agent: 'tester',
      scenario: task.scenario,
      result,
      steps,
      pageChanges,
      nextStep,
    };

    this.experienceTracker.saveSessionExperience(initialState, entry);
    tag('substep').log(`Historian saved session for: ${task.scenario}`);
  }

  async saveCaptainSession(task: Task, initialState: ActionResult, toolExecutions: ToolExecution[], summary: string | null): Promise<void> {
    debugLog('Saving captain session experience');

    const steps = this.extractStepsFromTask(task, toolExecutions);
    const pageChanges = await this.buildPageChangesFromExecutions(toolExecutions, initialState.url || '');
    const result = this.determineCaptainResult(task, summary);

    const entry: SessionExperienceEntry = {
      timestamp: new Date().toISOString(),
      agent: 'captain',
      scenario: task.description,
      result,
      steps,
      pageChanges,
      nextStep: summary || undefined,
    };

    this.experienceTracker.saveSessionExperience(initialState, entry);
    tag('substep').log(`Historian saved captain session for: ${task.description}`);
  }

  private formatPageDiff(pageDiff: any): string | undefined {
    if (!pageDiff) return undefined;

    const parts: string[] = [];

    if (pageDiff.urlChanged && pageDiff.currentUrl) {
      parts.push(`Navigated to ${pageDiff.currentUrl}`);
    }

    if (pageDiff.ariaChanges) {
      parts.push(pageDiff.ariaChanges);
    } else if (pageDiff.htmlChanges) {
      parts.push(pageDiff.htmlChanges);
    }

    return parts.length > 0 ? parts.join('. ') : undefined;
  }

  private extractSteps(task: Test, toolExecutions: ToolExecution[]): SessionStep[] {
    const steps: SessionStep[] = [];
    const codeceptTools = ['click', 'clickByText', 'clickXY', 'type', 'select', 'form'];

    for (const exec of toolExecutions) {
      if (!codeceptTools.includes(exec.toolName)) continue;
      if (!exec.output?.code) continue;

      const message = exec.input?.explanation || `Executed ${exec.toolName}`;

      steps.push({
        message,
        status: exec.wasSuccessful ? 'passed' : 'failed',
        tool: exec.toolName,
        code: exec.output.code,
        pageChange: this.formatPageDiff(exec.output.pageDiff),
      });
    }

    return steps;
  }

  private extractStepsFromTask(task: Task, toolExecutions: ToolExecution[] = []): SessionStep[] {
    const steps: SessionStep[] = [];
    const codeceptTools = ['click', 'clickByText', 'clickXY', 'type', 'select', 'form'];

    for (const exec of toolExecutions) {
      if (!codeceptTools.includes(exec.toolName)) continue;
      if (!exec.output?.code) continue;

      const message = exec.input?.explanation || exec.input?.note || `Executed ${exec.toolName}`;

      steps.push({
        message,
        status: exec.wasSuccessful ? 'passed' : 'failed',
        tool: exec.toolName,
        code: exec.output.code,
        pageChange: this.formatPageDiff(exec.output.pageDiff),
      });
    }

    return steps;
  }

  private async buildPageChanges(task: Test, toolExecutions: ToolExecution[]): Promise<PageChange[]> {
    const changes: PageChange[] = [];
    let currentUrl = task.startUrl || '';
    let actions: string[] = [];

    for (const state of task.states) {
      if (state.url && state.url !== currentUrl) {
        if (actions.length > 0 || changes.length === 0) {
          const summary = await this.summarizePageActivity(currentUrl, actions);
          changes.push({ url: currentUrl, summary, actions: [...actions] });
        }
        currentUrl = state.url;
        actions = [];
      }
    }

    for (const exec of toolExecutions) {
      if (exec.wasSuccessful && exec.input?.explanation) {
        actions.push(exec.input.explanation);
      }
    }

    if (actions.length > 0 || changes.length === 0) {
      const summary = await this.summarizePageActivity(currentUrl, actions);
      changes.push({ url: currentUrl, summary, actions });
    }

    return changes;
  }

  private async buildPageChangesFromExecutions(toolExecutions: ToolExecution[], startUrl: string): Promise<PageChange[]> {
    const actions: string[] = [];

    for (const exec of toolExecutions) {
      if (exec.wasSuccessful && exec.input?.explanation) {
        actions.push(exec.input.explanation);
      }
    }

    if (actions.length === 0) {
      return [{ url: startUrl, summary: 'Initial page', actions: [] }];
    }

    const summary = await this.summarizePageActivity(startUrl, actions);
    return [{ url: startUrl, summary, actions }];
  }

  private async summarizePageActivity(url: string, actions: string[]): Promise<string> {
    if (actions.length === 0) return 'Initial page';

    const schema = z.object({
      summary: z.string().describe('One brief sentence describing key activity'),
    });

    const response = await this.provider.generateObject(
      [
        { role: 'system', content: 'Summarize test activity in one brief sentence.' },
        { role: 'user', content: `URL: ${url}\nActions: ${actions.slice(0, 10).join(', ')}` },
      ],
      schema
    );

    return response?.object?.summary || 'Page visited';
  }

  private determineResult(task: Test): 'success' | 'partial' | 'failed' {
    if (task.isSuccessful) return 'success';
    if (task.hasAchievedAny()) return 'partial';
    return 'failed';
  }

  private determineCaptainResult(task: Task, summary: string | null): 'success' | 'partial' | 'failed' {
    if (summary) return 'success';
    const hasPassedNotes = Object.values(task.notes).some((n) => n.status === 'passed');
    if (hasPassedNotes) return 'partial';
    return 'failed';
  }

  private determineNextStep(task: Test): string | undefined {
    const remaining = task.getRemainingExpectations();
    if (remaining.length > 0) {
      return `Continue checking: ${remaining.join(', ')}`;
    }
    return undefined;
  }
}
