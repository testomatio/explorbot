import { describe, expect, it } from 'bun:test';
import { formatSessionTest } from '../../src/ai/planner/session-dedup.ts';
import { Plan, Test, TestResult } from '../../src/test-plan.ts';

describe('formatSessionTest', () => {
  it('formats a pending test with defaults', () => {
    const plan = new Plan('Plan');
    const test = new Test('Search records', 'normal', ['Results shown'], '/', ['Search']);

    expect(formatSessionTest(plan, test)).toBe('/ | default | pending | Search records');
  });

  it('marks a started test with a note as unfinished', () => {
    const plan = new Plan('Plan');
    plan.url = '/records';
    const test = new Test('Edit a record', 'normal', ['Record updated'], '/records', ['Edit']);
    test.style = 'stress';
    test.addNote('Editor did not open');

    expect(formatSessionTest(plan, test)).toBe('/records | stress | unfinished | Edit a record — Editor did not open');
  });

  it('includes the last note for a failed test', () => {
    const plan = new Plan('Plan');
    const test = new Test('Delete a record', 'normal', ['Record removed'], '/', ['Delete']);
    test.addNote('Delete control opened');
    test.addNote('Confirmation failed');
    test.finish(TestResult.FAILED);

    expect(formatSessionTest(plan, test)).toBe('/ | default | failed | Delete a record — Confirmation failed');
  });

  it('does not append notes to successful tests', () => {
    const plan = new Plan('Plan');
    const test = new Test('Create a record', 'normal', ['Record created'], '/', ['Create']);
    test.addNote('Record appeared');
    test.finish(TestResult.PASSED);

    expect(formatSessionTest(plan, test)).toBe('/ | default | passed | Create a record');
  });
});
