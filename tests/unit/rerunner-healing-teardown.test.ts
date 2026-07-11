import { beforeAll, describe, expect, it } from 'bun:test';
import * as codeceptjs from 'codeceptjs';
import heal from 'codeceptjs/lib/heal';
import codeceptOutput from 'codeceptjs/lib/output';
import { Rerunner } from '../../src/ai/rerunner.ts';

const dispatcher = (codeceptjs as any).event.dispatcher;
const healMod = (heal as any).default || heal;

beforeAll(() => {
  // codeceptjs/lib/output has no `warn` in this build; the aiTrace plugin calls it
  // only when no browser helper is registered (never in a real rerun).
  (codeceptOutput as any).warn ||= () => {};
});

function buildRerunner(): any {
  return new Rerunner({ getConfig: () => ({ ai: { agents: {} } }) } as any, {} as any);
}

function counts() {
  return {
    stepAfter: dispatcher.listenerCount('step.after'),
    testBefore: dispatcher.listenerCount('test.before'),
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('Rerunner healing plugin wiring', () => {
  it('wires process-wide handlers only once across repeated setup/teardown cycles', async () => {
    const rerunner = buildRerunner();
    const baseline = counts();

    rerunner.setupPlugins();
    rerunner.teardownHealing();
    await settle();
    const afterFirst = counts();

    rerunner.setupPlugins();
    rerunner.teardownHealing();
    rerunner.setupPlugins();
    rerunner.teardownHealing();
    await settle();
    const afterThird = counts();

    expect(afterFirst.stepAfter).toBeGreaterThan(baseline.stepAfter);
    expect(afterThird.stepAfter).toBe(afterFirst.stepAfter);
    expect(afterThird.testBefore).toBe(afterFirst.testBefore);
  });

  it('re-installs recipes on setup and clears them on teardown', () => {
    const rerunner = buildRerunner();

    rerunner.setupPlugins();
    expect(healMod.recipes['explorbot-ai-healer']).toBeDefined();

    rerunner.teardownHealing();
    expect(healMod.recipes['explorbot-ai-healer']).toBeUndefined();

    rerunner.setupPlugins();
    expect(healMod.recipes['explorbot-ai-healer']).toBeDefined();
  });
});
