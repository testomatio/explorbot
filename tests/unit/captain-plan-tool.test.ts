import { beforeEach, describe, expect, it } from 'bun:test';
import { Captain } from '../../src/ai/captain.ts';
import { ConfigParser } from '../../src/config.ts';
import { Plan, Task, Test } from '../../src/test-plan.ts';
import { PlanningBlockedError } from '../../src/utils/error-page.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
  (ConfigParser.getInstance() as any).configPath = null;
});

async function planToolFor(blocker: PlanningBlockedError | null, current: Plan | undefined = new Plan('/workspace')) {
  const calls: { feature?: string; style?: string }[] = [];
  const explorBot: any = {
    lastPlanError: null,
    currentPlan: current,
    stateManager: () => ({ getCurrentState: () => ({ url: '/workspace' }) }),
    getCurrentPlan: () => explorBot.currentPlan,
    setCurrentPlan: (plan: Plan) => {
      explorBot.currentPlan = plan;
    },
    plan: async (feature?: string, opts: { style?: string } = {}) => {
      calls.push({ feature, style: opts.style });
      return explorBot.currentPlan;
    },
  };
  const captain: any = Object.create(Captain.prototype);
  const tools = await captain.idleModeTools({ explorBot, task: new Task('re-plan', '/workspace'), blocker });
  return { plan: tools.plan, calls, explorBot };
}

describe('Captain plan() tool', () => {
  it('re-plans a blocked page with the focus and style the planner was asked for', async () => {
    expect(ConfigParser.getInstance().getConfigPath()).toBeNull();
    const { plan, calls } = await planToolFor(new PlanningBlockedError('/workspace', 'Sign in', undefined, 'normal'));

    await plan.execute({ feature: 'Signing in with valid credentials to reach the workspace', style: 'curious' });

    expect(calls).toEqual([{ feature: undefined, style: 'normal' }]);
  });

  it('plans the focus Captain asks for when no planning is blocked', async () => {
    const { plan, calls } = await planToolFor(null);

    await plan.execute({ feature: 'task filters', style: 'curious' });

    expect(calls).toEqual([{ feature: 'task filters', style: 'curious' }]);
  });

  it('adds the tests Captain writes to this page plan without running the Planner', async () => {
    const current = new Plan('/workspace');
    current.addTest(new Test('Existing test', 'normal', [], '/workspace'));
    const { plan, calls, explorBot } = await planToolFor(null, current);

    const result = await plan.execute({ tests: [{ scenario: 'Filter tasks by owner' }] });

    expect(calls).toEqual([]);
    expect(explorBot.currentPlan).toBe(current);
    expect(current.tests.map((t: Test) => t.scenario)).toEqual(['Existing test', 'Filter tasks by owner']);
    expect(result).toMatchObject({ success: true, testsAdded: 1 });
  });

  it('replaces the tests of this page plan when asked', async () => {
    const current = new Plan('/workspace');
    current.addTest(new Test('Existing test', 'normal', [], '/workspace'));
    const { plan } = await planToolFor(null, current);

    await plan.execute({ tests: [{ scenario: 'Filter tasks by owner' }], replace: true });

    expect(current.tests.map((t: Test) => t.scenario)).toEqual(['Filter tasks by owner']);
  });

  it('starts a new plan for written tests when the current plan is for another page', async () => {
    const other = new Plan('/settings');
    other.addTest(new Test('Change name', 'normal', [], '/settings'));
    const { plan, explorBot } = await planToolFor(null, other);

    await plan.execute({ tests: [{ scenario: 'Filter tasks by owner' }], replace: true });

    expect(other.tests).toHaveLength(1);
    expect(explorBot.currentPlan).not.toBe(other);
    expect(explorBot.currentPlan.url).toBe('/workspace');
    expect(explorBot.currentPlan.tests.map((t: Test) => t.scenario)).toEqual(['Filter tasks by owner']);
  });

  it('accepts only the configured planning styles', async () => {
    const { plan } = await planToolFor(null);

    expect(plan.inputSchema.safeParse({ style: 'curious' }).success).toBe(true);
    expect(plan.inputSchema.safeParse({ style: 'made-up' }).success).toBe(false);
  });
});
