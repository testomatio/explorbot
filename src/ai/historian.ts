import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { ExperienceTracker, type PageChange, type SessionExperienceEntry, type SessionStep } from '../experience-tracker.ts';
import type { Task } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import type { Conversation, ToolExecution } from './conversation.ts';
import type { Provider } from './provider.ts';
import { CODECEPT_TOOLS } from './tools.ts';

const debugLog = createDebug('explorbot:historian');

export class Historian {
  private provider: Provider;
  private experienceTracker: ExperienceTracker;

  constructor(provider: Provider, experienceTracker?: ExperienceTracker) {
    this.provider = provider;
    this.experienceTracker = experienceTracker || new ExperienceTracker();
  }

  async saveSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<void> {
    debugLog('Saving session experience');

    const toolExecutions = conversation.getToolExecutions();
    const steps = this.extractSteps(toolExecutions);
    const pageChanges = await this.buildPageChanges(toolExecutions, initialState.url || '');
    const result = this.determineResult(task);
    const nextStep = this.determineNextStep(task);

    const entry: SessionExperienceEntry = {
      timestamp: new Date().toISOString(),
      agent: 'scenario' in task ? 'tester' : 'captain',
      scenario: task.description,
      result,
      steps,
      pageChanges,
      nextStep,
    };

    this.experienceTracker.saveSessionExperience(initialState, entry);
    tag('substep').log(`Historian saved session for: ${task.description}`);
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

  private extractSteps(toolExecutions: ToolExecution[]): SessionStep[] {
    const steps: SessionStep[] = [];

    for (const exec of toolExecutions) {
      if (!CODECEPT_TOOLS.includes(exec.toolName as any)) continue;
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

  private async buildPageChanges(toolExecutions: ToolExecution[], startUrl: string): Promise<PageChange[]> {
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

  private determineResult(task: Task): 'success' | 'partial' | 'failed' {
    if ('isSuccessful' in task && (task as any).isSuccessful) return 'success';
    if ('hasAchievedAny' in task && (task as any).hasAchievedAny()) return 'partial';

    const hasPassedNotes = Object.values(task.notes).some((n) => n.status === 'passed');
    if (hasPassedNotes) return 'partial';
    return 'failed';
  }

  private determineNextStep(task: Task): string | undefined {
    if (!('getRemainingExpectations' in task)) return undefined;

    const remaining = (task as any).getRemainingExpectations();
    if (remaining.length > 0) {
      return `Continue checking: ${remaining.join(', ')}`;
    }
    return undefined;
  }

  toCode(conversation: Conversation, scenario: string): string {
    const toolExecutions = conversation.getToolExecutions();
    const successfulSteps = toolExecutions.filter((exec) => exec.wasSuccessful && CODECEPT_TOOLS.includes(exec.toolName as any) && exec.output?.code);

    if (successfulSteps.length === 0) {
      return '';
    }

    const lines: string[] = [];
    lines.push(`// Test: ${scenario}`);
    lines.push(`Scenario('${this.escapeString(scenario)}', ({ I }) => {`);

    for (const exec of successfulSteps) {
      const comment = exec.input?.explanation || exec.input?.note;
      if (comment) {
        lines.push(`  // ${comment}`);
      }
      lines.push(`  ${exec.output.code}`);
    }

    lines.push('});');
    return lines.join('\n');
  }

  private escapeString(str: string): string {
    return str.replace(/'/g, "\\'").replace(/\n/g, ' ');
  }
}
