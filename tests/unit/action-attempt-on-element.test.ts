import { describe, expect, it } from 'bun:test';
import * as codeceptjs from 'codeceptjs';
import Action from '../../src/action.ts';

describe('Action.attemptOnElement', () => {
  it('sets elementIndex on the step the command starts, and only on that one', async () => {
    const steps = [{ opts: { exact: true } }, { opts: {} }];
    const fake: any = {
      attempt: async () => {
        for (const step of steps) codeceptjs.event.dispatcher.emit(codeceptjs.event.step.started, step);
        return true;
      },
    };

    expect(await Action.prototype.attemptOnElement.call(fake, 'I.click("Pin")', 2)).toBe(true);
    expect(steps[0].opts).toEqual({ exact: true, elementIndex: 2 });
    expect(steps[1].opts).toEqual({});
  });

  it('detaches when the command fails before any step starts', async () => {
    const fake: any = { attempt: async () => false };
    await Action.prototype.attemptOnElement.call(fake, 'I.click("Pin")', 2);
    const step: any = { opts: {} };
    codeceptjs.event.dispatcher.emit(codeceptjs.event.step.started, step);
    expect(step.opts).toEqual({});
  });
});
