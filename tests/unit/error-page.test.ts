import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../src/action-result.ts';
import { isErrorPage } from '../../src/utils/error-page.ts';

function createActionResult(data: { title?: string; h1?: string; h2?: string; html?: string; url?: string }): ActionResult {
  const html = data.html ?? `<html><body><h1>${data.h1 ?? ''}</h1><h2>${data.h2 ?? ''}</h2></body></html>`;
  return new ActionResult({
    url: data.url ?? '/test',
    title: data.title ?? '',
    html,
  });
}

describe('isErrorPage', () => {
  describe('HTTP error detection', () => {
    it('should detect 400 Bad Request', () => {
      expect(isErrorPage(createActionResult({ title: '400 Bad Request' }))).toBe(true);
    });

    it('should detect 401 Unauthorized', () => {
      expect(isErrorPage(createActionResult({ title: '401 Unauthorized' }))).toBe(true);
    });

    it('should detect 403 Forbidden', () => {
      expect(isErrorPage(createActionResult({ title: '403 Forbidden' }))).toBe(true);
    });

    it('should detect 404 Not Found', () => {
      expect(isErrorPage(createActionResult({ title: '404 Not Found' }))).toBe(true);
    });

    it('should detect 404 Not Found in h1', () => {
      expect(isErrorPage(createActionResult({ h1: '404 Not Found' }))).toBe(true);
    });

    it('should detect 404 Not Found in h2', () => {
      expect(isErrorPage(createActionResult({ h2: '404 Not Found' }))).toBe(true);
    });

    it('should detect 500 Internal Server Error', () => {
      expect(isErrorPage(createActionResult({ title: '500 Internal Server Error' }))).toBe(true);
    });

    it('should detect 502 Bad Gateway', () => {
      expect(isErrorPage(createActionResult({ title: '502 Bad Gateway' }))).toBe(true);
    });

    it('should detect 503 Service Unavailable', () => {
      expect(isErrorPage(createActionResult({ title: '503 Service Unavailable' }))).toBe(true);
    });

    it('should detect 504 Gateway Timeout', () => {
      expect(isErrorPage(createActionResult({ title: '504 Gateway Timeout' }))).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isErrorPage(createActionResult({ title: '404 NOT FOUND' }))).toBe(true);
      expect(isErrorPage(createActionResult({ title: '500 internal server error' }))).toBe(true);
    });

    it('should detect error in longer title', () => {
      expect(isErrorPage(createActionResult({ title: 'MyApp - 404 Not Found' }))).toBe(true);
    });
  });

  describe('empty page detection', () => {
    it('should detect empty html', () => {
      expect(isErrorPage(createActionResult({ html: '' }))).toBe(true);
    });

    it('should detect empty body', () => {
      expect(isErrorPage(createActionResult({ html: '<html><body></body></html>' }))).toBe(true);
    });

    it('should detect body with only whitespace', () => {
      expect(isErrorPage(createActionResult({ html: '<html><body>   \n\t   </body></html>' }))).toBe(true);
    });

    it('should detect very small page (< 500 chars)', () => {
      const smallContent = 'x'.repeat(100);
      expect(isErrorPage(createActionResult({ html: `<html><body>${smallContent}</body></html>` }))).toBe(true);
    });

    it('should NOT detect page with 500+ chars as empty', () => {
      const content = 'x'.repeat(600);
      expect(isErrorPage(createActionResult({ html: `<html><body>${content}</body></html>` }))).toBe(false);
    });
  });

  describe('false positive prevention', () => {
    it('should NOT detect "Room 404" as error page', () => {
      const result = isErrorPage(
        createActionResult({
          h1: 'Room 404',
          html: '<html><body><h1>Room 404</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect "Order #500" as error page', () => {
      const result = isErrorPage(
        createActionResult({
          title: 'Order #500 - Details',
          html: '<html><body><h1>Order Details</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect standalone 404 number', () => {
      const result = isErrorPage(
        createActionResult({
          title: '404',
          html: '<html><body>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect normal login page', () => {
      const result = isErrorPage(
        createActionResult({
          title: 'Login',
          h1: 'Sign In',
          html: '<html><body><h1>Sign In</h1><form>' + 'x'.repeat(600) + '</form></body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect normal dashboard page', () => {
      const result = isErrorPage(
        createActionResult({
          title: 'Dashboard',
          h1: 'Welcome Back',
          html: '<html><body><h1>Welcome Back</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle missing title, h1, h2', () => {
      const result = isErrorPage(
        createActionResult({
          html: '<html><body><p>Content</p>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should handle null/undefined html gracefully', () => {
      const actionResult = new ActionResult({ url: '/test', title: '' });
      expect(isErrorPage(actionResult)).toBe(true);
    });
  });
});
