import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PlansCommand } from '../../src/commands/plans-command.js';
import { TestCommand } from '../../src/commands/test-command.js';
import type { ExplorBot } from '../../src/explorbot.js';
import { Plan, Test } from '../../src/test-plan.js';

let tmpPath = '';
let logs: string[] = [];
let originalLog: typeof console.log;

beforeEach(() => {
  tmpPath = mkdtempSync(path.join(tmpdir(), 'explorbot-plans-'));
  logs = [];
  originalLog = console.log;
  console.log = (...args: any[]) => {
    logs.push(args.join(' '));
  };
});

afterEach(() => {
  console.log = originalLog;
  rmSync(tmpPath, { recursive: true, force: true });
});

describe('PlansCommand', () => {
  it('lists saved plans', async () => {
    const plan = new Plan('Checkout plan');
    plan.addTest(new Test('Pay with card', 'high', ['Payment succeeds'], '/checkout'));
    plan.saveToMarkdown(path.join(tmpPath, 'checkout.md'));

    const cmd = new PlansCommand(createMockExplorBot());
    await cmd.execute('');

    expect(logs.join('\n')).toContain('1. Checkout plan (1 tests) - checkout.md');
  });

  it('shows tests for plan by index', async () => {
    const plan = new Plan('Checkout plan');
    plan.addTest(new Test('Pay with card', 'high', ['Payment succeeds'], '/checkout'));
    plan.addTest(new Test('Apply coupon', 'normal', ['Discount is applied'], '/checkout'));
    plan.saveToMarkdown(path.join(tmpPath, 'checkout.md'));

    const cmd = new PlansCommand(createMockExplorBot());
    await cmd.execute('1');

    const output = logs.join('\n');
    expect(output).toContain('Checkout plan (2 tests)');
    expect(output).toContain('1. Pay with card');
    expect(output).toContain('2. Apply coupon');
    expect(output).toContain('test 1 --from-plan checkout.md');
  });
});

describe('TestCommand', () => {
  it('loads plan from --from-plan before selecting tests', async () => {
    const plan = new Plan('Checkout plan');
    plan.addTest(new Test('Pay with card', 'high', ['Payment succeeds'], '/checkout'));
    const loadPlan = mock(() => plan);
    const tester = { test: mock(async () => {}) };
    const explorBot = createMockExplorBot({
      loadPlan,
      getCurrentPlan: mock(() => plan),
      agentTester: mock(() => tester),
    });

    const cmd = new TestCommand(explorBot);
    await cmd.execute('1 --from-plan checkout.md');

    expect(loadPlan).toHaveBeenCalledWith('checkout.md');
    expect(tester.test).toHaveBeenCalledWith(plan.tests[0]);
  });
});

function createMockExplorBot(overrides: Partial<ExplorBot> = {}): ExplorBot {
  return {
    getPlansDir: () => tmpPath,
    resolvePlanPath: (filename: string) => path.join(tmpPath, filename),
    ...overrides,
  } as unknown as ExplorBot;
}
