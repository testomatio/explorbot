import { Planner } from '../ai/planner.js';
import { Researcher } from '../ai/researcher.js';
import { Stats } from '../stats.js';
import { tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import { BaseCommand } from './base-command.js';
import { DEADLINE_RESERVE_MS, DEADLINE_TEST_ALLOWANCE_MS, ExploreCommand } from './explore-command.js';

export class FreesailCommand extends BaseCommand {
  name = 'freesail';
  description = 'Continuously explore and navigate to new pages autonomously';
  aliases = ['freeride'];
  tuiEnabled = true;
  options = [
    { flags: '--deep', description: 'Use deep navigation strategy' },
    { flags: '--shallow', description: 'Use shallow navigation strategy' },
    { flags: '--scope <url>', description: 'Limit navigation to URLs starting with this prefix' },
    { flags: '--max-tests <number>', description: 'Maximum number of tests to run' },
    { flags: '--max-duration <number>', description: 'Wall-clock budget in minutes for the whole run' },
  ];

  async execute(args: string): Promise<void> {
    Stats.mode = 'freesail';
    const { opts } = this.parseArgs(args);
    let strategy: 'deep' | 'shallow' | undefined;
    if (opts.deep) strategy = 'deep';
    if (opts.shallow) strategy = 'shallow';
    const scope = opts.scope as string | undefined;
    const maxTests = opts.maxTests ? Number.parseInt(opts.maxTests as string, 10) : undefined;
    const maxDuration = opts.maxDuration ? Number.parseInt(opts.maxDuration as string, 10) : undefined;
    let hardDeadlineAt: number | undefined;
    if (maxDuration != null) hardDeadlineAt = Date.now() + maxDuration * 60_000 - DEADLINE_RESERVE_MS;

    await this.explorBot.visitInitialState();

    let testsRun = 0;

    await loop(
      async (ctx) => {
        if (maxTests != null && testsRun >= maxTests) ctx.stop();
        if (hardDeadlineAt != null && Date.now() >= hardDeadlineAt - DEADLINE_TEST_ALLOWANCE_MS) ctx.stop();

        const stateManager = this.explorBot.stateManager();
        const state = stateManager.getCurrentState();

        if (state && !Researcher.getCachedResearch(state)) {
          await this.explorBot.agentResearcher().research(state, { deep: true, screenshot: true });
        }

        const cachedPlan = state?.url ? Planner.getCachedPlan(state.url) : null;
        if (cachedPlan?.tests.some((t) => t.result)) {
          tag('info').log(`Page already tested (${cachedPlan.tests.length} tests in plan), skipping exploration`);
        } else {
          const exploreCmd = new ExploreCommand(this.explorBot);
          if (maxTests != null) exploreCmd.maxTests = maxTests - testsRun;
          if (hardDeadlineAt != null) exploreCmd.hardDeadlineAt = hardDeadlineAt;
          await exploreCmd.execute('');

          const plan = this.explorBot.getCurrentPlan();
          if (plan) testsRun += plan.tests.filter((t) => t.hasFinished).length;
        }

        if (maxTests != null && testsRun >= maxTests) ctx.stop();

        const navigator = this.explorBot.agentNavigator();
        const visitedUrls = stateManager.getAllVisitedUrls();
        const suggestion = await navigator.freeSail({ strategy, scope, visitedUrls });
        if (!suggestion) {
          tag('info').log('No navigation suggestion available');
          return;
        }

        if (scope && !suggestion.target.startsWith(scope)) {
          tag('warning').log(`Suggestion ${suggestion.target} is outside scope ${scope}, skipping`);
          return;
        }

        tag('info').log(`Navigating to: ${suggestion.target} - ${suggestion.reason}`);
        await this.explorBot.openTab();
        await this.explorBot.visit(suggestion.target);
        this.explorBot.clearPlan();
      },
      { maxAttempts: Number.POSITIVE_INFINITY }
    );
  }
}
