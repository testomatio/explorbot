import { describe, expect, it } from 'bun:test';
import { Pilot } from '../../src/ai/pilot.ts';

function buildPilot(): Pilot {
  return Object.assign(Object.create(Pilot.prototype), {}) as Pilot;
}

describe('Pilot evidence', () => {
  it('treats passed state verifications as successful assertion evidence', () => {
    const pilot = buildPilot();
    const state = { verifications: { 'Heading is visible': true } };
    const conversation = { getToolExecutions: () => [] };

    expect((pilot as any).hasSuccessfulCheckEvidence(state, conversation)).toBe(true);
    expect((pilot as any).formatSuccessfulAssertions(state, conversation)).toContain('state verification (passed)');
  });

  it('treats successful check tools as assertion evidence', () => {
    const pilot = buildPilot();
    const state = {};
    const conversation = {
      getToolExecutions: () => [
        {
          toolName: 'verify',
          wasSuccessful: true,
          input: { assertion: 'Heading is visible' },
          output: { message: 'Verification passed: Heading is visible' },
        },
      ],
    };

    expect((pilot as any).hasSuccessfulCheckEvidence(state, conversation)).toBe(true);
    expect((pilot as any).formatSuccessfulAssertions(state, conversation)).toContain('CHECK verify (executed successfully)');
  });

  it('does not treat context reads as completion evidence', () => {
    const pilot = buildPilot();
    const task = { hasAchievedAny: () => false };
    const state = {};
    const conversation = {
      getToolExecutions: () => [
        {
          toolName: 'context',
          wasSuccessful: true,
          input: { reason: 'stale context' },
          output: { message: 'Snapshot refreshed' },
        },
      ],
    };

    expect((pilot as any).hasCompletionEvidence(task, state, conversation)).toBe(false);
  });

  it('does not treat research reads as completion evidence', () => {
    const pilot = buildPilot();
    const task = { hasAchievedAny: () => false };
    const state = {};
    const conversation = {
      getToolExecutions: () => [
        {
          toolName: 'research',
          wasSuccessful: true,
          input: { reason: 'need UI map' },
          output: { analysis: 'The page shows a list of suites.' },
        },
      ],
    };

    expect((pilot as any).hasCompletionEvidence(task, state, conversation)).toBe(false);
  });

  it('treats achieved task notes as completion evidence', () => {
    const pilot = buildPilot();
    const task = { hasAchievedAny: () => true };
    const state = {};
    const conversation = { getToolExecutions: () => [] };

    expect((pilot as any).hasCompletionEvidence(task, state, conversation)).toBe(true);
  });
});
