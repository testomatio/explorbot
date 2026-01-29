import { describe, expect, it, mock } from 'bun:test';
import type { ExplorBot } from '../../src/explorbot.js';
import { Plan } from '../../src/test-plan.js';
import { PlanSaveCommand } from '../../src/commands/plan-save-command.js';

function createMockExplorBot(overrides: Partial<ExplorBot> = {}): ExplorBot {
  return {
    getCurrentPlan: mock(() => null),
    savePlan: mock(() => '/output/plans/test.md'),
    ...overrides,
  } as unknown as ExplorBot;
}

describe('PlanSaveCommand', () => {
  it('should save plan with filename', async () => {
    const mockPlan = new Plan('Test Plan');
    const savePlan = mock(() => '/output/plans/myplan.md');
    const explorBot = createMockExplorBot({
      getCurrentPlan: () => mockPlan,
      savePlan,
    });

    const cmd = new PlanSaveCommand(explorBot);
    await cmd.execute('myplan.md');

    expect(savePlan).toHaveBeenCalledWith('myplan.md');
  });

  it('should save plan without filename', async () => {
    const mockPlan = new Plan('Test Plan');
    const savePlan = mock(() => '/output/plans/test-plan.md');
    const explorBot = createMockExplorBot({
      getCurrentPlan: () => mockPlan,
      savePlan,
    });

    const cmd = new PlanSaveCommand(explorBot);
    await cmd.execute('');

    expect(savePlan).toHaveBeenCalledWith(undefined);
  });

  it('should throw if no plan to save', async () => {
    const explorBot = createMockExplorBot({
      getCurrentPlan: () => undefined,
    });

    const cmd = new PlanSaveCommand(explorBot);
    expect(cmd.execute('')).rejects.toThrow('No plan to save');
  });

  it('should match name', () => {
    const explorBot = createMockExplorBot();
    const cmd = new PlanSaveCommand(explorBot);
    expect(cmd.matches('plan:save')).toBe(true);
    expect(cmd.matches('unknown')).toBe(false);
  });
});
