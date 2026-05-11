import { beforeEach, describe, expect, test } from 'bun:test';
import { ExploreCommand } from '../../src/commands/explore-command.ts';
import { ConfigParser } from '../../src/config.ts';
import type { ExplorBot } from '../../src/explorbot.ts';
import { Plan, Test } from '../../src/test-plan.ts';

beforeEach(() => {
  ConfigParser.resetForTesting();
  ConfigParser.setupTestConfig();
});

function makeCommand(): ExploreCommand {
  const explorBot = {} as unknown as ExplorBot;
  return new ExploreCommand(explorBot);
}

function parse(raw: string | undefined) {
  return (makeCommand() as any).parseConfigure(raw);
}

describe('ExploreCommand.parseConfigure', () => {
  test('undefined → reuse off, ratio 1.0', () => {
    expect(parse(undefined)).toEqual({ enabled: false, newRatio: 1.0 });
  });

  test('empty string → reuse off', () => {
    expect(parse('')).toEqual({ enabled: false, newRatio: 1.0 });
  });

  test('new:25% → reuse on, ratio 0.25', () => {
    const cfg = parse('new:25%');
    expect(cfg.enabled).toBe(true);
    expect(cfg.newRatio).toBe(0.25);
  });

  test('new=0.5 (decimal, equals separator) → ratio 0.5', () => {
    const cfg = parse('new=0.5');
    expect(cfg.enabled).toBe(true);
    expect(cfg.newRatio).toBe(0.5);
  });

  test('new:200% → invalid, ignored, reuse stays off', () => {
    const cfg = parse('new:200%');
    expect(cfg.enabled).toBe(false);
    expect(cfg.newRatio).toBe(1.0);
  });

  test('from=path.md → reuse on, fromPath set', () => {
    const cfg = parse('from=path/to/plan.md');
    expect(cfg.enabled).toBe(true);
    expect(cfg.fromPath).toBe('path/to/plan.md');
  });

  test('style=normal,curious → styles set, reuse stays off', () => {
    const cfg = parse('style=normal,curious');
    expect(cfg.enabled).toBe(false);
    expect(cfg.styles).toEqual(['normal', 'curious']);
  });

  test('style=normal,bogus → only valid kept', () => {
    const cfg = parse('style=normal,bogus');
    expect(cfg.styles).toEqual(['normal']);
  });

  test('subpages=both', () => {
    const cfg = parse('subpages=both');
    expect(cfg.subpages).toBe('both');
  });

  test('subpages=invalid → ignored', () => {
    const cfg = parse('subpages=garbage');
    expect(cfg.subpages).toBeUndefined();
  });

  test.each([
    ['pick_by=priority', 'priority'],
    ['pick_by=random', 'random'],
    ['pick_by=index', 'index'],
    ['pickby=random', 'random'],
    ['pick-by=index', 'index'],
  ])('%s → pickBy=%s', (raw, expected) => {
    const cfg = parse(raw);
    expect(cfg.pickBy).toBe(expected);
  });

  test('pick_by=garbage → ignored', () => {
    const cfg = parse('pick_by=garbage');
    expect(cfg.pickBy).toBeUndefined();
  });

  test('priority=critical,high → priorities set', () => {
    const cfg = parse('priority=critical,high');
    expect(cfg.priorities).toEqual(['critical', 'high']);
  });

  test('priority=critical,bogus → only valid kept', () => {
    const cfg = parse('priority=critical,bogus,high');
    expect(cfg.priorities).toEqual(['critical', 'high']);
  });

  test('priority is case-insensitive', () => {
    const cfg = parse('priority=CRITICAL,High');
    expect(cfg.priorities).toEqual(['critical', 'high']);
  });

  test('priority alone does NOT enable reuse', () => {
    const cfg = parse('priority=high');
    expect(cfg.enabled).toBe(false);
    expect(cfg.priorities).toEqual(['high']);
  });

  test('combined spec parses every key', () => {
    const cfg = parse('new:25%;style=normal;pick_by=random;subpages=none;from=foo.md');
    expect(cfg).toEqual({
      enabled: true,
      newRatio: 0.25,
      styles: ['normal'],
      pickBy: 'random',
      subpages: 'none',
      fromPath: 'foo.md',
    });
  });

  test('trailing semicolon and whitespace tolerated', () => {
    const cfg = parse(' new : 25% ; pick_by = random ; ');
    expect(cfg.enabled).toBe(true);
    expect(cfg.newRatio).toBe(0.25);
    expect(cfg.pickBy).toBe('random');
  });
});

describe('ExploreCommand picking algorithm (via dry-run execute)', () => {
  function buildPlan(): Plan {
    const plan = new Plan('Demo');
    plan.url = '/demo';
    const tests = [
      new Test('A normal task', 'normal', 'ok', '/demo'),
      new Test('B critical task', 'critical', 'ok', '/demo'),
      new Test('C important task', 'important', 'ok', '/demo'),
      new Test('D high task', 'high', 'ok', '/demo'),
      new Test('E low task', 'low', 'ok', '/demo'),
      new Test('F important task', 'important', 'ok', '/demo'),
      new Test('G critical task', 'critical', 'ok', '/demo'),
    ];
    for (const t of tests) plan.addTest(t);
    return plan;
  }

  function setupCommand(plan: Plan, _configure: string, maxTests: number) {
    const explorBot = {
      getExplorer: () => ({ getStateManager: () => ({ getCurrentState: () => ({ url: '/demo' }) }) }),
      generatePlanFilename: () => 'demo.md',
      loadPlans: () => [plan],
      agentPlanner: () => ({ registerPlanInSession: () => {}, collectSubPageCandidates: () => [], pickNextSubPage: async () => null }),
      setCurrentPlan: () => {},
      visit: async () => {},
      savePlans: () => null,
      printSessionAnalysis: async () => {},
      agentHistorian: () => ({ getSavedFiles: () => [] }),
      plan: async () => undefined,
      getCurrentPlan: () => undefined,
      lastPlanError: null,
    } as unknown as ExplorBot;

    const cmd = new ExploreCommand(explorBot);
    cmd.maxTests = maxTests;
    cmd.dryRun = true;
    return cmd;
  }

  function executedTests(plan: Plan): Test[] {
    return plan.tests.filter((t) => t.startTime != null).sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  }

  test('pick_by=priority — criticals first, then important', async () => {
    const plan = buildPlan();
    const cmd = setupCommand(plan, 'new:0%;pick_by=priority', 4);
    await cmd.execute('--configure "new:0%;pick_by=priority" --dry-run');
    const ran = executedTests(plan);
    expect(ran.length).toBe(4);
    expect(ran.map((t) => t.priority)).toEqual(['critical', 'critical', 'important', 'important']);
  });

  test('pick_by=index — file order preserved', async () => {
    const plan = buildPlan();
    const cmd = setupCommand(plan, 'new:0%;pick_by=index', 4);
    await cmd.execute('--configure "new:0%;pick_by=index" --dry-run');
    const ran = executedTests(plan);
    expect(ran.map((t) => t.scenario)).toEqual(['A normal task', 'B critical task', 'C important task', 'D high task']);
  });

  test('pick_by=random — picks 4 distinct, may include any priority', async () => {
    const plan = buildPlan();
    const cmd = setupCommand(plan, 'new:0%;pick_by=random', 4);
    await cmd.execute('--configure "new:0%;pick_by=random" --dry-run');
    const ran = executedTests(plan);
    expect(ran.length).toBe(4);
    expect(new Set(ran).size).toBe(4);
  });

  test('budget split — new:50% with max-tests 4 picks 2 old', async () => {
    const plan = buildPlan();
    const cmd = setupCommand(plan, 'new:50%;pick_by=priority', 4);
    await cmd.execute('--configure "new:50%;pick_by=priority" --dry-run');
    const ran = executedTests(plan);
    expect(ran.length).toBe(2);
    expect(ran.map((t) => t.priority)).toEqual(['critical', 'critical']);
  });

  test('style filter narrows pool — only normal-style tests considered', async () => {
    const plan = buildPlan();
    for (const t of plan.tests) {
      if (t.priority === 'critical') t.style = 'curious';
      else t.style = 'normal';
    }
    const cmd = setupCommand(plan, 'new:0%;style=normal;pick_by=priority', 5);
    await cmd.execute('--configure "new:0%;style=normal;pick_by=priority" --dry-run');
    const ran = executedTests(plan);
    expect(ran.every((t) => t.style === 'normal')).toBe(true);
    expect(ran.some((t) => t.priority === 'critical')).toBe(false);
  });

  test('disabled tests do not run (un-picked stay enabled=false)', async () => {
    const plan = buildPlan();
    const cmd = setupCommand(plan, 'new:0%;pick_by=priority', 2);
    await cmd.execute('--configure "new:0%;pick_by=priority" --dry-run');
    const ran = executedTests(plan);
    expect(ran.length).toBe(2);
    const notRun = plan.tests.filter((t) => t.startTime == null);
    expect(notRun.every((t) => t.enabled === false)).toBe(true);
  });

  test('priority filter restricts old picks to allowed priorities', async () => {
    const plan = buildPlan();
    const cmd = setupCommand(plan, 'new:0%;priority=critical,high', 5);
    await cmd.execute('--configure "new:0%;priority=critical,high" --dry-run');
    const ran = executedTests(plan);
    expect(ran.length).toBe(3); // 2 critical + 1 high in pool
    expect(ran.every((t) => ['critical', 'high'].includes(t.priority))).toBe(true);
  });

  test('priority filter + pick_by=random — only matching priorities run', async () => {
    const plan = buildPlan();
    const cmd = setupCommand(plan, 'new:0%;priority=high,critical;pick_by=random', 3);
    await cmd.execute('--configure "new:0%;priority=high,critical;pick_by=random" --dry-run');
    const ran = executedTests(plan);
    expect(ran.length).toBe(3);
    expect(ran.every((t) => ['critical', 'high'].includes(t.priority))).toBe(true);
  });
});

describe('ExploreCommand priority filter applies to NEW tests too', () => {
  test('new tests with disallowed priorities get disabled and do not run', async () => {
    const fakePlan = new Plan('Live');
    fakePlan.url = '/live';
    fakePlan.addTest(new Test('seed loaded', 'normal', 'ok', '/live'));

    let planCalled = 0;
    const explorBot = {
      getExplorer: () => ({ getStateManager: () => ({ getCurrentState: () => ({ url: '/live' }) }) }),
      generatePlanFilename: () => 'live.md',
      loadPlans: () => [fakePlan],
      agentPlanner: () => ({ registerPlanInSession: () => {}, collectSubPageCandidates: () => [], pickNextSubPage: async () => null }),
      setCurrentPlan: () => {},
      visit: async () => {},
      savePlans: () => null,
      printSessionAnalysis: async () => {},
      agentHistorian: () => ({ getSavedFiles: () => [] }),
      // Simulated planner: appends 4 mixed-priority new tests on first call
      plan: async () => {
        planCalled++;
        if (planCalled === 1) {
          fakePlan.addTest(new Test('new low scenario', 'low', 'ok', '/live'));
          fakePlan.addTest(new Test('new critical scenario', 'critical', 'ok', '/live'));
          fakePlan.addTest(new Test('new normal scenario', 'normal', 'ok', '/live'));
          fakePlan.addTest(new Test('new high scenario', 'high', 'ok', '/live'));
        }
      },
      getCurrentPlan: () => fakePlan,
      lastPlanError: null,
    } as unknown as ExplorBot;

    const cmd = new ExploreCommand(explorBot);
    cmd.maxTests = 5;
    cmd.dryRun = true;
    await cmd.execute('--configure "new:80%;priority=critical,high" --dry-run');

    const ran = fakePlan.tests.filter((t) => t.startTime != null);
    expect(ran.every((t) => ['critical', 'high'].includes(t.priority))).toBe(true);
    expect(ran.some((t) => t.scenario === 'new critical scenario')).toBe(true);
    expect(ran.some((t) => t.scenario === 'new high scenario')).toBe(true);
    const skippedNew = fakePlan.tests.filter((t) => t.scenario.startsWith('new ') && t.startTime == null);
    expect(skippedNew.every((t) => t.enabled === false)).toBe(true);
    expect(skippedNew.map((t) => t.priority).sort()).toEqual(['low', 'normal']);
  });
});
