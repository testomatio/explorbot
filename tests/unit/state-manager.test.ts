import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result';
import { ConfigParser } from '../../src/config';
import { StateManager, type StateTransition, type WebPageState } from '../../src/state-manager';

describe('StateManager', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    // Mock config parser with writable temp directories
    const mockConfig = {
      playwright: { browser: 'chromium', url: 'http://localhost:3000' },
      ai: { provider: null, model: 'test' },
      dirs: {
        knowledge: '/tmp/explorbot-test/knowledge',
        experience: '/tmp/explorbot-test/experience',
      },
    };

    const configParser = ConfigParser.getInstance();
    (configParser as any).config = mockConfig;
    (configParser as any).configPath = '/tmp/explorbot-test/config.js';

    stateManager = new StateManager();
  });

  afterEach(() => {
    stateManager.cleanup();
  });

  describe('constructor', () => {
    it('should initialize with null current state', () => {
      expect(stateManager.getCurrentState()).toBeNull();
    });

    it('should have empty state history', () => {
      expect(stateManager.getStateHistory()).toEqual([]);
    });

    it('should have zero listeners initially', () => {
      expect(stateManager.getListenerCount()).toBe(0);
    });
  });

  describe('updateState', () => {
    it('should update current state from ActionResult', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Test Page</h1></body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
        h1: 'Test Page',
      });

      const newState = stateManager.updateState(actionResult);

      expect(newState.url).toBe('/test');
      expect(newState.title).toBe('Test Page');
      expect(newState.fullUrl).toBe('https://example.com/test');
      expect(newState.h1).toBe('Test Page');
      expect(stateManager.getCurrentState()).toEqual(newState);
    });

    it('should not update if state hash is unchanged', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Test Page</h1></body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      const firstState = stateManager.updateState(actionResult);
      const secondState = stateManager.updateState(actionResult);

      expect(firstState).toBe(secondState);
      expect(stateManager.getStateHistory()).toHaveLength(1);
    });

    it('should create state transition record', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      stateManager.updateState(actionResult, 'I.amOnPage("/test")', 'navigation');
      const history = stateManager.getStateHistory();

      expect(history).toHaveLength(1);
      expect(history[0].fromState).toBeNull();
      expect(history[0].toState.url).toBe('/test');
      expect(history[0].codeBlock).toBe('I.amOnPage("/test")');
      expect(history[0].trigger).toBe('navigation');
    });

    it('should refresh snapshot data when hash stays the same', () => {
      const initialSnapshot = new ActionResult({
        html: '<html><body><h1>Test Page</h1></body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
        h1: 'Test Page',
        ariaSnapshot: '- button "Original"',
        ariaSnapshotFile: 'original.aria.yaml',
      });

      stateManager.updateState(initialSnapshot);

      const updatedSnapshot = new ActionResult({
        html: '<html><body><h1>Test Page</h1></body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
        h1: 'Test Page',
        ariaSnapshot: '- button "Updated"',
        ariaSnapshotFile: 'updated.aria.yaml',
      });

      stateManager.updateState(updatedSnapshot);

      const currentState = stateManager.getCurrentState();

      expect(currentState?.ariaSnapshot).toBe('- button "Updated"');
      expect(currentState?.ariaSnapshotFile).toBe('updated.aria.yaml');
      expect(stateManager.getStateHistory()).toHaveLength(1);
    });

    it('should default to root path when action result lacks url', () => {
      const actionResult = new ActionResult({
        html: '<html></html>',
      });

      const state = stateManager.updateState(actionResult);

      expect(state.url).toBe('/');
      expect(stateManager.getCurrentState()?.url).toBe('/');
    });
  });

  describe('updateStateFromBasic', () => {
    it('should create state from basic URL and title', () => {
      const newState = stateManager.updateStateFromBasic('https://example.com/dashboard', 'Dashboard', 'manual');

      expect(newState.url).toBe('/dashboard');
      expect(newState.title).toBe('Dashboard');
      expect(newState.fullUrl).toBe('https://example.com/dashboard');
      expect(newState.hash).toBeTruthy();
    });

    it('should not update if basic state hash is unchanged', () => {
      stateManager.updateStateFromBasic('https://example.com/test', 'Test');
      const secondState = stateManager.updateStateFromBasic('https://example.com/test', 'Test');

      expect(secondState).toBe(stateManager.getCurrentState());
      expect(stateManager.getStateHistory()).toHaveLength(1);
    });
  });

  describe('state change events', () => {
    it('should emit state change events when state is updated', () => {
      const events: StateTransition[] = [];
      const unsubscribe = stateManager.onStateChange((event) => {
        events.push(event);
      });

      const actionResult = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/page1',
        title: 'Page 1',
      });

      stateManager.updateState(actionResult);

      expect(events).toHaveLength(1);
      expect(events[0].toState.url).toBe('/page1');
      expect(events[0].fromState).toBeNull();

      unsubscribe();
    });

    it('should support multiple listeners', () => {
      const events1: StateTransition[] = [];
      const events2: StateTransition[] = [];

      stateManager.onStateChange((event) => events1.push(event));
      stateManager.onStateChange((event) => events2.push(event));

      const actionResult = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      stateManager.updateState(actionResult);

      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(stateManager.getListenerCount()).toBe(2);
    });

    it('should allow unsubscribing listeners', () => {
      const events: StateTransition[] = [];
      const unsubscribe = stateManager.onStateChange((event) => {
        events.push(event);
      });

      unsubscribe();
      expect(stateManager.getListenerCount()).toBe(0);

      const actionResult = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/test',
        title: 'Test',
      });

      stateManager.updateState(actionResult);
      expect(events).toHaveLength(0);
    });
  });

  describe('state comparison', () => {
    it('should detect state changes correctly', () => {
      const state1: WebPageState = { url: '/test1', hash: 'hash1' };
      const state2: WebPageState = { url: '/test2', hash: 'hash2' };

      expect(stateManager.hasStateChanged(null)).toBe(false);

      stateManager.updateStateFromBasic('https://example.com/test1');
      expect(stateManager.hasStateChanged(null)).toBe(true);
      expect(stateManager.hasStateChanged(state1)).toBe(true);
    });

    it('should compare states by hash correctly', () => {
      const state1: WebPageState = { url: '/test', hash: 'hash1' };
      const state2: WebPageState = { url: '/test', hash: 'hash1' };
      const state3: WebPageState = { url: '/test', hash: 'hash2' };

      expect(stateManager.statesEqual(state1, state2)).toBe(true);
      expect(stateManager.statesEqual(state1, state3)).toBe(false);
      expect(stateManager.statesEqual(null, null)).toBe(true);
      expect(stateManager.statesEqual(state1, null)).toBe(false);
    });
  });

  describe('visit tracking', () => {
    beforeEach(() => {
      // Add some visit history
      stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1');
      stateManager.updateStateFromBasic('https://example.com/page2', 'Page 2');
      stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1 Again');
    });

    it('should track if state has been visited', () => {
      expect(stateManager.hasVisitedState('/page1')).toBe(true);
      expect(stateManager.hasVisitedState('/page2')).toBe(true);
      expect(stateManager.hasVisitedState('/page3')).toBe(false);
    });

    it('should count visits to a state', () => {
      expect(stateManager.getVisitCount('/page1')).toBe(2);
      expect(stateManager.getVisitCount('/page2')).toBe(1);
      expect(stateManager.getVisitCount('/page3')).toBe(0);
    });

    it('should find last visit to a path', () => {
      const lastVisit = stateManager.getLastVisitToPath('/page1');
      expect(lastVisit).toBeTruthy();
      expect(lastVisit?.toState.title).toBe('Page 1 Again');

      expect(stateManager.getLastVisitToPath('/nonexistent')).toBeNull();
    });
  });

  describe('state history', () => {
    it('should maintain state history', () => {
      stateManager.updateStateFromBasic('https://example.com/page1', 'Page 1');
      stateManager.updateStateFromBasic('https://example.com/page2', 'Page 2');

      const history = stateManager.getStateHistory();
      expect(history).toHaveLength(2);
      expect(history[0].toState.url).toBe('/page1');
      expect(history[1].toState.url).toBe('/page2');
    });

    it('should get recent transitions', () => {
      for (let i = 1; i <= 10; i++) {
        stateManager.updateStateFromBasic(`https://example.com/page${i}`, `Page ${i}`);
      }

      const recent = stateManager.getRecentTransitions(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].toState.url).toBe('/page8');
      expect(recent[1].toState.url).toBe('/page9');
      expect(recent[2].toState.url).toBe('/page10');
    });
  });

  describe('dead loop detection', () => {
    const setHistory = (sequence: string) => {
      const entries: StateTransition[] = sequence.split('').map((hash, index) => {
        const toState: WebPageState = { url: hash, hash };
        const fromState = index === 0 ? null : { url: sequence[index - 1], hash: sequence[index - 1] };
        return {
          fromState,
          toState,
          codeBlock: '',
          timestamp: new Date(),
          trigger: 'manual',
        };
      });
      (stateManager as any).stateHistory = entries;
      (stateManager as any).currentState = entries.length ? entries[entries.length - 1].toState : null;
    };

    it('should detect single state dead loop', () => {
      setHistory('AAAAAAAAAA');
      expect(stateManager.isInDeadLoop()).toBe(true);
    });

    it('should detect two state dead loop', () => {
      setHistory('ABABABABA');
      expect(stateManager.isInDeadLoop()).toBe(true);
    });

    it('should detect three state dead loop', () => {
      setHistory('ABCABCABCABC');
      expect(stateManager.isInDeadLoop()).toBe(true);
    });

    it('should ignore short history', () => {
      setHistory('AAAAA');
      expect(stateManager.isInDeadLoop()).toBe(false);
    });

    it('should ignore mixed history', () => {
      setHistory('ABCDACABBB');
      expect(stateManager.isInDeadLoop()).toBe(false);
    });
  });

  describe('createStateFromActionResult', () => {
    it('should create state without updating current state', () => {
      const actionResult = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      const state = stateManager.createStateFromActionResult(actionResult);

      expect(state.url).toBe('/test');
      expect(state.title).toBe('Test Page');
      expect(stateManager.getCurrentState()).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should clear all state and listeners', () => {
      stateManager.onStateChange(() => {});
      stateManager.updateStateFromBasic('https://example.com/test', 'Test');

      expect(stateManager.getCurrentState()).toBeTruthy();
      expect(stateManager.getStateHistory()).toHaveLength(1);
      expect(stateManager.getListenerCount()).toBe(1);

      stateManager.cleanup();

      expect(stateManager.getCurrentState()).toBeNull();
      expect(stateManager.getStateHistory()).toHaveLength(0);
      expect(stateManager.getListenerCount()).toBe(0);
    });
  });

  describe('newState', () => {
    it('should create new state from partial data', () => {
      const state = stateManager.newState({
        url: '/test',
        title: 'Test Page',
        h1: 'Main Title',
      });

      expect(state.url).toBe('/test');
      expect(state.title).toBe('Test Page');
      expect(state.h1).toBe('Main Title');
    });

    it('should provide defaults for missing fields', () => {
      const state = stateManager.newState({});

      expect(state.url).toBe('');
      expect(state.title).toBe('');
    });
  });
});
