import { describe, expect, it } from 'bun:test';
import { ActionResult } from '../../src/action-result';

describe('ActionResult', () => {
  describe('constructor', () => {
    it('should create instance with required fields', () => {
      const result = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com',
      });

      expect(result.html).toBe('<html><body>Test</body></html>');
      expect(result.url).toBe('https://example.com');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.browserLogs).toEqual([]);
    });

    it('should set default values for optional fields', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://test.com',
      });

      expect(result.title).toBeUndefined();
      expect(result.error).toBeUndefined();
      expect(result.screenshot).toBeUndefined();
      expect(result.h1).toBeUndefined();
      expect(result.h2).toBeUndefined();
      expect(result.h3).toBeUndefined();
      expect(result.h4).toBeUndefined();
    });

    it('should accept all optional fields', () => {
      const now = new Date();
      const screenshot = Buffer.from('test');

      const result = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com',
        title: 'Test Page',
        timestamp: now,
        error: 'Some error',
        screenshot,
        h1: 'Main Title',
        h2: 'Subtitle',
        h3: 'Section',
        h4: 'Subsection',
        browserLogs: [{ type: 'error', message: 'console error' }],
      });

      expect(result.title).toBe('Test Page');
      expect(result.timestamp).toBe(now);
      expect(result.error).toBe('Some error');
      expect(result.screenshot).toBe(screenshot);
      expect(result.h1).toBe('Main Title');
      expect(result.h2).toBe('Subtitle');
      expect(result.h3).toBe('Section');
      expect(result.h4).toBe('Subsection');
      expect(result.browserLogs).toHaveLength(1);
    });
  });

  describe('getStateHash', () => {
    it('should generate consistent hash for same state', () => {
      const result1 = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/path',
        title: 'Test Page',
        h1: 'Welcome',
      });

      const result2 = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/path',
        title: 'Test Page',
        h1: 'Welcome',
      });

      expect(result1.getStateHash()).toBe(result2.getStateHash());
    });

    it('should generate different hash for different URLs', () => {
      const result1 = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/path1',
      });

      const result2 = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com/path2',
      });

      expect(result1.getStateHash()).not.toBe(result2.getStateHash());
    });

    it('should handle URLs with trailing slashes', () => {
      const result1 = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/path/',
      });

      const result2 = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/path',
      });

      expect(result1.relativeUrl).toBe('/path');
      expect(result2.relativeUrl).toBe('/path');
      expect(result1.getStateHash()).toBe(result2.getStateHash());
    });

    it('should include hash in relativeUrl', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/path#section',
      });

      expect(result.relativeUrl).toBe('/path#section');
    });

    it('should handle empty headings gracefully', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
      });

      expect(result.getStateHash()).toBe('');
    });

    it('should truncate long state strings', () => {
      const longTitle = 'a'.repeat(300);
      const result = new ActionResult({
        html: '<html></html>',
        url: `https://example.com/${longTitle}`,
        h1: longTitle,
      });

      const hash = result.getStateHash();
      expect(hash.length).toBeLessThanOrEqual(200);
      expect(hash).toMatch(/^[a-z0-9_]+$/);
    });

    it('should sanitize special characters in hash', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/path-with-special@chars!and#symbols',
        h1: 'Title with spaces & symbols!',
      });

      const hash = result.getStateHash();
      expect(hash).toMatch(/^[a-z0-9_]+$/);
      expect(hash).not.toContain('@');
      expect(hash).not.toContain('!');
      expect(hash).not.toContain(' ');
    });
  });

  describe('toAiContext', () => {
    it('should format context for AI consumption', () => {
      const result = new ActionResult({
        html: '<html><body>Test</body></html>',
        url: 'https://example.com',
        title: 'Test Page',
        h1: 'Welcome',
        h2: 'Subtitle',
      });

      const context = result.toAiContext();
      expect(context).toContain('<url>https://example.com</url>');
      expect(context).toContain('<title>Test Page</title>');
      expect(context).toContain('<h1>Welcome</h1>');
      expect(context).toContain('<h2>Subtitle</h2>');
    });

    it('should exclude null and undefined values', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
        title: undefined,
        h1: undefined,
      });

      const context = result.toAiContext();
      expect(context).toContain('<url>https://example.com</url>');
      expect(context).not.toContain('<title>');
      expect(context).not.toContain('<h1>');
    });

    it('should handle empty object gracefully', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
      });

      const context = result.toAiContext();
      expect(context).toContain('<url>https://example.com</url>');
    });
  });

  describe('relativeUrl', () => {
    it('should extract path from URL', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/path/to/page',
      });

      expect(result.relativeUrl).toBe('/path/to/page');
    });

    it('should handle root path', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
      });

      expect(result.relativeUrl).toBe('/');
    });

    it('should handle URL with query parameters', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/path?query=value&other=test',
      });

      expect(result.relativeUrl).toBe('/path');
    });

    it('should handle invalid URL gracefully', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com/invalid',
      });

      expect(result.relativeUrl).toBe('/invalid');
    });

    it('should handle empty string URL', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
      });

      expect(result.relativeUrl).toBe('/');
    });
  });

  describe('timestamp handling', () => {
    it('should set timestamp to current time by default', () => {
      const before = new Date();
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
      });
      const after = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(
        before.getTime()
      );
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should accept custom timestamp', () => {
      const customTime = new Date('2023-01-01');
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
        timestamp: customTime,
      });

      expect(result.timestamp).toBe(customTime);
    });
  });

  describe('browserLogs handling', () => {
    it('should default to empty array', () => {
      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
      });

      expect(result.browserLogs).toEqual([]);
    });

    it('should accept custom browser logs', () => {
      const logs = [
        { type: 'error', text: 'Test error' },
        { type: 'info', text: 'Test info' },
      ];

      const result = new ActionResult({
        html: '<html></html>',
        url: 'https://example.com',
        browserLogs: logs,
      });

      expect(result.browserLogs).toEqual(logs);
    });
  });

  describe('fromState', () => {
    it('should create ActionResult from WebPageState with file paths', () => {
      const mockState = {
        url: '/test-page',
        title: 'Test Page',
        fullUrl: 'https://example.com/test-page',
        timestamp: new Date('2023-01-01T00:00:00Z'),
        htmlFile: 'test_hash_123.html',
        screenshotFile: 'test_hash_123.png',
        logFile: 'test_hash_123.log',
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('https://example.com/test-page');
      expect(result.title).toBe('Test Page');
      expect(result.timestamp).toEqual(new Date('2023-01-01T00:00:00Z'));
    });

    it('should handle state without file paths', () => {
      const mockState = {
        url: '/test-page',
        title: 'Test Page',
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('/test-page');
      expect(result.title).toBe('Test Page');
      expect(result.html).toBe('');
      expect(result.screenshot).toBeUndefined();
      expect(result.browserLogs).toEqual([]);
    });

    it('should use fullUrl when available', () => {
      const mockState = {
        url: '/test-page',
        fullUrl: 'https://example.com/test-page',
        title: 'Test Page',
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('https://example.com/test-page');
    });

    it('should handle state with only htmlFile', () => {
      const mockState = {
        url: '/test-page',
        title: 'Test Page',
        htmlFile: 'test.html',
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('/test-page');
      expect(result.title).toBe('Test Page');
      expect(result.screenshot).toBeUndefined();
      expect(result.browserLogs).toEqual([]);
    });

    it('should handle state with only screenshotFile', () => {
      const mockState = {
        url: '/test-page',
        title: 'Test Page',
        screenshotFile: 'test.png',
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('/test-page');
      expect(result.title).toBe('Test Page');
      expect(result.html).toBe('');
      expect(result.screenshot).toBeUndefined();
      expect(result.browserLogs).toEqual([]);
    });

    it('should handle state with only logFile', () => {
      const mockState = {
        url: '/test-page',
        title: 'Test Page',
        logFile: 'test.log',
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('/test-page');
      expect(result.title).toBe('Test Page');
      expect(result.html).toBe('');
      expect(result.screenshot).toBeUndefined();
      expect(result.browserLogs).toEqual([]);
    });

    it('should handle empty state object', () => {
      const mockState = {
        url: '',
        title: '',
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('');
      expect(result.title).toBe('');
      expect(result.html).toBe('');
      expect(result.screenshot).toBeUndefined();
      expect(result.browserLogs).toEqual([]);
    });

    it('should handle state with null/undefined values', () => {
      const mockState = {
        url: '/test-page',
        title: 'Test Page',
        fullUrl: null as any,
        timestamp: null as any,
      };

      const result = ActionResult.fromState(mockState);

      expect(result.url).toBe('/test-page');
      expect(result.title).toBe('Test Page');
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.html).toBe('');
      expect(result.screenshot).toBeUndefined();
      expect(result.browserLogs).toEqual([]);
    });
  });
});
