import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'bun:test';
import * as codeceptjs from 'codeceptjs';
import Explorer from '../../src/explorer.ts';

const dispatcher = (codeceptjs as any).event.dispatcher;

function countListeners(event: string): number {
  if (typeof dispatcher.listeners === 'function') return dispatcher.listeners(event).length;
  if (typeof dispatcher.listenerCount === 'function') return dispatcher.listenerCount(event);
  return EventEmitter.listenerCount(dispatcher, event);
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
  it('removes step listeners after a test lifecycle', async () => {
    const before = {
      passed: countListeners('step.passed'),
      failed: countListeners('step.failed'),
      after: countListeners('test.after'),
    };

    await buildExplorer().startTest(buildTest());
    dispatcher.emit('test.after');

    expect(countListeners('step.passed')).toBe(before.passed);
    expect(countListeners('step.failed')).toBe(before.failed);
    expect(countListeners('test.after')).toBe(before.after);
  });

  it('does not accumulate listeners across repeated startTest cycles', async () => {
    const before = {
      passed: countListeners('step.passed'),
      failed: countListeners('step.failed'),
      after: countListeners('test.after'),
    };

    for (let i = 0; i < 5; i++) {
      await buildExplorer().startTest(buildTest());
      dispatcher.emit('test.after');
    }

    expect(countListeners('step.passed')).toBe(before.passed);
    expect(countListeners('step.failed')).toBe(before.failed);
    expect(countListeners('test.after')).toBe(before.after);
  });
});
