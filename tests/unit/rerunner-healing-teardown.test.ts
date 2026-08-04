import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import * as codeceptjs from 'codeceptjs';
import Container from 'codeceptjs/lib/container';
import heal from 'codeceptjs/lib/heal';
import codeceptOutput from 'codeceptjs/lib/output';
import { Rerunner } from '../../src/ai/rerunner.ts';

const dispatcher = (codeceptjs as any).event.dispatcher;
const healMod = (heal as any).default || heal;

// The CodeceptJS dispatcher's listener introspection is unreliable under CI's bun,
// so count how many times a handler is REGISTERED by wrapping on() (which works
// everywhere). The once-guard must register step.after exactly once no matter how
// many setup/teardown cycles run.
function trackOnCalls(): { onCounts: Map<string, number>; restore: () => void } {
  const onCounts = new Map<string, number>();
  const realOn = dispatcher.on.bind(dispatcher);
  dispatcher.on = (event: string, fn: any) => {
    onCounts.set(event, (onCounts.get(event) ?? 0) + 1);
    return realOn(event, fn);
  };
  return {
    onCounts,
    restore: () => {
      dispatcher.on = realOn;
    },
  };
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
  return new Rerunner({ explorer: {}, ai: {}, config: { ai: { agents: {} } }, stateManager: {}, knowledgeTracker: {}, requestStore: {}, playwrightRecorder: {} } as any, {} as any);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('Rerunner healing plugin wiring', () => {
  it('wires process-wide handlers only once across repeated setup/teardown cycles', async () => {
    (Rerunner as any).pluginsWired = false;
    const { onCounts, restore } = trackOnCalls();
    try {
      const rerunner = buildRerunner();

      rerunner.setupPlugins();
      rerunner.teardownHealing();
      await settle();
      const afterFirst = onCounts.get('step.after') ?? 0;

      rerunner.setupPlugins();
      rerunner.teardownHealing();
      rerunner.setupPlugins();
      rerunner.teardownHealing();
      await settle();
      const afterThird = onCounts.get('step.after') ?? 0;

      expect(afterFirst).toBe(1);
      expect(afterThird).toBe(1);
    } finally {
      restore();
    }
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
