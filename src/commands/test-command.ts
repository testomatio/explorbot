import { Test } from '../test-plan.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export class TestCommand extends BaseCommand {
  name = 'test';
  description = 'Launch tester agent to execute test scenarios';
  suggestions = ['/test - to run next test', '/plan - to create new plan'];

  async execute(args: string): Promise<void> {
    const plan = this.explorBot.getCurrentPlan();
    const toExecute: Test[] = [];

    if (!args) {
      if (!plan) {
        throw new Error('No plan found. Please run /plan first or provide a test scenario: /test <scenario>');
      }
      const pending = plan.getPendingTests();
      if (pending.length === 0) {
        throw new Error('All tests are already complete. Please run /plan to create new test scenarios.');
      }
      toExecute.push(pending[0]);
    } else if (args === '*') {
      if (!plan) {
        throw new Error('No plan found. Please run /plan first to create test scenarios.');
      }
      toExecute.push(...plan.getPendingTests());
    } else if (args.match(/^\d+$/)) {
      if (!plan) {
        throw new Error('No plan found. Please run /plan first to create test scenarios.');
      }
      const index = Number.parseInt(args) - 1;
      const pending = plan.getPendingTests();
      if (index < 0 || index >= pending.length) {
        throw new Error(`Test #${args} not found. Available: 1-${pending.length}`);
      }
      toExecute.push(pending[index]);
    } else {
      const matching = plan?.getPendingTests().filter((test) => test.scenario.toLowerCase().includes(args.toLowerCase())) || [];
      if (matching.length > 0) {
        toExecute.push(...matching);
      } else {
        const state = this.explorBot.getExplorer().getStateManager().getCurrentState();
        if (!state) {
          throw new Error('No page loaded. Please navigate to a page first.');
        }
        const newTest = new Test(args, 'unknown', [], state.url);
        if (plan) {
          plan.addTest(newTest);
          tag('info').log(`Created new test: "${args}" and added to current plan.`);
        } else {
          tag('info').log(`Created ad-hoc test: "${args}"`);
        }
        toExecute.push(newTest);
      }
    }

    if (toExecute.length === 0) {
      throw new Error('No tests to execute.');
    }

    tag('info').log(`Launching ${toExecute.length} test scenario(s).`);
    const tester = this.explorBot.agentTester();
    for (const test of toExecute) {
      await tester.test(test);
    }
    tag('success').log('Test execution finished');
  }
}
