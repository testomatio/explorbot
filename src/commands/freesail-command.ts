import { Planner } from '../ai/planner.js';
import { Researcher } from '../ai/researcher.js';
import { tag } from '../utils/logger.js';
import { loop } from '../utils/loop.js';
import { BaseCommand } from './base-command.js';

export class FreesailCommand extends BaseCommand {
  name = 'freesail';
  description = 'Continuously explore and navigate to new pages autonomously';
  aliases = ['freeride'];
  tuiEnabled = true;

  async execute(args: string): Promise<void> {
    const { strategy, scope } = parseArgs(args);

    await this.explorBot.visitInitialState();

    await loop(
      async () => {
        const stateManager = this.explorBot.getExplorer().getStateManager();
        const state = stateManager.getCurrentState();

        if (state && !Researcher.getCachedResearch(state)) {
          await this.explorBot.agentResearcher().research(state, { deep: true, screenshot: true });
        }

        const cachedPlan = state?.url ? Planner.getCachedPlan(state.url) : null;
        if (cachedPlan?.tests.some((t) => t.result)) {
          tag('info').log(`Page already tested (${cachedPlan.tests.length} tests in plan), skipping exploration`);
        } else {
          await this.explorBot.explore();
          await this.explorBot.explore();
        }

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
        await this.explorBot.visit(suggestion.target);
        this.explorBot.clearPlan();
      },
      { maxAttempts: Number.POSITIVE_INFINITY }
    );
  }
}

function parseArgs(args: string): { strategy: 'deep' | 'shallow' | undefined; scope: string | undefined } {
  const parts = args.trim().split(/\s+/);
  let strategy: 'deep' | 'shallow' | undefined;
  let scope: string | undefined;

  for (let i = 0; i < parts.length; i++) {
    if (parts[i] === '--deep') strategy = 'deep';
    if (parts[i] === '--shallow') strategy = 'shallow';
    if (parts[i] === '--scope' && parts[i + 1]) {
      scope = parts[i + 1];
      i++;
    }
  }

  return { strategy, scope };
}
