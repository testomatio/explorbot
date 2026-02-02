import { describe, expect, it, mock } from 'bun:test';
import { PlanLoadCommand } from '../../src/commands/plan-load-command.js';
import type { ExplorBot } from '../../src/explorbot.js';
import { Plan } from '../../src/test-plan.js';

function createMockExplorBot(overrides: Partial<ExplorBot> = {}): ExplorBot {
  return {
    loadPlan: mock(() => new Plan('Test')),
    ...overrides,
  } as unknown as ExplorBot;
}

describe('PlanLoadCommand', () => {
  it('should load plan via loadPlan', async () => {
    const mockPlan = new Plan('Test Plan');
    mockPlan.addTest({ scenario: 'Test 1' } as any);
    const loadPlan = mock(() => mockPlan);
    const explorBot = createMockExplorBot({ loadPlan });

    const cmd = new PlanLoadCommand(explorBot);
    await cmd.execute('myplan.md');

    expect(loadPlan).toHaveBeenCalledWith('myplan.md');
  });

  it('should throw if no filename provided', async () => {
    const explorBot = createMockExplorBot();
    const cmd = new PlanLoadCommand(explorBot);

    expect(cmd.execute('')).rejects.toThrow('Filename required');
  });

  it('should throw if no filename provided (whitespace only)', async () => {
    const explorBot = createMockExplorBot();
    const cmd = new PlanLoadCommand(explorBot);

    expect(cmd.execute('   ')).rejects.toThrow('Filename required');
  });

  it('should match name', () => {
    const explorBot = createMockExplorBot();
    const cmd = new PlanLoadCommand(explorBot);
    expect(cmd.matches('plan:load')).toBe(true);
    expect(cmd.matches('unknown')).toBe(false);
  });
});
