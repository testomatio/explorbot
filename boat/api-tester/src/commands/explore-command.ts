import figureSet from 'figures';
import { tag } from '../../../../src/utils/logger.ts';
import { getStyles } from '../ai/chief/styles.ts';
import { ApiCommand } from './api-command.ts';

export class ExploreCommand extends ApiCommand {
  name = 'explore';
  description = 'Full cycle: plan, execute tests, re-plan. Use * to cover many endpoints, or the base endpoint for all of them';
  result: ExploreResult = { tests: 0, passed: 0, failed: 0 };

  async execute(endpoint: string): Promise<void> {
    const styles = Object.keys(getStyles());
    const endpoints = this.bot.expandEndpoints(endpoint);

    for (const [index, target] of endpoints.entries()) {
      let runStyles = [styles[index % styles.length]];
      if (endpoints.length === 1) runStyles = styles;
      if (endpoints.length > 1) tag('info').log(`Endpoint ${index + 1}/${endpoints.length}: ${target}`);

      for (const style of runStyles) {
        await this.runStyle(target, style);
      }
    }

    tag('info').log(`${figureSet.tick} ${this.result.tests} tests completed: ${this.result.passed} passed, ${this.result.failed} failed`);
  }

  private async runStyle(endpoint: string, style: string): Promise<void> {
    tag('info').log(`Planning style: ${style}`);

    const plan = await this.bot.plan(endpoint, { style, fresh: true });
    if (!plan?.tests.length) {
      tag('warning').log(`No tests generated for style: ${style}`);
      return;
    }

    for (const test of plan.getPendingTests()) {
      const outcome = await this.bot.runTest(test);
      this.result.tests++;
      if (outcome.success) this.result.passed++;
      else this.result.failed++;
    }

    this.bot.savePlan(style);
  }
}

export interface ExploreResult {
  tests: number;
  passed: number;
  failed: number;
}
