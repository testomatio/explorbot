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
});
