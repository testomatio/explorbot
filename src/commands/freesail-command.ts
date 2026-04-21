import { Planner } from '../ai/planner.js';
import { Researcher } from '../ai/researcher.js';
import { Stats } from '../stats.js';
import { tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import { BaseCommand } from './base-command.js';
import { ExploreCommand } from './explore-command.js';

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
  ];

  async execute(args: string): Promise<void> {
    Stats.mode = 'freesail';
    const { opts } = this.parseArgs(args);
    let strategy: 'deep' | 'shallow' | undefined;
    if (opts.deep) strategy = 'deep';
    if (opts.shallow) strategy = 'shallow';
    const scope = opts.scope as string | undefined;
    const maxTests = opts.maxTests ? Number.parseInt(opts.maxTests as string, 10) : undefined;

    await this.explorBot.visitInitialState();

    let testsRun = 0;

    await loop(
      async (ctx) => {
        if (maxTests != null && testsRun >= maxTests) ctx.stop();

        const stateManager = this.explorBot.getExplorer().getStateManager();
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
        await this.explorBot.openFreshTab();
        await this.explorBot.visit(suggestion.target);
        this.explorBot.clearPlan();
      },
      { maxAttempts: Number.POSITIVE_INFINITY }
    );
  }
}
