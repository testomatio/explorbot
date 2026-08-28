import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import codeceptjs from 'codeceptjs';
import Action from '../../src/action.ts';
import { clearActivity } from '../../src/activity.ts';
import { ConfigParser } from '../../src/config.ts';

const { recorder } = codeceptjs;

function buildAction(click: () => unknown): Action {
  const action = new Action({ click } as any, {} as any);
  action.playwrightHelper = {};
  return action;
}

async function recorderStillExecutes(): Promise<boolean> {
  let ran = false;
  await recorder.add(() => {
    ran = true;
  });
  await recorder.promise().catch(() => {});
  return ran;
}

describe('Action recorder recovery', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  // executing an action sets a global activity that is cleared on a timer, and a listener
  // registered while it is still set is replayed the stale entry
  afterEach(() => {
    clearActivity(true);
  });

  it('fails loudly when the recorder is stopped instead of reporting a phantom success', async () => {
    recorder.start();
    recorder.stop();

    const action = buildAction(() => undefined);

    await expect(action.execute("I.click('x')")).rejects.toThrow(/recorder is stopped/);
  });

  it('leaves the recorder running so the command after a phantom one reaches the browser', async () => {
    recorder.start();
    recorder.stop();

    const action = buildAction(() => undefined);
    await action.execute("I.click('x')").catch(() => {});

    expect(recorder.isRunning()).toBe(true);
    expect(await recorderStillExecutes()).toBe(true);
  });
});
