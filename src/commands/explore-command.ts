import figureSet from 'figures';
import { getStyles } from '../ai/planner/styles.js';
import type { Plan } from '../test-plan.js';
import { jsonToTable } from '../utils/markdown-parser.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class ExploreCommand extends BaseCommand {
  name = 'explore';
  description = 'Start web exploration';
  suggestions = ['/navigate <page> - to go to another page', '/research - to analyze', '/plan <feature> - to plan testing'];

  async execute(args: string): Promise<void> {
    const feature = args.trim() || undefined;
    const mainUrl = this.explorBot.getExplorer().getStateManager().getCurrentState()?.url;

    await this.runAllStyles(mainUrl, feature);
    const mainPlan = this.explorBot.getCurrentPlan();
    if (!mainPlan) return;
    const completedPlans: Plan[] = [mainPlan];

    const planner = this.explorBot.agentPlanner();
    while (true) {
      const candidates = planner.collectSubPageCandidates(mainPlan, mainUrl || '/');
      if (candidates.length === 0) break;

      const pick = await planner.pickNextSubPage(candidates);
      if (!pick) break;

      tag('info').log(`Exploring sub-page: ${pick.url} (${pick.reason})`);
      try {
        await this.explorBot.visit(pick.url);
        this.explorBot.clearPlan();
        await this.runAllStyles(pick.url, undefined, mainPlan, completedPlans);
        const subPlan = this.explorBot.getCurrentPlan();
        if (subPlan) {
          completedPlans.push(subPlan);
          for (const test of subPlan.tests) {
            const isDup = mainPlan.tests.some((t) => t.scenario.toLowerCase() === test.scenario.toLowerCase());
            if (!isDup) mainPlan.addTest(test);
          }
        }
      } catch (err) {
        tag('warning').log(`Sub-page exploration failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    this.explorBot.setCurrentPlan(mainPlan);
    if (mainUrl) await this.explorBot.visit(mainUrl);
    this.printResults();
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

  private printResults(): void {
    const currentPlan = this.explorBot.getCurrentPlan();
    if (!currentPlan) return;

    const rows = currentPlan.tests.map((test) => {
      const durationMs = test.getDurationMs();
      const duration = durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '-';
      let status = 'failed';
      if (test.isSuccessful) status = 'passed';
      else if (test.isSkipped) status = 'skipped';
      return {
        Status: status,
        Title: test.scenario.replace(/\|/g, '-'),
        Priority: test.priority,
        Time: duration,
        Steps: String(Object.keys(test.notes).length),
      };
    });
    tag('multiline').log(jsonToTable(rows, ['Status', 'Title', 'Priority', 'Time', 'Steps']));
    tag('info').log(`${figureSet.tick} ${currentPlan.tests.length} tests completed`);
  }

  private async runPendingTests(): Promise<void> {
    const plan = this.explorBot.getCurrentPlan();
    if (!plan) return;
    for (const test of plan.getPendingTests()) {
      await this.explorBot.agentTester().test(test);
    }
  }
}
