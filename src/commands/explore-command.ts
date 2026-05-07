import figureSet from 'figures';
import { getStyles } from '../ai/planner/styles.js';
import { outputPath } from '../config.js';
import { normalizeUrl } from '../state-manager.js';
import { Stats } from '../stats.js';
import type { Plan } from '../test-plan.js';
import { getCliName } from '../utils/cli-name.ts';
import { ErrorPageError } from '../utils/error-page.ts';
import { tag } from '../utils/logger.js';
import { jsonToTable } from '../utils/markdown-parser.js';
import { type NextStepSection, printNextSteps, relativeToCwd } from '../utils/next-steps.ts';
import { safeFilename } from '../utils/strings.ts';
import { BaseCommand, type Suggestion } from './base-command.js';

const MAX_SUB_PAGE_ATTEMPTS = 30;

export class ExploreCommand extends BaseCommand {
  name = 'explore';
  description = 'Start web exploration';
  options = [
    { flags: '--max-tests <number>', description: 'Maximum number of tests to run' },
    { flags: '--focus <feature>', description: 'Focus area for exploration' },
  ];
  suggestions: Suggestion[] = [
    { command: 'navigate <page>', hint: 'go to another page' },
    { command: 'research', hint: 'analyze current page' },
    { command: 'plan <feature>', hint: 'plan testing' },
  ];

  maxTests?: number;
  private testsRun = 0;
  private completedPlans: Plan[] = [];
  private failedSubPages = new Set<string>();

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    if (opts.maxTests) {
      this.maxTests = Number.parseInt(opts.maxTests as string, 10);
    }

    const feature = (opts.focus as string) || remaining.join(' ') || undefined;
    Stats.mode ??= 'explore';
    Stats.focus ??= feature;
    const mainUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url;

    await this.runAllStyles(mainUrl, feature);
    const mainPlan = this.explorBot.getCurrentPlan();
    if (!mainPlan) return;
    this.completedPlans.push(mainPlan);

    if (!feature && !this.isLimitReached()) {
      const planner = this.explorBot.agentPlanner();
      let attempts = 0;
      while (attempts < MAX_SUB_PAGE_ATTEMPTS) {
        attempts++;
        if (this.isLimitReached()) break;

        const candidates = planner.collectSubPageCandidates(mainPlan, mainUrl || '/').filter((c) => !this.failedSubPages.has(normalizeUrl(c.url)));
        if (candidates.length === 0) break;

        const pick = await planner.pickNextSubPage(candidates);
        if (!pick) break;

        tag('info').log(`Exploring sub-page: ${pick.url} (${pick.reason})`);
        try {
          await this.explorBot.visit(pick.url);
          await this.runAllStyles(pick.url, undefined, mainPlan, this.completedPlans);
          const subPlan = this.explorBot.getCurrentPlan();
          if (subPlan) {
            this.completedPlans.push(subPlan);
          }
        } catch (err) {
          this.failedSubPages.add(normalizeUrl(pick.url));
          tag('warning').log(`Sub-page exploration failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    this.explorBot.setCurrentPlan(mainPlan);
    if (mainUrl) await this.explorBot.visit(mainUrl);
    const savedPath = this.explorBot.savePlans(this.completedPlans);
    this.printResults();
    await this.explorBot.printSessionAnalysis();
    this.printNextSteps(savedPath);
  }

  private async runAllStyles(pageUrl?: string, feature?: string, parentPlan?: Plan, completedPlans?: Plan[]): Promise<void> {
    let fresh = true;
    for (const style of Object.keys(getStyles())) {
      if (!fresh && pageUrl) {
        await this.explorBot.visit(pageUrl);
      }
      const opts: { fresh: boolean; style: string; extend?: Plan; completedPlans?: Plan[] } = { fresh, style, completedPlans };
      if (fresh && parentPlan) opts.extend = parentPlan;
      await this.planWithRetry(feature, opts, pageUrl);
      await this.runPendingTests();
      fresh = false;
    }
  }

  private async planWithRetry(feature: string | undefined, opts: { fresh: boolean; style: string; extend?: Plan; completedPlans?: Plan[] }, pageUrl?: string): Promise<void> {
    await this.explorBot.plan(feature, opts);
    if (!this.explorBot.lastPlanError) return;
    if (this.explorBot.lastPlanError instanceof ErrorPageError) {
      throw this.explorBot.lastPlanError;
    }

    tag('info').log(`Retrying planning style '${opts.style}'...`);
    if (pageUrl) await this.explorBot.visit(pageUrl);
    await this.explorBot.plan(feature, opts);
    if (this.explorBot.lastPlanError) {
      tag('warning').log(`Planning style '${opts.style}' failed after retry, skipping`);
    }
  }

  private printResults(): void {
    const allTests = this.completedPlans.flatMap((plan) => plan.tests.filter((t) => t.startTime != null).map((test) => ({ test, planTitle: plan.title })));

    if (allTests.length === 0) return;

    const hasSubPages = this.completedPlans.length > 1;
    const rows = allTests.map(({ test, planTitle }, index) => {
      const durationMs = test.getDurationMs();
      const duration = durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '-';
      let status = 'failed';
      if (test.isSuccessful) status = 'passed';
      else if (test.isSkipped) status = 'skipped';
      const row: Record<string, string> = {
        '#': String(index + 1),
        Status: status,
        Title: test.scenario.replace(/\|/g, '-'),
        Priority: test.priority,
        Time: duration,
        Steps: String(Object.keys(test.notes).length),
      };
      if (hasSubPages) {
        row.Plan = planTitle;
      }
      return row;
    });
    const columns = ['#', 'Status', 'Title', 'Priority', 'Time', 'Steps'];
    if (hasSubPages) columns.push('Plan');
    tag('multiline').log(jsonToTable(rows, columns));
    tag('info').log(`${figureSet.tick} ${allTests.length} tests completed`);
  }

  private printNextSteps(savedPlanPath?: string | null): void {
    const cli = getCliName();
    const sections: NextStepSection[] = [];

    if (savedPlanPath) {
      const relPlan = relativeToCwd(savedPlanPath);
      sections.push({
        label: 'Plan',
        path: savedPlanPath,
        commands: [
          { label: 'Re-run', command: `${cli} test ${relPlan} 1` },
          { label: 'Run all', command: `${cli} test ${relPlan} *` },
          { label: 'Run range', command: `${cli} test ${relPlan} 1-3` },
        ],
      });
    }

    const savedFiles = this.explorBot.agentHistorian().getSavedFiles();
    const screencasts = savedFiles.filter((f) => f.endsWith('.webm'));
    const testFiles = savedFiles.filter((f) => !f.endsWith('.webm'));

    if (testFiles.length > 0) {
      const commands = testFiles.map((f) => ({ label: '', command: `${cli} rerun ${relativeToCwd(f)}` }));
      commands.push({ label: 'List tests', command: `${cli} runs` });
      sections.push({
        label: `Generated tests (${testFiles.length})`,
        commands,
      });
    }

    if (screencasts.length > 0) {
      const commands = screencasts.map((f) => ({ label: '', command: relativeToCwd(f) }));
      const screencastDir = relativeToCwd(outputPath('screencasts'));
      const planSlugs = [...new Set(this.completedPlans.map((p) => safeFilename(p.title)).filter(Boolean))];
      for (const slug of planSlugs) {
        commands.push({ label: 'Browse plan', command: `ls ${screencastDir}/${slug}-*` });
      }
      sections.push({
        label: `Screencasts (${screencasts.length})`,
        commands,
      });
    }

    printNextSteps(sections);
  }

  private isLimitReached(): boolean {
    return this.maxTests != null && this.testsRun >= this.maxTests;
  }

  private async runPendingTests(): Promise<void> {
    const plan = this.explorBot.getCurrentPlan();
    if (!plan) return;
    for (const test of plan.getPendingTests()) {
      if (this.isLimitReached()) break;
      await this.explorBot.agentTester().test(test);
      this.testsRun++;
    }
  }
}
