import { Stats } from '../stats.js';
import { Test } from '../test-plan.js';
import { tag } from '../utils/logger.js';
import { BaseCommand, type Suggestion } from './base-command.js';

export class TestCommand extends BaseCommand {
  name = 'test';
  description = 'Launch tester agent to execute test scenarios';
  suggestions: Suggestion[] = [
    { command: 'test', hint: 'run next test' },
    { command: 'plan', hint: 'create new plan' },
  ];

  async execute(args: string): Promise<void> {
    const plan = this.explorBot.getCurrentPlan();
    Stats.mode = 'test';
    Stats.focus = plan?.title;
    const toExecute: Test[] = [];

    const requirePlan = () => {
      if (!plan) throw new Error('No plan found. Please run /plan first to create test scenarios.');
      return plan;
    };

    if (!args) {
      const pending = requirePlan().getPendingTests();
      if (pending.length === 0) {
        throw new Error('All tests are already complete. Please run /plan to create new test scenarios.');
      }
      toExecute.push(pending[0]);
    } else if (args === '*' || args === 'all') {
      toExecute.push(...requirePlan().getPendingTests());
    } else if (args.match(/^[\d,\-\s]+$/)) {
      const visible = requirePlan().tests.filter((t) => t.enabled);
      const indices = parseTestIndices(args, visible.length);
      for (const idx of indices) {
        toExecute.push(visible[idx]);
      }
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

function parseTestIndices(input: string, total: number): number[] {
  const indices = new Set<number>();

  const addIndex = (n: number) => {
    if (n < 1 || n > total) throw new Error(`Test #${n} not found. Available: 1-${total}`);
    indices.add(n - 1);
  };

  for (const part of input.split(',')) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let i = Number.parseInt(range[1]); i <= Number.parseInt(range[2]); i++) addIndex(i);
    } else {
      addIndex(Number.parseInt(trimmed));
    }
  }
  return [...indices].sort((a, b) => a - b);
}
