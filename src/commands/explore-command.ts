import figureSet from 'figures';
import { SUBPAGE_COVERAGE_THRESHOLD } from '../ai/planner/coverage.js';
import { getStyles } from '../ai/planner/styles.js';
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

    let fresh = true;
    for (const style of Object.keys(getStyles())) {
      if (!fresh && mainUrl) {
        await this.explorBot.visit(mainUrl);
      }
      await this.explorBot.plan(feature, { fresh, style });
      await this.runPendingTests();
      fresh = false;
    }

    const coverage = this.explorBot.agentPlanner().getCoverage();
    const mainPlan = this.explorBot.getCurrentPlan();
    if (coverage && mainPlan) {
      const subPages = coverage.pages.filter((p) => p.url !== mainUrl && p.coverage < SUBPAGE_COVERAGE_THRESHOLD && p.potential_tests);
      for (const subPage of subPages) {
        tag('info').log(`Exploring sub-page: ${subPage.url} (${Math.round(subPage.coverage * 100)}% coverage)`);
        await this.explorBot.visit(subPage.url);
        this.explorBot.clearPlan();
        await this.explorBot.plan(undefined, { extend: mainPlan });
        await this.runPendingTests();
      }
      if (subPages.length > 0) {
        this.explorBot.setCurrentPlan(mainPlan);
        if (mainUrl) await this.explorBot.visit(mainUrl);
      }
    }

    const currentPlan = this.explorBot.getCurrentPlan();
    if (!currentPlan) return;

    const rows = currentPlan.tests.map((test) => {
      const durationMs = test.getDurationMs();
      const duration = durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : '-';
      return {
        Status: test.isSuccessful ? 'passed' : 'failed',
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
    for (const test of this.explorBot.getCurrentPlan()!.getPendingTests()) {
      await this.explorBot.agentTester().test(test);
    }
  }
}
