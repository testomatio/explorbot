import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ActionResult } from '../../src/action-result.js';
import { ConfigParser } from '../../src/config.js';
import { StateManager } from '../../src/state-manager.js';

describe('StateManager Events', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    // Reset ConfigParser singleton between tests
    ConfigParser.resetForTesting();

    // Set up test config
    ConfigParser.setupTestConfig();
    stateManager = new StateManager();
  });

  afterEach(() => {
    // Clean up StateManager and ConfigParser after each test
    if (stateManager) {
      stateManager.cleanup();
    }

    // Clean up test directories
    const testDirs = ConfigParser.getTestDirectories();
    testDirs.forEach((dir) => {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    ConfigParser.resetForTesting();
  });

  it('should emit state change events when state is updated', () => {
    const events: any[] = [];

    const unsubscribe = stateManager.onStateChange((event) => {
      events.push(event);
    });

    // Update state from basic data
    stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1', 'navigation');

    expect(events).toHaveLength(1);
    expect(events[0].fromState).toBeNull();
    expect(events[0].toState.url).toBe('/page1');
    expect(events[0].toState.title).toBe('Page 1');
    expect(events[0].trigger).toBe('navigation');
    expect(events[0].codeBlock).toBe('');

    // Update state from ActionResult
    const actionResult = new ActionResult({
      html: '<html><head><title>Page 2</title></head><body><h1>Welcome</h1></body></html>',
      url: 'https://example.com/page2',
      title: 'Page 2',
    });

    stateManager.updateState(
      actionResult,
      'I.click("button")',
      {
        htmlFile: 'page2.html',
        screenshotFile: 'page2.png',
        logFile: 'page2.log',
      },
      'manual'
    );

    expect(events).toHaveLength(2);
    expect(events[1].fromState?.url).toBe('/page1');
    expect(events[1].toState.url).toBe('/page2');
    expect(events[1].toState.h1).toBe('Welcome');
    expect(events[1].trigger).toBe('manual');
    expect(events[1].codeBlock).toBe('I.click("button")');

    unsubscribe();
  });

  it('should not emit events for unchanged states', () => {
    const events: any[] = [];

    const unsubscribe = stateManager.onStateChange((event) => {
      events.push(event);
    });

    // Update state
    stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1', 'navigation');
    expect(events).toHaveLength(1);

    // Update with same data (should not emit)
    stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1', 'navigation');
    expect(events).toHaveLength(1); // No new event

    unsubscribe();
  });

  it('should support multiple listeners', () => {
    const events1: any[] = [];
    const events2: any[] = [];

    const unsubscribe1 = stateManager.onStateChange((event) => {
      events1.push(event);
    });

    const unsubscribe2 = stateManager.onStateChange((event) => {
      events2.push(event);
    });

    stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1', 'navigation');

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0]).toEqual(events2[0]);

    unsubscribe1();
    unsubscribe2();
  });

  it('should allow unsubscribing listeners', () => {
    const events: any[] = [];

    const unsubscribe = stateManager.onStateChange((event) => {
      events.push(event);
    });

    stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1', 'navigation');
    expect(events).toHaveLength(1);

    unsubscribe();

    stateManager.updateStateFromBasic('https://example.com/page2', 'Page 2', 'navigation');
    expect(events).toHaveLength(1); // No new event after unsubscribe
  });

  it('should handle listener errors gracefully', () => {
    const events: any[] = [];

    const unsubscribe1 = stateManager.onStateChange((event) => {
      throw new Error('Listener error');
    });

    const unsubscribe2 = stateManager.onStateChange((event) => {
      events.push(event);
    });

    // Should not throw and should still call other listeners
    expect(() => {
      stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1', 'navigation');
    }).not.toThrow();

    expect(events).toHaveLength(1);

    unsubscribe1();
    unsubscribe2();
  });

  it('should track listener count correctly', () => {
    expect(stateManager.getListenerCount()).toBe(0);

    const unsubscribe1 = stateManager.onStateChange(() => {});
    expect(stateManager.getListenerCount()).toBe(1);

    const unsubscribe2 = stateManager.onStateChange(() => {});
    expect(stateManager.getListenerCount()).toBe(2);

    unsubscribe1();
    expect(stateManager.getListenerCount()).toBe(1);

    unsubscribe2();
    expect(stateManager.getListenerCount()).toBe(0);
  });

  it('should clear all listeners', () => {
    const events: any[] = [];

    stateManager.onStateChange((event) => {
      events.push(event);
    });

    stateManager.onStateChange((event) => {
      events.push(event);
    });

    expect(stateManager.getListenerCount()).toBe(2);

    stateManager.clearListeners();
    expect(stateManager.getListenerCount()).toBe(0);

    stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1', 'navigation');
    expect(events).toHaveLength(0); // No events after clearing
  });
});
