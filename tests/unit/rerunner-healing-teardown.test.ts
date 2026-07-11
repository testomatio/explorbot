import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as codeceptjs from 'codeceptjs';
import Container from 'codeceptjs/lib/container';
import heal from 'codeceptjs/lib/heal';
import codeceptOutput from 'codeceptjs/lib/output';
import { Rerunner } from '../../src/ai/rerunner.ts';

const dispatcher = (codeceptjs as any).event.dispatcher;
const healMod = (heal as any).default || heal;

function countListeners(event: string): number {
  if (typeof dispatcher.listeners === 'function') return dispatcher.listeners(event).length;
  if (typeof dispatcher.listenerCount === 'function') return dispatcher.listenerCount(event);
  return EventEmitter.listenerCount(dispatcher, event);
}

// setupPlugins() registers the aiTrace plugin, which reads Container.helpers() and
// codeceptjs output. Without a live codeceptjs container (this unit env) helpers is
// null and output.warn is absent, so aiTrace throws. Neutralize both so it disables
// itself (finds no helper -> warns -> returns) instead of crashing.
const originalHelpers = (Container as any).helpers;
beforeAll(() => {
  (codeceptOutput as any).warn ||= () => {};
  (Container as any).helpers = () => ({});
});
afterAll(() => {
  (Container as any).helpers = originalHelpers;
});

function buildRerunner(): any {
  return new Rerunner({ getConfig: () => ({ ai: { agents: {} } }) } as any, {} as any);
}

function counts() {
  return {
    stepAfter: countListeners('step.after'),
    testBefore: countListeners('test.before'),
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
