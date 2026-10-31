import { describe, expect, it } from 'bun:test';
import { Captain } from '../../src/ai/captain.ts';
import { ExplorBot } from '../../src/explorbot.ts';
import { Plan, Test } from '../../src/test-plan.ts';
import { NavigationBlockedError, PlanningBlockedError } from '../../src/utils/error-page.ts';

function createCaptain(fix: () => void) {
  const requests: string[] = [];
  const captain = Object.create(Captain.prototype);
  captain.unresolvedBlockers = new Set();
  captain.handling = false;
  captain.handle = async (input: string) => {
    requests.push(input);
    fix();
    return null;
  };
  return { captain, requests };
}

describe('Captain.resolveBlocker', () => {
  it('hands the request to Captain and reports whether the blocker is gone', async () => {
    let fixed = false;
    const { captain, requests } = createCaptain(() => {
      fixed = true;
    });
    const blocked = new NavigationBlockedError('/workspace', '/login', 'sign-in required', []);

    expect(await captain.resolveBlocker(blocked, () => fixed)).toBe(true);
    expect(requests).toEqual([blocked.request]);
  });

  it('does not hand over a blocker it already failed to resolve', async () => {
    const { captain, requests } = createCaptain(() => {});
    const blocked = new NavigationBlockedError('/workspace', '/login', 'sign-in required', []);

    expect(await captain.resolveBlocker(blocked, () => false)).toBe(false);
    expect(await captain.resolveBlocker(blocked, () => false)).toBe(false);
    expect(requests).toHaveLength(1);
  });

  it('ignores errors that are not blockers and blockers raised while it is already working', async () => {
    const { captain, requests } = createCaptain(() => {});

    expect(await captain.resolveBlocker(new Error('boom'), () => true)).toBe(false);
    captain.handling = true;
    expect(await captain.resolveBlocker(new NavigationBlockedError('/workspace', '/login', 'sign-in required', []), () => true)).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe('ExplorBot hands blocked work to Captain', () => {
  function createBot(captainFixes: boolean) {
    const calls: string[] = [];
    let fixed = false;
    const bot: any = Object.create(ExplorBot.prototype);
    const { captain } = createCaptain(() => {
      if (!captainFixes) return;
      fixed = true;
      bot.currentPlan.addTest(new Test('Open a workspace project', 'high', [], '/workspace'));
    });
    bot.agents = {};
    bot.currentPlan = new Plan('Workspace');
    bot.configParser = { resolveTargetPath: (url: string) => url };
    bot.agentCaptain = () => captain;
    bot.agentNavigator = () => ({
      isOn: () => fixed,
      visit: async (url: string) => {
        calls.push(`visit ${url}`);
        if (!fixed) throw new NavigationBlockedError(url, '/login', 'sign-in required', []);
      },
    });
    bot.agentPlanner = () => ({
      setPlan: () => {},
      plan: async () => {
        calls.push('plan');
        throw new PlanningBlockedError('/workspace', 'Sign in');
      },
    });
    return { bot, calls };
  }

  it('opens the page once Captain gets past what blocked navigation', async () => {
    const { bot, calls } = createBot(true);
    await bot.visit('/workspace');
    expect(calls).toEqual(['visit /workspace']);
  });

  it('rethrows the navigation error when Captain cannot open the page', async () => {
    const { bot } = createBot(false);
    await expect(bot.visit('/workspace')).rejects.toBeInstanceOf(NavigationBlockedError);
  });

  it('keeps the tests Captain planned on a page the planner reported blocked', async () => {
    const { bot } = createBot(true);
    const plan = await bot.plan(undefined, { noSave: true });
    expect(plan.tests).toHaveLength(1);
    expect(bot.lastPlanError).toBeNull();
  });

  it('reports the planner error when Captain plans nothing', async () => {
    const { bot } = createBot(false);
    await bot.plan(undefined, { noSave: true });
    expect(bot.lastPlanError).toBeInstanceOf(PlanningBlockedError);
  });
});
