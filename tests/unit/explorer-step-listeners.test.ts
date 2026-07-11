import { describe, expect, it } from 'bun:test';
import * as codeceptjs from 'codeceptjs';
import Explorer from '../../src/explorer.ts';

const dispatcher = (codeceptjs as any).event.dispatcher;

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
  it('removes step listeners after a test lifecycle', async () => {
    const before = {
      passed: dispatcher.listenerCount('step.passed'),
      failed: dispatcher.listenerCount('step.failed'),
      after: dispatcher.listenerCount('test.after'),
    };

    await buildExplorer().startTest(buildTest());
    dispatcher.emit('test.after');

    expect(dispatcher.listenerCount('step.passed')).toBe(before.passed);
    expect(dispatcher.listenerCount('step.failed')).toBe(before.failed);
    expect(dispatcher.listenerCount('test.after')).toBe(before.after);
  });

  it('does not accumulate listeners across repeated startTest cycles', async () => {
    const before = {
      passed: dispatcher.listenerCount('step.passed'),
      failed: dispatcher.listenerCount('step.failed'),
      after: dispatcher.listenerCount('test.after'),
    };

    for (let i = 0; i < 5; i++) {
      await buildExplorer().startTest(buildTest());
      dispatcher.emit('test.after');
    }

    expect(dispatcher.listenerCount('step.passed')).toBe(before.passed);
    expect(dispatcher.listenerCount('step.failed')).toBe(before.failed);
    expect(dispatcher.listenerCount('test.after')).toBe(before.after);
  });
});
