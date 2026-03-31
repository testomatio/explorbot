import figureSet from 'figures';
import path from 'node:path';
import { getStyles } from '../ai/planner/styles.js';
import type { Plan } from '../test-plan.js';
import { jsonToTable } from '../utils/markdown-parser.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ExploreCommand extends BaseCommand {
  name = 'explore';
  description = 'Start web exploration';
  options = [{ flags: '--max-tests <number>', description: 'Maximum number of tests to run' }];
  suggestions = ['/navigate <page> - to go to another page', '/research - to analyze', '/plan <feature> - to plan testing'];

  maxTests?: number;
  private testsRun = 0;
  private testPlanOrigin = new Map<string, string>();
  private hasSubPages = false;

  async execute(args: string): Promise<void> {
    const maxTestsMatch = args.match(/--max-tests\s+(\d+)/);
    if (maxTestsMatch) {
      this.maxTests = Number.parseInt(maxTestsMatch[1], 10);
      args = args.replace(/--max-tests\s+\d+/, '').trim();
    }

    const feature = args.trim() || undefined;
    const mainUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url;

    await this.runAllStyles(mainUrl, feature);
    const mainPlan = this.explorBot.getCurrentPlan();
    if (!mainPlan) return;
    const completedPlans: Plan[] = [mainPlan];

    if (this.isLimitReached()) {
      this.explorBot.setCurrentPlan(mainPlan);
      if (mainUrl) await this.explorBot.visit(mainUrl);
      const savedPath = this.explorBot.savePlan();
      this.printResults(savedPath);
      return;
    }

    const planner = this.explorBot.agentPlanner();
    while (true) {
      if (this.isLimitReached()) break;

      const candidates = planner.collectSubPageCandidates(mainPlan, mainUrl || '/');
      if (candidates.length === 0) break;

      const pick = await planner.pickNextSubPage(candidates);
      if (!pick) break;

      tag('info').log(`Exploring sub-page: ${pick.url} (${pick.reason})`);
      try {
        await this.explorBot.visit(pick.url);
        await this.runAllStyles(pick.url, undefined, mainPlan, completedPlans);
        const subPlan = this.explorBot.getCurrentPlan();
        if (subPlan) {
          completedPlans.push(subPlan);
          this.hasSubPages = true;
          for (const test of subPlan.tests) {
            const isDup = mainPlan.tests.some((t) => t.scenario.toLowerCase() === test.scenario.toLowerCase());
            if (isDup) continue;
            mainPlan.addTest(test);
            this.testPlanOrigin.set(test.scenario.toLowerCase(), subPlan.title);
          }
        }
      } catch (err) {
        tag('warning').log(`Sub-page exploration failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    this.explorBot.setCurrentPlan(mainPlan);
    if (mainUrl) await this.explorBot.visit(mainUrl);
    const savedPath = this.explorBot.savePlan();
    this.printResults(savedPath);
  }

  private async runAllStyles(pageUrl?: string, feature?: string, parentPlan?: Plan, completedPlans?: Plan[]): Promise<void> {
    let fresh = true;
    for (const style of Object.keys(getStyles())) {
      if (!fresh && pageUrl) {
        await this.explorBot.visit(pageUrl);
      }
      const opts: { fresh: boolean; style: string; extend?: Plan; completedPlans?: Plan[] } = { fresh, style, completedPlans };
      if (fresh && parentPlan) opts.extend = parentPlan;
      await this.explorBot.plan(feature, opts);
      await this.runPendingTests();
      fresh = false;
    }
  }

  private printResults(savedPath?: string | null): void {
    const currentPlan = this.explorBot.getCurrentPlan();
    if (!currentPlan) return;

    const rows = currentPlan.tests.map((test, index) => {
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
      if (this.hasSubPages) {
        row.Plan = this.testPlanOrigin.get(test.scenario.toLowerCase()) || '';
      }
      return row;
    });
    const columns = ['#', 'Status', 'Title', 'Priority', 'Time', 'Steps'];
    if (this.hasSubPages) columns.push('Plan');
    tag('multiline').log(jsonToTable(rows, columns));
    tag('info').log(`${figureSet.tick} ${currentPlan.tests.length} tests completed`);

    if (savedPath) {
      const relativePath = path.relative(process.cwd(), savedPath);
      tag('info').log(`Re-run tests: explorbot test ${relativePath} <index>`);
    }
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
