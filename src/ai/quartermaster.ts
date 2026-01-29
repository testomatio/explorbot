import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { ConfigParser } from '../config.ts';
import type { StateManager, StateTransition, WebPageState } from '../state-manager.ts';
import type { Task } from '../test-plan.ts';
import { createDebug, tag } from '../utils/logger.ts';
import type { Conversation, ToolExecution } from './conversation.ts';
import type { Provider } from './provider.ts';
import { CODECEPT_TOOLS } from './tools.ts';

const debugLog = createDebug('explorbot:quartermaster');

interface AxeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor';
  description: string;
  helpUrl: string;
  nodes: Array<{ html: string; target: string[] }>;
}

interface PageAnalysis {
  url: string;
  stateHash: string;
  timestamp: string;
  axeViolations: AxeViolation[];
}

interface SemanticIssue {
  type: 'unclear_intention' | 'confusing_naming' | 'hard_to_interact';
  element: string;
  issue: string;
  suggestion: string;
}

interface AnalysisReport {
  scenario: string;
  timestamp: string;
  url: string;
  axeViolations: AxeViolation[];
  semanticIssues: SemanticIssue[];
}

export class Quartermaster {
  private provider: Provider;
  private model?: string;
  private outputDir: string;
  private pageAnalyses: Map<string, PageAnalysis> = new Map();
  private unsubscribe: (() => void) | null = null;
  private playwrightHelper: any = null;
  private pendingAnalyses: Promise<void>[] = [];

  constructor(provider: Provider, options?: { model?: string }) {
    this.provider = provider;
    this.model = options?.model;

    const configParser = ConfigParser.getInstance();
    this.outputDir = join(configParser.getOutputDir(), 'a11y');
  }

  start(playwrightHelper: any, stateManager: StateManager): void {
    this.playwrightHelper = playwrightHelper;
    this.ensureDirectory();

    this.unsubscribe = stateManager.onStateChange((event) => {
      this.onPageChange(event);
    });

    debugLog('Quartermaster started, listening for page changes');
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    debugLog('Quartermaster stopped');
  }

  private ensureDirectory(): void {
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
  }

  private onPageChange(event: StateTransition): void {
    const state = event.toState;
    if (!state?.hash) return;
    if (this.pageAnalyses.has(state.hash)) return;

    const analysisPromise = this.runAxeAnalysis(state).catch((err) => {
      debugLog('Axe analysis failed:', err);
    });

    this.pendingAnalyses.push(analysisPromise);
  }

  private async runAxeAnalysis(state: WebPageState): Promise<void> {
    const page = this.playwrightHelper?.page;
    if (!page || !state.hash) {
      debugLog('No page available for axe analysis');
      return;
    }

    try {
      const { AxeBuilder } = await import('@axe-core/playwright');
      const results = await new AxeBuilder({ page }).analyze();

      const violations: AxeViolation[] = results.violations.map((v) => ({
        id: v.id,
        impact: v.impact as AxeViolation['impact'],
        description: v.description,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          target: n.target as string[],
        })),
      }));

      this.pageAnalyses.set(state.hash, {
        url: state.url,
        stateHash: state.hash,
        timestamp: new Date().toISOString(),
        axeViolations: violations,
      });

      debugLog(`Axe analysis complete for ${state.url}: ${violations.length} violations`);
    } catch (error) {
      debugLog('Axe analysis error:', error);
    }
  }

  async analyzeSession(task: Task, initialState: ActionResult, conversation: Conversation): Promise<AnalysisReport | null> {
    await Promise.all(this.pendingAnalyses);
    this.pendingAnalyses = [];

    try {
      const stateHash = initialState.getStateHash();
      const pageAnalysis = this.pageAnalyses.get(stateHash);

      const toolExecutions = conversation.getToolExecutions();
      const codeceptExecutions = toolExecutions.filter((e) => CODECEPT_TOOLS.includes(e.toolName as any));

      if (codeceptExecutions.length === 0 && !pageAnalysis?.axeViolations.length) {
        debugLog('No interactions or violations to analyze');
        return null;
      }

      const axeViolations = pageAnalysis?.axeViolations || [];
      const semanticIssues = await this.generateSemanticAnalysis(axeViolations, codeceptExecutions, initialState);

      if (axeViolations.length === 0 && semanticIssues.length === 0) {
        debugLog('No issues found');
        return null;
      }

      const report: AnalysisReport = {
        scenario: task.description,
        timestamp: new Date().toISOString(),
        url: initialState.url || '',
        axeViolations,
        semanticIssues,
      };

      this.saveReport(stateHash, report);
      this.addNotesToTask(task, report);

      tag('substep').log(`Quartermaster: ${axeViolations.length} technical + ${semanticIssues.length} semantic issues`);
      return report;
    } catch (error) {
      debugLog('Quartermaster analysis failed:', error);
      return null;
    }
  }

  private async generateSemanticAnalysis(axeViolations: AxeViolation[], executions: ToolExecution[], initialState: ActionResult): Promise<SemanticIssue[]> {
    const failedExecs = executions.filter((e) => !e.wasSuccessful);
    if (failedExecs.length === 0 && axeViolations.length === 0) return [];

    const axeSummary = axeViolations
      .slice(0, 10)
      .map((v) => `[${v.impact}] ${v.id}: ${v.description}`)
      .join('\n');

    const failedActions = failedExecs
      .slice(0, 10)
      .map((e) => {
        const locator = e.input?.locator || e.output?.locator || '';
        const error = e.output?.message || 'Failed';
        return `${e.toolName}("${locator}"): ${error}`;
      })
      .join('\n');

    const ariaSnapshot = initialState.ariaSnapshot?.slice(0, 3000) || '';

    const schema = z.object({
      issues: z.array(
        z.object({
          type: z.enum(['unclear_intention', 'confusing_naming', 'hard_to_interact']).describe('Type of semantic issue'),
          element: z.string().describe('Brief element description'),
          issue: z.string().describe('What is confusing or problematic'),
          suggestion: z.string().describe('Actionable improvement suggestion'),
        })
      ),
    });

    const prompt = `Analyze this page for semantic UX issues that automated tools cannot detect.

## Technical Violations (axe-core)
${axeSummary || 'None'}

## Failed Agent Interactions
${failedActions || 'None'}

## Page Structure (ARIA)
${ariaSnapshot}

Focus on issues that require human judgment:
- **unclear_intention**: Button/link text doesn't match actual behavior
- **confusing_naming**: Ambiguous labels, inconsistent terminology
- **hard_to_interact**: Controls requiring non-obvious sequences

Provide 0-5 high-signal issues. Skip obvious technical violations already covered by axe-core.
Focus on what would confuse a real user or caused the agent to make mistakes.`;

    const response = await this.provider.generateObject(
      [
        { role: 'system', content: 'You are a UX expert analyzing pages for semantic issues that confuse users.' },
        { role: 'user', content: prompt },
      ],
      schema,
      this.model
    );

    return response?.object?.issues || [];
  }

  private addNotesToTask(task: Task, report: AnalysisReport): void {
    const criticalViolations = report.axeViolations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    for (const v of criticalViolations.slice(0, 3)) {
      task.addNote(`🔴 A11Y [${v.impact}] ${v.id}: ${v.description}`);
    }

    for (const issue of report.semanticIssues.slice(0, 3)) {
      task.addNote(`💡 UX [${issue.type}] ${issue.element}: ${issue.suggestion}`);
    }
  }

  private saveReport(stateHash: string, report: AnalysisReport): void {
    const filePath = join(this.outputDir, `${stateHash}.md`);
    const content = this.formatReportMarkdown(report);
    writeFileSync(filePath, content, 'utf8');
    debugLog(`Saved a11y report to ${filePath}`);
  }

  private formatReportMarkdown(report: AnalysisReport): string {
    let content = `## A11Y Analysis: ${report.url}\n\n`;
    content += `**Scenario**: ${report.scenario}\n`;
    content += `**Date**: ${report.timestamp}\n\n`;

    if (report.axeViolations.length > 0) {
      content += '### Technical Violations (axe-core)\n\n';
      for (const v of report.axeViolations) {
        content += `- [${v.impact}] **${v.id}**: ${v.description}\n`;
        content += `  [Learn more](${v.helpUrl})\n`;
        for (const node of v.nodes.slice(0, 2)) {
          content += `  - \`${node.target.join(' > ')}\`\n`;
        }
        content += '\n';
      }
    }

    if (report.semanticIssues.length > 0) {
      content += '### Semantic Issues (LLM analysis)\n\n';
      for (const issue of report.semanticIssues) {
        content += `- **${issue.type}** - ${issue.element}\n`;
        content += `  Issue: ${issue.issue}\n`;
        content += `  → ${issue.suggestion}\n\n`;
      }
    }

    return content;
  }
}
