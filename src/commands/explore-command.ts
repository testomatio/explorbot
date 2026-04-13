import { existsSync, readdirSync } from 'node:fs';
import figureSet from 'figures';
import path from 'node:path';
import { getStyles } from '../ai/planner/styles.js';
import { ConfigParser } from '../config.ts';
import { getCliName } from '../utils/cli-name.ts';
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
  private completedPlans: Plan[] = [];

  async execute(args: string): Promise<void> {
    const { opts, args: remaining } = this.parseArgs(args);
    if (opts.maxTests) {
      this.maxTests = Number.parseInt(opts.maxTests as string, 10);
    }

    const feature = remaining.join(' ') || undefined;
    const mainUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url;

    await this.runAllStyles(mainUrl, feature);
    const mainPlan = this.explorBot.getCurrentPlan();
    if (!mainPlan) return;
    this.completedPlans.push(mainPlan);

    if (!this.isLimitReached()) {
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
          await this.runAllStyles(pick.url, undefined, mainPlan, this.completedPlans);
          const subPlan = this.explorBot.getCurrentPlan();
          if (subPlan) {
            this.completedPlans.push(subPlan);
          }
        } catch (err) {
          tag('warning').log(`Sub-page exploration failed: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    this.explorBot.setCurrentPlan(mainPlan);
    if (mainUrl) await this.explorBot.visit(mainUrl);
    const savedPath = this.explorBot.savePlans(this.completedPlans);
    this.printResults(savedPath);
    this.printRerunSuggestions();
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

    if (savedPath) {
      const relativePath = path.relative(process.cwd(), savedPath);
      tag('info').log(`Re-run tests: ${getCliName()} test ${relativePath} <index>`);
    }
  }

  private printRerunSuggestions(): void {
    const testsDir = ConfigParser.getInstance().getTestsDir();
    if (!existsSync(testsDir)) return;

    const testFiles = readdirSync(testsDir).filter((f) => f.endsWith('.js'));
    if (testFiles.length === 0) return;

    for (const file of testFiles) {
      tag('info').log(`Generated: ${file}`);
    }
    tag('info').log(`List tests: ${getCliName()} runs`);
    tag('info').log(`Re-run with healing: ${getCliName()} rerun <filename> [index]`);
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
