import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dedent from 'dedent';
import type { Locator, Page } from 'playwright';
import { z } from 'zod';
import type { ActionResult } from '../action-result.ts';
import { outputPath } from '../config.ts';
import type Explorer from '../explorer.ts';
import type { StateManager, StateTransition, WebPageState } from '../state-manager.ts';
import type { Task } from '../test-plan.ts';
import { ariaRefSelector, ariaRefSnapshot, parseAriaRefs } from '../utils/aria-ref.ts';
import { compactAriaSnapshot } from '../utils/aria.ts';
import { createDebug, tag } from '../utils/logger.ts';
import { RulesLoader } from '../utils/rules-loader.ts';
import { isCodeceptToolName } from '../utils/step-analyzer.ts';
import { UX_FOCUS_ATTR, type UxMeasurements, countRunningAnimations, measureUx, renderUxMeasurements, uxProbeArgs } from '../utils/ux-probe.ts';
import type { Conversation, ToolExecution } from './conversation.ts';
import type { Provider } from './provider.ts';

const debugLog = createDebug('explorbot:quartermaster');

const UX_RULES = ['ux/accessibility', 'ux/interaction', 'ux/responsive', 'ux/navigation', 'ux/copy', 'ux/forms', 'ux/readability', 'ux/motion', 'ux/charts'];
const UX_BREAKPOINTS = [768, 375];
const UX_FOCUS_SELECTOR = `[${UX_FOCUS_ATTR}]`;
const UX_SETTLE_MS = 400;
const UX_ARIA_CAP = 8000;
const UX_SCREENSHOT_TIMEOUT = 5000;
const UX_MAX_FINDINGS = 6;
const AGENT_NAME = 'quartermaster';
const FOCUS_CONTAINER_ROLES = ['main', 'region', 'form', 'dialog', 'alertdialog', 'navigation', 'complementary', 'article', 'table', 'grid', 'tabpanel', 'list', 'group', 'banner', 'contentinfo', 'search'];

export class Quartermaster {
  private provider: Provider;
  private model?: any;
  private outputDir: string;
  private pageAnalyses: Map<string, PageAnalysis> = new Map();
  private unsubscribe: (() => void) | null = null;
  private explorer: Explorer;
  private pendingAnalyses: Promise<void>[] = [];

  constructor(provider: Provider, explorer: Explorer, options?: { model?: any }) {
    this.provider = provider;
    this.explorer = explorer;
    this.model = options?.model;

    this.outputDir = outputPath('a11y');
  }

  start(stateManager: StateManager): void {
    if (this.unsubscribe) return;
    mkdirSync(this.outputDir, { recursive: true });

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
    const page = this.explorer.page;
    if (!page || !state.hash) {
      debugLog('No page available for axe analysis');
      return;
    }

    try {
      const violations = await this.axeViolations(page);

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
      const codeceptExecutions = toolExecutions.filter((e) => isCodeceptToolName(e.toolName));

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

  async auditUx(result: ActionResult, context: UxAuditContext): Promise<string> {
    const focus = await this.markUxFocus(result, context);
    tag('step').log(`Auditing UX of ${focus.area}`);

    try {
      const evidence = await this.explorer.withPage((page) => this.collectUxEvidence(page));
      return await this.writeUxReport(result, focus, evidence, context);
    } finally {
      await this.explorer
        .withPage((page) =>
          page.evaluate((attr) => {
            for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) el.removeAttribute(attr);
          }, UX_FOCUS_ATTR)
        )
        .catch(() => {});
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

    const ariaSnapshot = initialState.getCompactARIA().slice(0, 3000);

    const schema = z.object({
      issues: z.array(
        z.object({
          type: z.enum(['unclear_intention', 'confusing_naming', 'hard_to_interact']).describe('Type of semantic issue'),
          element: z.string().describe('Short element identifier: tag with key attributes, e.g. <button class="nav-toggle"> or <a href="/login" role="link">'),
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
      const nodeHtml = v.nodes[0]?.html.slice(0, 100) || '';
      task.addVerificationDetail(`🔴 A11Y [${v.impact}] ${v.id}: ${v.description} — ${nodeHtml}`);
    }

    for (const issue of report.semanticIssues.slice(0, 3)) {
      task.addVerificationDetail(`💡 UX [${issue.type}] ${issue.element}: ${issue.suggestion}`);
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
          content += `  - \`${node.target.join(' > ')}\` — \`${node.html.slice(0, 100)}\`\n`;
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

  private async axeViolations(page: Page, include?: string): Promise<AxeViolation[]> {
    const { AxeBuilder } = await import('@axe-core/playwright');
    let builder = new AxeBuilder({ page });
    if (include) builder = builder.include(include);
    const results = await builder.analyze();

    return results.violations.map((v) => ({
      id: v.id,
      impact: v.impact as AxeViolation['impact'],
      description: v.description,
      helpUrl: v.helpUrl,
      nodes: v.nodes.map((n) => ({
        html: n.html,
        target: n.target as string[],
      })),
    }));
  }

  private async markUxFocus(result: ActionResult, context: UxAuditContext): Promise<UxFocus> {
    const mark = (locator: Locator) =>
      locator
        .first()
        .evaluate((el, attr) => el.setAttribute(attr, ''), UX_FOCUS_ATTR)
        .then(() => true)
        .catch(() => false);

    const region = result.overlay;
    const locateRegion = (page: Page) => {
      if (region.root) return page.locator(region.root);
      if (region.xpath) return page.locator(`xpath=${region.xpath}`);
      const name = region.name || undefined;
      return page.getByRole('dialog', { name }).or(page.getByRole('alertdialog', { name }));
    };
    const regionFocus = { area: region.name || `open ${region.type}`, reason: `it is the ${region.type} open on the page` };

    if (!context.focus && region.isOpen && (await this.explorer.withPage((page) => mark(locateRegion(page))))) return regionFocus;

    if (context.focus || context.commands.length) {
      const picked = await this.pickUxFocus(context, mark);
      if (picked) return picked;
    }

    if (region.isOpen && (await this.explorer.withPage((page) => mark(locateRegion(page))))) return regionFocus;

    let reason = 'nothing narrower is open or was touched by the session on this page';
    if (context.focus) reason = `"${context.focus}" matched no single container`;
    return this.explorer.withPage(async (page) => {
      if (await mark(page.locator('main, [role="main"]'))) return { area: 'main content', reason };
      await mark(page.locator('body'));
      return { area: 'whole page', reason: `${reason} and the page has no main landmark` };
    });
  }

  private async pickUxFocus(context: UxAuditContext, mark: (locator: Locator) => Promise<boolean>): Promise<UxFocus | null> {
    const snapshot = await this.explorer.withPage(ariaRefSnapshot).catch(() => '');
    const candidates = parseAriaRefs(snapshot).filter((entry) => FOCUS_CONTAINER_ROLES.includes(entry.role));
    if (!candidates.length) return null;

    const hints: string[] = [];
    if (context.focus) hints.push(`The developer asked to review: ${context.focus}`);
    if (context.commands.length) hints.push('Commands the session ran on this page, latest last:', ...context.commands.map((command) => `- ${command}`));

    const schema = z.object({
      ref: z.enum(['none', ...candidates.map((entry) => entry.ref)]).describe('ref of the chosen container, or none'),
      area: z.string().describe('the area named as a user would call it, a few words'),
    });

    const prompt = dedent`
      Pick the page area a developer is working on, so a UX review covers it and nothing else.
      Choose the smallest container that holds everything the hints point at.
      Answer none when no listed container fits the hints.

      <hints>
      ${hints.join('\n')}
      </hints>

      <containers>
      ${candidates.map((entry) => `- [${entry.ref}] ${entry.role} "${entry.name}"`).join('\n')}
      </containers>

      <page_aria>
      ${snapshot.slice(0, UX_ARIA_CAP)}
      </page_aria>
    `;

    const response = await this.provider.generateObject([{ role: 'user', content: prompt }], schema, this.model, { agentName: AGENT_NAME }).catch(() => null);
    const ref = response?.object?.ref;
    if (!ref || ref === 'none') return null;
    if (!(await this.explorer.withPage((page) => mark(page.locator(ariaRefSelector(ref)))))) return null;

    let reason = 'the session commands on this page act inside it';
    if (context.focus) reason = `it holds "${context.focus}"`;
    return { area: response.object.area, reason };
  }

  private async collectUxEvidence(page: Page): Promise<UxEvidence> {
    const evidence: UxEvidence = { breakpoints: [], axe: [], notes: [] };
    evidence.axe = await this.axeViolations(page, UX_FOCUS_SELECTOR).catch((error) => {
      evidence.notes.push(`axe could not run: ${error.message}`);
      return [];
    });

    const ignoredMotion = await this.animationsIgnoringReducedMotion(page);
    if (ignoredMotion) evidence.notes.push(`${ignoredMotion} animations in the area keep running when reduced motion is requested`);

    const width = await page.evaluate(() => window.innerWidth);
    evidence.breakpoints.push(await this.captureUxBreakpoint(page));

    const narrower = UX_BREAKPOINTS.filter((breakpoint) => breakpoint < width);
    if (!narrower.length) return evidence;

    const viewport = page.viewportSize();
    if (!viewport) {
      evidence.notes.push('the browser window has no fixed viewport, so narrower widths were not measured');
      return evidence;
    }

    try {
      for (const breakpoint of narrower) {
        await page.setViewportSize({ width: breakpoint, height: viewport.height });
        await page.waitForTimeout(UX_SETTLE_MS);
        if ((await page.evaluate(() => window.innerWidth)) !== breakpoint) {
          evidence.notes.push(`resizing to ${breakpoint}px had no effect, so that width was not measured`);
          continue;
        }
        evidence.breakpoints.push(await this.captureUxBreakpoint(page));
      }
    } finally {
      await page.setViewportSize(viewport);
    }

    return evidence;
  }

  private async animationsIgnoringReducedMotion(page: Page): Promise<number> {
    if (!(await page.evaluate(countRunningAnimations, UX_FOCUS_SELECTOR))) return 0;

    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(UX_SETTLE_MS);
      return await page.evaluate(countRunningAnimations, UX_FOCUS_SELECTOR);
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }
  }

  private async captureUxBreakpoint(page: Page): Promise<UxBreakpoint> {
    const focus = page.locator(UX_FOCUS_SELECTOR).first();
    const measurements = await page.evaluate(measureUx, uxProbeArgs(UX_FOCUS_SELECTOR));
    const aria = await focus.ariaSnapshot().catch(() => '');

    const breakpoint: UxBreakpoint = { measurements, aria: compactAriaSnapshot(aria, true).slice(0, UX_ARIA_CAP) };
    if (!this.provider.hasVision()) return breakpoint;

    const screenshot = await focus.screenshot({ timeout: UX_SCREENSHOT_TIMEOUT }).catch(() => null);
    if (screenshot) breakpoint.screenshot = screenshot.toString('base64');
    return breakpoint;
  }

  private async writeUxReport(result: ActionResult, focus: UxFocus, evidence: UxEvidence, context: UxAuditContext): Promise<string> {
    const url = result.url || '';
    const rules = [RulesLoader.loadRules(AGENT_NAME, UX_RULES, url), this.provider.getSystemPromptForAgent(AGENT_NAME, url)].filter(Boolean).join('\n\n');

    const system = dedent`
      <role>
      You review the UX of one area of a web page a developer is building right now.
      The report goes back to that developer, so every finding must point at something they can find in that area.
      </role>

      <focus>
      Area under review: ${focus.area}, chosen because ${focus.reason}.
      Report only on elements inside it. Page-wide header, navigation and footer are out of scope unless they are the area under review.
      </focus>

      <scope>
      You see one page of one app, not the app.
      - Report that a text fails and why. Never propose replacement wording, terminology, tone or language: the app's vocabulary is unknown to you.
      - Never recommend colors, fonts, spacing values, design tokens or visual style: the project owns its design system.
      - Sizes, gaps, overflow and contrast come only from <measurements> and <axe>. Never estimate them from a screenshot.
      - Report only what the evidence shows. A check the evidence cannot settle is skipped, not guessed.
      </scope>

      <rules>
      Each rule set carries the priority its findings are reported under.

      ${rules}
      </rules>

      <output>
      Markdown, no preamble.

      ## Focus
      One line: the area reviewed and the widths covered.

      Then one section per priority that has findings, in this order: ## Critical, ## High, ## Medium, ## Low. Omit empty sections.
      Each finding is one bullet of one sentence, at most 30 words:
      - **<element as the user sees it>** (<rule set>, <width or "all widths">): <evidence>, <what it costs the user>.

      One bullet per cause: elements failing the same check share a bullet naming at most three of them.
      Write at most ${UX_MAX_FINDINGS} bullets in total across all sections, most severe first; drop the rest.
      No fix wording, no rule ids, no list of skipped checks, no summary, no tables.
      When nothing fails, write the Focus section and the line: No UX issues found in this area.
      </output>
    `;

    const sections = [`<page url="${url}" title="${result.title || ''}"></page>`];
    if (context.commands.length) sections.push(`<session_commands>\n${context.commands.join('\n')}\n</session_commands>`);
    sections.push(`<axe>\n${evidence.axe.map((v) => `[${v.impact}] ${v.id}: ${v.description} — ${v.nodes[0]?.html.slice(0, 100) || ''}`).join('\n') || 'no violations'}\n</axe>`);
    if (evidence.notes.length) sections.push(`<notes>\n${evidence.notes.join('\n')}\n</notes>`);
    for (const breakpoint of evidence.breakpoints) {
      const aria = breakpoint.aria || 'the area is not rendered at this width';
      sections.push(`<breakpoint width="${breakpoint.measurements.width}">\n<measurements>\n${renderUxMeasurements(breakpoint.measurements)}\n</measurements>\n<aria>\n${aria}\n</aria>\n</breakpoint>`);
    }

    const shots = evidence.breakpoints.filter((breakpoint) => breakpoint.screenshot);
    if (!shots.length) sections.push('No screenshots are attached: judge from ARIA and measurements only, and say in Focus that visual checks were not possible.');

    const content: any[] = [{ type: 'text', text: sections.join('\n\n') }];
    for (const shot of shots) {
      content.push({ type: 'text', text: `Screenshot of the area at ${shot.measurements.width}px:` });
      content.push({ type: 'file', mediaType: 'image/png', data: shot.screenshot });
    }

    let model = this.model || this.provider.getModelForAgent(AGENT_NAME);
    if (shots.length) model = this.provider.getVisionModel();

    const response = await this.provider.chat(
      [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      model,
      { agentName: AGENT_NAME }
    );
    return response.text;
  }
}

export interface UxAuditContext {
  focus?: string;
  commands: string[];
}

interface UxFocus {
  area: string;
  reason: string;
}

interface UxBreakpoint {
  measurements: UxMeasurements;
  aria: string;
  screenshot?: string;
}

interface UxEvidence {
  breakpoints: UxBreakpoint[];
  axe: AxeViolation[];
  notes: string[];
}

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
