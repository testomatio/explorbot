import { describe, expect, it, beforeEach } from 'bun:test';
import { StateManager } from '../../src/state-manager';
import { ActionResult } from '../../src/action-result';

describe('StateManager', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    stateManager = new StateManager();
  });

  describe('constructor', () => {
    it('should create instance with default directories', () => {
      const manager = new StateManager();
      expect(manager).toBeInstanceOf(StateManager);
    });

    it('should create instance with custom directories', () => {
      const manager = new StateManager('custom-knowledge', 'custom-experience');
      expect(manager).toBeInstanceOf(StateManager);
    });
  });

  describe('extractStatePath', () => {
    it('should extract path from URL', () => {
      const path = (stateManager as any).extractStatePath(
        'https://example.com/path/to/page'
      );
      expect(path).toBe('/path/to/page');
    });

    it('should handle root path', () => {
      const path = (stateManager as any).extractStatePath(
        'https://example.com'
      );
      expect(path).toBe('/');
    });

    it('should include hash in path', () => {
      const path = (stateManager as any).extractStatePath(
        'https://example.com/path#section'
      );
      expect(path).toBe('/path#section');
    });

    it('should handle invalid URL gracefully', () => {
      const path = (stateManager as any).extractStatePath('invalid-url');
      expect(path).toBe('invalid-url');
    });
  });

  describe('updateState', () => {
    it('should create new state from ActionResult', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      const state = stateManager.updateState(actionResult);

      expect(state.url).toBe('/test');
      expect(state.title).toBe('Test Page');
      expect(state.fullUrl).toBe('https://example.com/test');
      expect(state.hash).toBeDefined();
    });

    it("should return existing state if hash hasn't changed", () => {
      const actionResult1 = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      const actionResult2 = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      const state1 = stateManager.updateState(actionResult1);
      const state2 = stateManager.updateState(actionResult2);

      expect(state1).toBe(state2);
    });

    it('should track state transitions', () => {
      const actionResult1 = new ActionResult({
        html: '<html><body>Page 1</body></html>',
        url: 'https://example.com/page1',
        title: 'Page 1',
      });

      const actionResult2 = new ActionResult({
        html: '<html><body>Page 2</body></html>',
        url: 'https://example.com/page2',
        title: 'Page 2',
      });

      stateManager.updateState(actionResult1);
      stateManager.updateState(actionResult2, "I.click('Next')");

      const history = stateManager.getStateHistory();
      expect(history).toHaveLength(2);
    });
  });

  describe('getCurrentState', () => {
    it('should return null initially', () => {
      const state = stateManager.getCurrentState();
      expect(state).toBeNull();
    });

    it('should return current state after update', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      stateManager.updateState(actionResult);
      const state = stateManager.getCurrentState();

      expect(state).not.toBeNull();
      expect(state?.url).toBe('/test');
    });
  });

  describe('hasStateChanged', () => {
    it('should return false for same state', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      const state = stateManager.updateState(actionResult);
      const changed = stateManager.hasStateChanged(state);

      expect(changed).toBe(false);
    });

    it('should return true for different state', () => {
      const actionResult1 = new ActionResult({
        html: '<html><body>Test 1</body></html>',
        url: 'https://example.com/test1',
        title: 'Test Page 1',
      });

      const actionResult2 = new ActionResult({
        html: '<html><body>Test 2</body></html>',
        url: 'https://example.com/test2',
        title: 'Test Page 2',
      });

      const state1 = stateManager.updateState(actionResult1);
      stateManager.updateState(actionResult2);
      const changed = stateManager.hasStateChanged(state1);

      expect(changed).toBe(true);
    });
  });

  describe('getStateHistory', () => {
    it('should return empty array initially', () => {
      const history = stateManager.getStateHistory();
      expect(history).toEqual([]);
    });

    it('should return copy of history', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      stateManager.updateState(actionResult);
      const history1 = stateManager.getStateHistory();
      const history2 = stateManager.getStateHistory();

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe('getRecentTransitions', () => {
    it('should return empty array initially', () => {
      const recent = stateManager.getRecentTransitions();
      expect(recent).toEqual([]);
    });

    it('should return last N transitions', () => {
      for (let i = 0; i < 5; i++) {
        const actionResult = new ActionResult({
          html: `<html><body>Page ${i}</body></html>`,
          url: `https://example.com/page${i}`,
          title: `Page ${i}`,
        });
        stateManager.updateState(actionResult, `Action ${i}`);
      }

      const recent = stateManager.getRecentTransitions(3);
      expect(recent).toHaveLength(3);
    });
  });

  describe('hasVisitedState', () => {
    it('should return false for unvisited state', () => {
      const visited = stateManager.hasVisitedState('/test');
      expect(visited).toBe(false);
    });

    it('should return true for visited state', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      stateManager.updateState(actionResult);
      const visited = stateManager.hasVisitedState('/test');
      expect(visited).toBe(true);
    });
  });

  describe('getVisitCount', () => {
    it('should return 0 for unvisited state', () => {
      const count = stateManager.getVisitCount('/test');
      expect(count).toBe(0);
    });

    it('should return correct visit count', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      stateManager.updateState(actionResult);
      const count = stateManager.getVisitCount('/test');
      expect(count).toBe(1);
    });
  });

  describe('getLastVisitToPath', () => {
    it('should return null for unvisited path', () => {
      const lastVisit = stateManager.getLastVisitToPath('/test');
      expect(lastVisit).toBeNull();
    });

    it('should return last visit to path', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      stateManager.updateState(actionResult);
      const lastVisit = stateManager.getLastVisitToPath('/test');
      expect(lastVisit).not.toBeNull();
    });
  });

  describe('clearHistory', () => {
    it('should clear all history', () => {
      const actionResult = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/test',
        title: 'Test Page',
      });

      stateManager.updateState(actionResult);
      expect(stateManager.getStateHistory()).toHaveLength(1);

      stateManager.clearHistory();
      expect(stateManager.getStateHistory()).toEqual([]);
      expect(stateManager.getCurrentState()).toBeNull();
    });
  });

  describe('globMatch', () => {
    it('should match exact strings', () => {
      const result = (stateManager as any).globMatch('test', 'test');
      expect(result).toBe(true);
    });

    it('should match wildcard patterns', () => {
      const result = (stateManager as any).globMatch('test*', 'testing');
      expect(result).toBe(true);
    });

    it('should match single character', () => {
      const result = (stateManager as any).globMatch('te?t', 'test');
      expect(result).toBe(true);
    });

    it('should match character classes', () => {
      const result = (stateManager as any).globMatch('t[aeiou]st', 'test');
      expect(result).toBe(true);
    });

    it('should not match different strings', () => {
      const result = (stateManager as any).globMatch('test', 'other');
      expect(result).toBe(false);
    });
  });

  describe('matchesPattern', () => {
    it('should match exact strings', () => {
      const result = (stateManager as any).matchesPattern('test', 'test');
      expect(result).toBe(true);
    });

    it('should match wildcard patterns', () => {
      const result = (stateManager as any).matchesPattern('test*', 'testing');
      expect(result).toBe(true);
    });

    it('should match complex patterns', () => {
      const result = (stateManager as any).matchesPattern(
        '/user/*',
        '/user/123'
      );
      expect(result).toBe(true);
    });

    it('should not match different strings', () => {
      const result = (stateManager as any).matchesPattern('test', 'other');
      expect(result).toBe(false);
    });

    it('should handle wildcard for any path', () => {
      const result = (stateManager as any).matchesPattern('*', '/any/path');
      expect(result).toBe(true);
    });

    it('should handle regex patterns starting with ^', () => {
      const result = (stateManager as any).matchesPattern(
        '^/user/\\d+$',
        '/user/123'
      );
      expect(result).toBe(true);
    });

    it("should not match regex patterns that don't match", () => {
      const result = (stateManager as any).matchesPattern(
        '^/user/\\d+$',
        '/user/abc'
      );
      expect(result).toBe(false);
    });

    it('should handle regex patterns wrapped in ~', () => {
      const result = (stateManager as any).matchesPattern(
        '~/user/\\d+~',
        '/user/123'
      );
      expect(result).toBe(true);
    });

    it("should not match ~ wrapped patterns that don't match", () => {
      const result = (stateManager as any).matchesPattern(
        '~/user/\\d+~',
        '/user/abc'
      );
      expect(result).toBe(false);
    });

    it('should not treat ~ as regex if too short', () => {
      const result = (stateManager as any).matchesPattern('~', '~');
      expect(result).toBe(true);
    });

    it('should not treat ~ as regex if not properly wrapped', () => {
      const result = (stateManager as any).matchesPattern(
        '~/user/*',
        '~/user/123'
      );
      expect(result).toBe(true);
    });

    it('should demonstrate different regex detection methods', () => {
      // Using ^ prefix
      const result1 = (stateManager as any).matchesPattern(
        '^/user/\\d+$',
        '/user/123'
      );
      expect(result1).toBe(true);

      // Using ~ wrapping
      const result2 = (stateManager as any).matchesPattern(
        '~/user/\\d+~',
        '/user/123'
      );
      expect(result2).toBe(true);

      // Both should work the same
      expect(result1).toBe(result2);
    });

    it('should handle complex regex patterns', () => {
      const result = (stateManager as any).matchesPattern(
        '~/user/[a-z]+/\\d+~',
        '/user/abc/123'
      );
      expect(result).toBe(true);
    });

    it('should demonstrate enhanced glob capabilities', () => {
      // Extended glob patterns supported by micromatch
      const result1 = (stateManager as any).matchesPattern(
        '/user/{admin,user}/*',
        '/user/admin/dashboard'
      );
      expect(result1).toBe(true);

      const result2 = (stateManager as any).matchesPattern(
        '/user/{admin,user}/*',
        '/user/user/profile'
      );
      expect(result2).toBe(true);

      const result3 = (stateManager as any).matchesPattern(
        '/user/{admin,user}/*',
        '/user/guest/profile'
      );
      expect(result3).toBe(false);
    });

    it('should handle negated patterns', () => {
      const result = (stateManager as any).matchesPattern(
        '!/user/admin/*',
        '/user/user/profile'
      );
      expect(result).toBe(true);
    });

    it('should handle multiple patterns', () => {
      const result = (stateManager as any).matchesPattern(
        '**/*.{js,ts,tsx}',
        '/src/components/App.tsx'
      );
      expect(result).toBe(true);
    });
  });
});
