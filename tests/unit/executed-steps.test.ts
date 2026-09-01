import codeceptjs from 'codeceptjs';
import { describe, expect, it } from 'bun:test';
import { attachStepLogger, type ExecutedStep } from '../../src/action.ts';
import { formatExecutedSteps } from '../../src/ai/tools.ts';

function step(code: string) {
  return { name: code.replace(/^I\./, '').replace(/\(.*/, ''), args: [], toCode: () => code };
}

describe('executed steps', () => {
  it('records each command with its status and stops at the failing one', () => {
    const steps: ExecutedStep[] = [];
    const detachSteps = attachStepLogger(steps);

    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.passed, step("I.amOnPage('/suite/1')"));
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.failed, step("I.waitForElement('Some Title')"), new Error('still not present on page after 30 sec'));

    detachSteps();

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ command: "I.amOnPage('/suite/1')", success: true });
    expect(steps[1]?.success).toBe(false);
    expect(steps[1]?.error).toContain('still not present');
  });

  it('reports a successful command even when a later one fails', () => {
    const report = formatExecutedSteps(
      [
        { command: "I.amOnPage('/suite/1')", success: true },
        { command: "I.waitForElement('Some Title')", success: false, error: 'not present' },
      ],
      3
    );

    expect(report).toContain("OK I.amOnPage('/suite/1')");
    expect(report).toContain("FAILED I.waitForElement('Some Title')");
    expect(report).toContain('NOT RUN 1 more');
  });

  it('reports when nothing ran', () => {
    expect(formatExecutedSteps([], 2)).toBe('No command ran of 2 requested.');
  });

  it('ignores unwind flushes after the first failure so passed steps stay passed', () => {
    const steps: ExecutedStep[] = [];
    const detachSteps = attachStepLogger(steps);

    const fill = step("I.fillField('Title', 'My test')");
    const openPicker = step("I.click('Select suite')");
    const pickSuite = step("I.click('Test Suite for GraphQL Links')");
    const save = step("I.click('Save')");

    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.passed, fill);
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.passed, openPicker);
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.failed, pickSuite, new Error('2 elements found'));
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.failed, fill, new Error('2 elements found'));
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.failed, openPicker, new Error('2 elements found'));
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.failed, save, new Error('2 elements found'));

    detachSteps();

    expect(steps).toHaveLength(3);
    expect(steps[0]).toMatchObject({ command: "I.fillField('Title', 'My test')", success: true });
    expect(steps[1]).toMatchObject({ command: "I.click('Select suite')", success: true });
    expect(steps[2]?.success).toBe(false);
    const report = formatExecutedSteps(steps, 4);
    expect(report).toContain("OK I.click('Select suite')");
    expect(report).toContain('NOT RUN 1 more');
  });

  it('lets a retried step upgrade from failed to passed', () => {
    const steps: ExecutedStep[] = [];
    const detachSteps = attachStepLogger(steps);

    const flaky = step("I.click('Save')");
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.failed, flaky, new Error('execution context was destroyed'));
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.passed, flaky);
    const next = step("I.see('Saved')");
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.passed, next);

    detachSteps();

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ command: "I.click('Save')", success: true });
    expect(steps[0]?.error).toBeUndefined();
    expect(steps[1]).toMatchObject({ command: "I.see('Saved')", success: true });
  });
});
