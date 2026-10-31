import { beforeEach, describe, expect, it } from 'bun:test';
import { Captain } from '../../src/ai/captain.ts';
import { ConfigParser } from '../../src/config.ts';
import { Plan, Task } from '../../src/test-plan.ts';
import { PlanningBlockedError } from '../../src/utils/error-page.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
  (ConfigParser.getInstance() as any).configPath = null;
});

async function planToolFor(blocker: PlanningBlockedError | null) {
  const calls: { feature?: string; style?: string }[] = [];
  const plan = new Plan('Workspace');
  const explorBot: any = {
    lastPlanError: null,
    getCurrentPlan: () => plan,
    plan: async (feature?: string, opts: { style?: string } = {}) => {
      calls.push({ feature, style: opts.style });
      return plan;
    },
  };
  const captain: any = Object.create(Captain.prototype);
  const tools = await captain.idleModeTools({ explorBot, task: new Task('re-plan', '/workspace'), blocker });
  return { plan: tools.plan, calls };
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
});
