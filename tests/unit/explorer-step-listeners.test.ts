import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import Explorer from '../../src/explorer.ts';

function buildExplorer(dispatcher: EventEmitter) {
  const explorer = Object.assign(Object.create(Explorer.prototype), {
    eventDispatcher: dispatcher,
    reporter: { reportTestStart: async () => {} },
    stateManager: { getCurrentState: () => null, otherTabs: [] },
    playwrightHelper: { page: { isClosed: () => false } },
  }) as any;
  explorer.closeOtherTabs = async () => {};
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
    const dispatcher = new EventEmitter();
    await buildExplorer(dispatcher).beginTest(buildTest());
    expect(dispatcher.listenerCount('step.passed')).toBe(1);
    expect(dispatcher.listenerCount('test.after')).toBe(1);

    dispatcher.emit('test.after');

    expect(dispatcher.listenerCount('step.passed')).toBe(0);
    expect(dispatcher.listenerCount('step.failed')).toBe(0);
    expect(dispatcher.listenerCount('test.after')).toBe(0);
  });

  it('does not accumulate listeners across repeated startTest cycles', async () => {
    const dispatcher = new EventEmitter();
    for (let i = 0; i < 5; i++) {
      await buildExplorer(dispatcher).beginTest(buildTest());
      dispatcher.emit('test.after');
    }
    expect(dispatcher.listenerCount('step.passed')).toBe(0);
    expect(dispatcher.listenerCount('step.failed')).toBe(0);
    expect(dispatcher.listenerCount('test.after')).toBe(0);
  });
});
