import figureSet from 'figures';
import type { Test } from '../../../../src/test-plan.ts';
import { tag } from '../../../../src/utils/logger.ts';
import { ApiCommand } from './api-command.ts';

export class TestCommand extends ApiCommand {
  name = 'test';
  description = 'Execute tests from a plan file. Index: 1, 1-3, *';
  index?: string;
  failed = 0;

  async execute(planfile: string): Promise<void> {
    const plan = this.bot.loadPlan(planfile);
    tag('info').log(`Plan loaded: "${plan.title}" (${plan.tests.length} tests)`);

    const tests = selectTests(plan.tests, this.index);
    tag('info').log(`Running ${tests.length} test(s)`);

    let passed = 0;
    for (const test of tests) {
      const result = await this.bot.runTest(test);
      if (result.success) passed++;
      else this.failed++;
    }

    this.bot.savePlan();
    tag('info').log(`${figureSet.tick} ${tests.length} tests completed: ${passed} passed, ${this.failed} failed`);
  }
}

export function selectTests(tests: Test[], index?: string): Test[] {
  if (!index || index === '*' || index === 'all') {
    return tests.filter((t) => t.status === 'pending');
  }

  const rangeMatch = index.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1]) - 1;
    const end = Number.parseInt(rangeMatch[2]);
    return tests.slice(start, end);
  }

  if (index.includes(',')) {
    const indices = index.split(',').map((i) => Number.parseInt(i.trim()) - 1);
    return indices.map((i) => tests[i]).filter(Boolean);
  }

  const num = Number.parseInt(index);
  if (!Number.isNaN(num) && tests[num - 1]) {
    return [tests[num - 1]];
  }

  return tests.filter((t) => t.status === 'pending');
}
