import { beforeEach, describe, expect, it } from 'bun:test';
import codeceptjs from 'codeceptjs';
import Action from '../../src/action.ts';
import { ConfigParser } from '../../src/config.ts';

const { recorder } = codeceptjs;

function buildAction(click: () => unknown): Action {
  const action = new Action({ click } as any, {} as any);
  action.playwrightHelper = {};
  return action;
}

async function recorderStillExecutes(): Promise<boolean> {
  let ran = false;
  await recorder.add('probe', () => {
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

  it('recovers the recorder after a failed step so the next command still executes', async () => {
    recorder.start();

    // the task chain codeceptjs builds for every I.* command, see lib/step/record.js
    const action = buildAction(() => {
      recorder.add('click: x', () => {
        throw new Error('element (x) not found');
      });
      recorder.add('step passed', () => {});
      recorder.catch((err: any) => {
        throw err;
      });
      recorder.add('return result', () => undefined);
      return recorder.promise();
    });

    await expect(action.execute("I.click('x')")).rejects.toThrow(/element \(x\) not found/);

    // deferred catch handlers land on a later tick, as they do between two AI turns
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(recorder.isRunning()).toBe(true);
    expect(await recorderStillExecutes()).toBe(true);
  });
});
