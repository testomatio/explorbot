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
  describe('404 error detection', () => {
    it('should detect 404 in title with error context', () => {
      expect(isErrorPage(createActionResult({ title: '404 Not Found' }))).toBe(true);
    });

    it('should detect 404 in h1 with error context', () => {
      expect(isErrorPage(createActionResult({ h1: '404 - Page Not Found' }))).toBe(true);
    });

    it('should detect 404 in h2 with error context', () => {
      expect(isErrorPage(createActionResult({ h2: 'Error 404' }))).toBe(true);
    });

    it('should detect standalone 404', () => {
      expect(isErrorPage(createActionResult({ title: '404' }))).toBe(true);
    });

    it('should detect "Page not found" without number', () => {
      expect(isErrorPage(createActionResult({ h1: 'Page Not Found' }))).toBe(true);
    });

    it('should detect "Not Found" in title', () => {
      expect(isErrorPage(createActionResult({ title: 'Not Found | MyApp' }))).toBe(true);
    });
  });

  describe('500 error detection', () => {
    it('should detect 500 in title with error context', () => {
      expect(isErrorPage(createActionResult({ title: '500 Internal Server Error' }))).toBe(true);
    });

    it('should detect 500 in h1 with error context', () => {
      expect(isErrorPage(createActionResult({ h1: 'Error 500' }))).toBe(true);
    });

    it('should detect "Internal Server Error" text', () => {
      expect(isErrorPage(createActionResult({ h1: 'Internal Server Error' }))).toBe(true);
    });

    it('should detect "Server Error" text', () => {
      expect(isErrorPage(createActionResult({ title: 'Server Error' }))).toBe(true);
    });
  });

  describe('502/503 error detection', () => {
    it('should detect 502 Bad Gateway', () => {
      expect(isErrorPage(createActionResult({ title: '502 Bad Gateway' }))).toBe(true);
    });

    it('should detect 503 Service Unavailable', () => {
      expect(isErrorPage(createActionResult({ title: '503 Service Unavailable' }))).toBe(true);
    });

    it('should detect "Service Unavailable" text', () => {
      expect(isErrorPage(createActionResult({ h1: 'Service Unavailable' }))).toBe(true);
    });

    it('should detect "Bad Gateway" text', () => {
      expect(isErrorPage(createActionResult({ h1: 'Bad Gateway' }))).toBe(true);
    });
  });

  describe('403 error detection', () => {
    it('should detect 403 Forbidden', () => {
      expect(isErrorPage(createActionResult({ title: '403 Forbidden' }))).toBe(true);
    });

    it('should detect "Access Denied" text', () => {
      expect(isErrorPage(createActionResult({ h1: 'Access Denied' }))).toBe(true);
    });

    it('should detect "Forbidden" text', () => {
      expect(isErrorPage(createActionResult({ title: 'Forbidden' }))).toBe(true);
    });
  });

  describe('generic error detection', () => {
    it('should detect "Something went wrong"', () => {
      expect(isErrorPage(createActionResult({ h1: 'Something Went Wrong' }))).toBe(true);
    });

    it('should detect "Oops!"', () => {
      expect(isErrorPage(createActionResult({ h1: 'Oops! Something happened' }))).toBe(true);
    });

    it('should detect "Error" as standalone word in title', () => {
      expect(isErrorPage(createActionResult({ title: 'Error' }))).toBe(true);
    });

    it('should detect "An error occurred"', () => {
      expect(isErrorPage(createActionResult({ h1: 'An error occurred' }))).toBe(true);
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
          html: '<html><body><h1>Room 404</h1><p>Hotel room.</p>' + 'x'.repeat(600) + '</body></html>',
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

    it('should NOT detect "Product 403" as error page', () => {
      const result = isErrorPage(
        createActionResult({
          h1: 'Product 403',
          html: '<html><body><h1>Product 403</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect "$500 price" as error page', () => {
      const result = isErrorPage(
        createActionResult({
          h1: '$500 Gift Card',
          html: '<html><body><h1>$500 Gift Card</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect "500 items" as error page', () => {
      const result = isErrorPage(
        createActionResult({
          h1: '500 items in stock',
          html: '<html><body><h1>500 items in stock</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect page number 404 as error', () => {
      const result = isErrorPage(
        createActionResult({
          title: 'Page 404 of 1000',
          html: '<html><body><h1>Results</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect article/post ID 500 as error', () => {
      const result = isErrorPage(
        createActionResult({
          title: 'Post #500',
          html: '<html><body><h1>Blog Post</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(false);
    });

    it('should NOT detect "Newsletter" page as error', () => {
      const result = isErrorPage(
        createActionResult({
          h1: 'Newsletter',
          html: '<html><body><h1>Newsletter</h1>' + 'x'.repeat(600) + '</body></html>',
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

    it('should detect error even with content if error text is clear', () => {
      const result = isErrorPage(
        createActionResult({
          title: '404 Not Found',
          h1: 'Page Not Found',
          html: '<html><body><h1>Page Not Found</h1>' + 'x'.repeat(600) + '</body></html>',
        })
      );
      expect(result).toBe(true);
    });

    it('should handle case insensitivity', () => {
      expect(isErrorPage(createActionResult({ h1: 'PAGE NOT FOUND' }))).toBe(true);
    });

    it('should handle mixed case', () => {
      expect(isErrorPage(createActionResult({ title: 'Page Not Found' }))).toBe(true);
    });
  });
});
