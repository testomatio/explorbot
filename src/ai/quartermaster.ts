import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import type { Task } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import type { Conversation, ToolExecution } from './conversation.ts';
import type { Provider } from './provider.ts';
import { CODECEPT_TOOLS } from './tools.ts';

const debugLog = createDebug('explorbot:quartermaster');

interface UISuggestion {
  type: 'accessibility' | 'ux' | 'assumption';
  locator: string;
  element: string;
  issue: string;
  suggestion: string;
}

interface AnalysisReport {
  scenario: string;
  timestamp: string;
  suggestions: UISuggestion[];
}

export class Quartermaster {
  private provider: Provider;
  private enabled: boolean;
  private model?: string;
  private outputDir: string;

  constructor(provider: Provider, options?: { disabled?: boolean; model?: string }) {
    this.provider = provider;
    this.enabled = !(options?.disabled ?? false);
    this.model = options?.model;

    const configParser = ConfigParser.getInstance();
    this.outputDir = join(configParser.getOutputDir(), 'suggestions');

    if (this.enabled) {
      this.ensureDirectory();
    }
  }

  private ensureDirectory(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async analyzeSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<AnalysisReport | null> {
    if (!this.enabled) return null;

    try {
      const toolExecutions = conversation.getToolExecutions();
      const codeceptExecutions = toolExecutions.filter((e) => CODECEPT_TOOLS.includes(e.toolName as any));

      if (codeceptExecutions.length === 0) return null;

      const failedExecutions = codeceptExecutions.filter((e) => !e.wasSuccessful);
      if (failedExecutions.length === 0) {
        debugLog('No failed interactions to analyze');
        return null;
      }

      debugLog(`Analyzing ${failedExecutions.length} failed interactions`);

      const suggestions = await this.generateSuggestions(codeceptExecutions);
      if (suggestions.length === 0) return null;

      const report: AnalysisReport = {
        scenario: task.description,
        timestamp: new Date().toISOString(),
        suggestions,
      };

      const stateHash = initialState.getStateHash();
      try {
        this.saveReport(stateHash, report);
      } catch (error) {
        debugLog('Failed to save report:', error);
      }

      for (const suggestion of suggestions) {
        task.addNote(`💡 [${suggestion.locator}] ${suggestion.element}: ${suggestion.suggestion}`);
      }

      tag('substep').log(`Quartermaster: ${suggestions.length} UI suggestion(s)`);
      return report;
    } catch (error) {
      debugLog('Quartermaster analysis failed:', error);
      return null;
    }
  }

  private async generateSuggestions(executions: ToolExecution[]): Promise<UISuggestion[]> {
    const failedExecs = executions.filter((e) => !e.wasSuccessful);
    const successfulExecs = executions.filter((e) => e.wasSuccessful);

    const issues: Array<{ failed: ToolExecution; resolved?: ToolExecution }> = [];

    for (const failed of failedExecs) {
      const resolvedAfter = successfulExecs.find((s) => executions.indexOf(s) > executions.indexOf(failed) && this.isSimilarTarget(failed, s));
      issues.push({ failed, resolved: resolvedAfter });
    }

    if (issues.length === 0) return [];

    const issueDescriptions = issues.map((issue) => {
      const f = issue.failed;
      const locator = f.input?.locator || f.output?.locator || '';
      const html = f.output?.targetedHtml || '';
      const error = f.output?.message || 'Element not found';

      let desc = `Action: ${f.toolName}("${locator}")\nError: ${error}`;
      if (html) desc += `\nHTML context:\n${html.slice(0, 500)}`;
      if (issue.resolved) {
        const resolvedLocator = issue.resolved.input?.locator || issue.resolved.output?.locator || '';
        desc += `\nWorkaround used: ${issue.resolved.toolName}("${resolvedLocator}")`;
      }
      return desc;
    });

    const schema = z.object({
      suggestions: z.array(
        z.object({
          type: z.enum(['accessibility', 'ux', 'assumption']).describe('Type of issue'),
          locator: z.string().describe('The selector/locator that was used (e.g., "button Search", ".sticky-header button", "[aria-label=Search]")'),
          element: z.string().describe('Brief element description (e.g., "Search button", "Login form")'),
          issue: z.string().describe('What went wrong in one sentence'),
          suggestion: z.string().describe('Actionable improvement suggestion in one sentence'),
        })
      ),
    });

    const prompt = `Analyze these UI interaction failures and provide actionable suggestions for improving the web application.

## Failed Interactions
${issueDescriptions.join('\n\n---\n\n')}

For each issue, determine:
- **accessibility**: Element not findable due to missing ARIA, poor semantics, or structure
- **ux**: Element hidden, too small, covered by another element, or timing issues
- **assumption**: Expected content/message not present, wrong page title, missing feedback

Provide ONE clear, actionable suggestion per issue. Focus on what the UI developer should fix.
Examples of good suggestions:
- "Add aria-label to the search icon button for screen reader support"
- "Ensure the dropdown menu is visible before clicking menu items"
- "Display a confirmation message after form submission"`;

    const response = await this.provider.generateObject(
      [
        { role: 'system', content: 'You are a UI/UX expert providing actionable suggestions to improve web application usability and accessibility.' },
        { role: 'user', content: prompt },
      ],
      schema,
      this.model
    );

    return response?.object?.suggestions || [];
  }

  private isSimilarTarget(a: ToolExecution, b: ToolExecution): boolean {
    if (a.toolName !== b.toolName) return false;

    const normalizeLocator = (loc: string) => loc.toLowerCase().replace(/['"]/g, '');
    const locA = normalizeLocator(a.output?.locator || a.input?.locator || '');
    const locB = normalizeLocator(b.output?.locator || b.input?.locator || '');

    if (locA.includes(locB) || locB.includes(locA)) return true;

    const textA = (a.output?.targetedHtml || '').toLowerCase();
    const textB = (b.output?.targetedHtml || '').toLowerCase();
    if (textA && textB && (textA.includes(textB.slice(0, 50)) || textB.includes(textA.slice(0, 50)))) {
      return true;
    }

    return false;
  }

  private saveReport(stateHash: string, report: AnalysisReport): void {
    const filePath = join(this.outputDir, `${stateHash}.md`);
    const content = this.formatReportMarkdown(report);
    writeFileSync(filePath, content, 'utf8');
    debugLog(`Saved suggestions report to ${filePath}`);
  }

  private formatReportMarkdown(report: AnalysisReport): string {
    let content = `## UI Suggestions: ${report.scenario}\n\n`;
    content += `**Date**: ${report.timestamp}\n\n`;

    const byType = {
      accessibility: report.suggestions.filter((s) => s.type === 'accessibility'),
      ux: report.suggestions.filter((s) => s.type === 'ux'),
      assumption: report.suggestions.filter((s) => s.type === 'assumption'),
    };

    if (byType.accessibility.length > 0) {
      content += '### Accessibility\n\n';
      for (const s of byType.accessibility) {
        content += `- **${s.element}** \`${s.locator}\`: ${s.issue}\n  → ${s.suggestion}\n\n`;
      }
    }

    if (byType.ux.length > 0) {
      content += '### UX/Visibility\n\n';
      for (const s of byType.ux) {
        content += `- **${s.element}** \`${s.locator}\`: ${s.issue}\n  → ${s.suggestion}\n\n`;
      }
    }

    if (byType.assumption.length > 0) {
      content += '### Missing Feedback\n\n';
      for (const s of byType.assumption) {
        content += `- **${s.element}** \`${s.locator}\`: ${s.issue}\n  → ${s.suggestion}\n\n`;
      }
    }

    return content;
  }
}
