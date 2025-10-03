import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result.ts';
import type { WebPageState } from '../../src/state-manager.ts';

describe('ActionResult', () => {
  describe('isMatchedBy', () => {
    it('should match exact URL', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Users</h1></body></html>',
        url: '/users',
      });

      const state: WebPageState = {
        url: '/users',
        fullUrl: 'https://example.com/users',
        title: 'Users',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(true);
    });

    it('should match wildcard pattern for exact URL', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Users</h1></body></html>',
        url: '/users',
      });

      const state: WebPageState = {
        url: '/users/*',
        fullUrl: 'https://example.com/users/*',
        title: 'Users',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(true);
    });

    it('should match wildcard pattern for sub-path', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>User Profile</h1></body></html>',
        url: '/users/1',
      });

      const state: WebPageState = {
        url: '/users/*',
        fullUrl: 'https://example.com/users/*',
        title: 'Users',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(true);
    });

    it('should not match when action result URL is more specific than state URL', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>User Profile</h1></body></html>',
        url: '/users/1',
      });

      const state: WebPageState = {
        url: '/users',
        fullUrl: 'https://example.com/users',
        title: 'Users',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(false);
    });

    it('should match with h1 heading when URLs match', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Users</h1></body></html>',
        url: '/users',
        h1: 'Users',
      });

      const state: WebPageState = {
        url: '/users',
        fullUrl: 'https://example.com/users',
        title: 'Users',
        h1: 'Users',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(true);
    });

    it('should match with h2 heading when URLs match', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Dashboard</h1><h2>User Management</h2></body></html>',
        url: '/dashboard',
        h1: 'Dashboard',
        h2: 'User Management',
      });

      const state: WebPageState = {
        url: '/dashboard',
        fullUrl: 'https://example.com/dashboard',
        title: 'Dashboard',
        h1: 'Dashboard',
        h2: 'User Management',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(true);
    });

    it('should not match when h1 headings differ', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Users</h1></body></html>',
        url: '/users',
        h1: 'Users',
      });

      const state: WebPageState = {
        url: '/users',
        fullUrl: 'https://example.com/users',
        title: 'Users',
        h1: 'User Management',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(false);
    });

    it('should return false when action result has no URL', () => {
      const actionResult = new ActionResult({
        html: '<html><body><h1>Users</h1></body></html>',
      });

      const state: WebPageState = {
        url: '/users',
        fullUrl: 'https://example.com/users',
        title: 'Users',
        timestamp: new Date(),
      };

      expect(actionResult.isMatchedBy(state)).toBe(false);
    });
  });
});
