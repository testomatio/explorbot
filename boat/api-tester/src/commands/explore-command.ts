import { getStyles } from '../ai/chief/styles.ts';
import type { ApiBot } from '../apibot.ts';

export class ExploreCommand {
  private bot: ApiBot;

  constructor(bot: ApiBot) {
    this.bot = bot;
  }

  async execute(endpoint: string): Promise<ExploreResult> {
    const styles = Object.keys(getStyles());
    const endpoints = this.bot.expandEndpoints(endpoint);
    const result: ExploreResult = { tests: 0, passed: 0, failed: 0 };

    for (const [index, target] of endpoints.entries()) {
      let runStyles = [styles[index % styles.length]];
      if (endpoints.length === 1) runStyles = styles;
      if (endpoints.length > 1) console.log(`\n=== Endpoint ${index + 1}/${endpoints.length}: ${target} ===`);

      for (const style of runStyles) {
        await this.runStyle(target, style, result);
      }
    }

    console.log('\n=== Final Results ===');
    console.log(`Total: ${result.tests} tests, ${result.passed} passed, ${result.failed} failed`);

    return result;
  }

  private async runStyle(endpoint: string, style: string, result: ExploreResult): Promise<void> {
    console.log(`\n=== Style: ${style} ===\n`);

    const plan = await this.bot.plan(endpoint, { style, fresh: true });
    if (!plan?.tests.length) {
      console.log(`No tests generated for style: ${style}`);
      return;
    }

    for (const test of plan.getPendingTests()) {
      const specDefinition = this.bot.tryGetEndpointDefinition(test.startUrl!);
      const outcome = await this.bot.agentCurler().test(test, {
        specDefinition,
        baseEndpoint: this.bot.getConfig().api.baseEndpoint,
        searchSpec: (query: string) => this.bot.searchSpec(query),
      });
      result.tests++;
      if (outcome.success) result.passed++;
      else result.failed++;
    }

    this.bot.savePlan(style);
  }
}

export interface ExploreResult {
  tests: number;
  passed: number;
  failed: number;
}
