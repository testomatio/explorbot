import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import { Captain } from '../../src/ai/captain.ts';
import type { ExperienceTracker } from '../../src/experience-tracker.ts';
import { ExplorBot } from '../../src/explorbot.ts';
import type { KnowledgeTracker } from '../../src/knowledge-tracker.ts';
import { StateManager } from '../../src/state-manager.ts';
import { Plan, Test } from '../../src/test-plan.ts';
import { NavigationBlockedError, PlanningBlockedError } from '../../src/utils/error-page.ts';

function createCaptain(fix: () => void) {
  const requests: string[] = [];
  const captain = Object.create(Captain.prototype);
  const stateManager = new StateManager({} as ExperienceTracker, {} as KnowledgeTracker);
  stateManager.updateStateFromBasic('/workspace');
  captain.explorBot = { stateManager: () => stateManager };
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

  it('does not hand over a page it already failed to unblock', async () => {
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

describe('StateManager blocked pages', () => {
  const signIn = '- main:\n  - heading "Sign in"\n  - textbox "Email"\n  - textbox "Password"\n  - button "Sign in"';
  const issues = '- main:\n  - heading "Issues"\n  - table:\n    - row:\n      - cell "Bug"\n  - link "New Issue"\n  - searchbox "Search"';

  function blockedAt(url: string, ariaSnapshot: string | null) {
    const stateManager = new StateManager({} as ExperienceTracker, {} as KnowledgeTracker);
    stateManager.markBlocked(new ActionResult({ url, ariaSnapshot }), 'sign-in required');
    return stateManager;
  }

  it('recognizes another page with the same structure as blocked', () => {
    const stateManager = blockedAt('/workspace', signIn);
    expect(stateManager.isPageBlocked(new ActionResult({ url: '/projects', ariaSnapshot: signIn }))).toBe(true);
  });

  it('does not treat a page with a different structure as blocked', () => {
    const stateManager = blockedAt('/workspace', signIn);
    expect(stateManager.isPageBlocked(new ActionResult({ url: '/issues', ariaSnapshot: issues }))).toBe(false);
  });

  it('matches only the same URL when a snapshot is missing', () => {
    const stateManager = blockedAt('/workspace', null);
    expect(stateManager.isPageBlocked(new ActionResult({ url: '/workspace', ariaSnapshot: null }))).toBe(true);
    expect(stateManager.isPageBlocked(new ActionResult({ url: '/projects', ariaSnapshot: null }))).toBe(false);
  });

  it('records each blocked URL once', () => {
    const stateManager = blockedAt('/workspace', signIn);
    stateManager.markBlocked(new ActionResult({ url: '/workspace', ariaSnapshot: signIn }), 'again');
    stateManager.markBlocked(new ActionResult({ url: '/projects', ariaSnapshot: signIn }), 'sign-in required');
    expect(stateManager.getBlockedPages().map((page) => page.url)).toEqual(['/workspace', '/projects']);
  });
});
