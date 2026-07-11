import { describe, expect, it } from 'bun:test';
import * as codeceptjs from 'codeceptjs';
import Explorer from '../../src/explorer.ts';

const dispatcher = (codeceptjs as any).event.dispatcher;
const TRACKED_EVENTS = ['step.passed', 'step.failed', 'test.after'];

// The CodeceptJS dispatcher's listener introspection (listenerCount/listeners) is
// unreliable under the bun version CI runs, so track live registrations by wrapping
// on()/off() (which work everywhere). registered[event] holds the handlers currently
// attached — the leak bug leaves a handler behind because off() used the wrong ref.
function trackRegistrations(): { registered: Map<string, Set<any>>; restore: () => void } {
  const registered = new Map<string, Set<any>>(TRACKED_EVENTS.map((event) => [event, new Set()]));
  const realOn = dispatcher.on.bind(dispatcher);
  const realOff = dispatcher.off.bind(dispatcher);
  dispatcher.on = (event: string, fn: any) => {
    registered.get(event)?.add(fn);
    return realOn(event, fn);
  };
  dispatcher.off = (event: string, fn: any) => {
    registered.get(event)?.delete(fn);
    return realOff(event, fn);
  };
  return {
    registered,
    restore: () => {
      dispatcher.on = realOn;
      dispatcher.off = realOff;
    },
  };
}

function buildExplorer() {
  const explorer = Object.assign(Object.create(Explorer.prototype), {
    reporter: { reportTestStart: async () => {} },
    stateManager: { getCurrentState: () => null },
    otherTabs: [],
    playwrightHelper: { page: { isClosed: () => false } },
  }) as any;
  explorer.closeOtherTabs = async () => {};
  explorer.ensurePageAvailable = async () => true;
  explorer.watchActiveTestPage = () => {};
  explorer.unwatchActiveTestPages = () => {};
  return explorer as Explorer;
}

function buildTest() {
  return {
    scenario: 'listener leak regression',
    start: () => {},
    addStep: () => {},
    setActiveNoteScreenshot: () => {},
    getPrintableNotes: () => '',
  } as any;
}

describe('Explorer step listener cleanup', () => {
  it('removes every listener it registers after a test lifecycle', async () => {
    const { registered, restore } = trackRegistrations();
    try {
      await buildExplorer().startTest(buildTest());
      expect(registered.get('step.passed')!.size).toBe(1);
      expect(registered.get('test.after')!.size).toBe(1);

      dispatcher.emit('test.after');

      expect(registered.get('step.passed')!.size).toBe(0);
      expect(registered.get('step.failed')!.size).toBe(0);
      expect(registered.get('test.after')!.size).toBe(0);
    } finally {
      restore();
    }
  });

  it('does not accumulate listeners across repeated startTest cycles', async () => {
    const { registered, restore } = trackRegistrations();
    try {
      for (let i = 0; i < 5; i++) {
        await buildExplorer().startTest(buildTest());
        dispatcher.emit('test.after');
      }
      expect(registered.get('step.passed')!.size).toBe(0);
      expect(registered.get('step.failed')!.size).toBe(0);
      expect(registered.get('test.after')!.size).toBe(0);
    } finally {
      restore();
    }
  });
});
