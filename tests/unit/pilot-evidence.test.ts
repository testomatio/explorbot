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

    expect((pilot as any).hasSuccessfulAssertionEvidence(state, conversation)).toBe(true);
    expect((pilot as any).formatSuccessfulAssertions(state, conversation)).toContain('PASS state verification');
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

    expect((pilot as any).hasSuccessfulAssertionEvidence(state, conversation)).toBe(true);
    expect((pilot as any).formatSuccessfulAssertions(state, conversation)).toContain('PASS verify');
  });
});
