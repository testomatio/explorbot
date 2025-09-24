import { describe, it, expect } from 'vitest';
import {
  extractAddedElements,
  extractAddedElementsWithSelectors,
} from '../../src/utils/html-extract';

describe('HTML Extract Library', () => {
  describe('extractAddedElements', () => {
    it('should extract single added element', () => {
      const originalHtml = '<div><p>Original text</p></div>';
      const modifiedHtml =
        '<div><p>Original text</p><button>New Button</button></div>';
      const addedPaths = ['html > body > div > button'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('<button');
      expect(result.html).toContain('New Button');
      expect(result.extractedCount).toBe(1);
    });

    it('should extract multiple added elements', () => {
      const originalHtml = '<div><p>Original</p></div>';
      const modifiedHtml =
        '<div><p>Original</p><input type="text" placeholder="Name"><select><option>Option 1</option></select></div>';
      const addedPaths = [
        'html > body > div > input',
        'html > body > div > select',
      ];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('<input');
      expect(result.html).toContain('placeholder="Name"');
      expect(result.html).toContain('<select');
      expect(result.html).toContain('<option');
      expect(result.extractedCount).toBe(2);
    });

    it('should extract elements with attributes', () => {
      const originalHtml = '<form></form>';
      const modifiedHtml =
        '<form><input type="email" class="form-control" id="email" required></form>';
      const addedPaths = ['html > body > form > input'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('type="email"');
      expect(result.html).toContain('class="form-control"');
      expect(result.html).toContain('id="email"');
      expect(result.html).toContain('required');
    });

    it('should extract nested elements', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml =
        '<div><nav><ul><li><a href="#">Link</a></li></ul></nav></div>';
      const addedPaths = ['html > body > div > nav'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('<nav');
      expect(result.html).toContain('<ul');
      expect(result.html).toContain('<li');
      expect(result.html).toContain('<a href="#">');
      expect(result.html).toContain('Link');
    });

    it('should handle HTML fragments', () => {
      const originalHtml = '<p>Original</p>';
      const modifiedHtml = '<p>Original</p><span>New content</span>';
      const addedPaths = ['html > body > span'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('<span');
      expect(result.html).toContain('New content');
    });

    it('should return empty result when no elements found', () => {
      const originalHtml = '<div>Content</div>';
      const modifiedHtml = '<div>Content</div>';
      const addedPaths = ['html > body > div > non-existent'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toBe('');
      expect(result.extractedCount).toBe(0);
    });

    it('should preserve element structure when extracting', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml =
        '<div><table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Data</td></tr></tbody></table></div>';
      const addedPaths = ['html > body > div > table'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('<table');
      expect(result.html).toContain('<thead');
      expect(result.html).toContain('<tbody');
      expect(result.html).toContain('<th>Header</th>');
      expect(result.html).toContain('<td>Data</td>');
    });
  });

  describe('extractAddedElementsWithSelectors', () => {
    it('should filter extracted elements with include selectors', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml =
        '<div><button class="primary">Primary</button><button class="secondary">Secondary</button><span>Text</span></div>';
      const addedPaths = [
        'html > body > div > button',
        'html > body > div > span',
      ];

      const result = extractAddedElementsWithSelectors(
        originalHtml,
        modifiedHtml,
        addedPaths,
        { include: ['.primary'] }
      );

      expect(result.html).toContain('class="primary"');
      expect(result.html).toContain('Primary');
      expect(result.html).not.toContain('Secondary');
      expect(result.html).not.toContain('<span');
    });

    it('should filter extracted elements with exclude selectors', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml =
        '<div><button>Click</button><script>alert("test");</script><style>.css {}</style></div>';
      const addedPaths = [
        'html > body > div > button',
        'html > body > div > script',
        'html > body > div > style',
      ];

      const result = extractAddedElementsWithSelectors(
        originalHtml,
        modifiedHtml,
        addedPaths,
        { exclude: ['script', 'style'] }
      );

      expect(result.html).toContain('<button');
      expect(result.html).toContain('Click');
      expect(result.html).not.toContain('<script');
      expect(result.html).not.toContain('<style');
    });

    it('should handle complex CSS selectors', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml = `
        <div>
          <div data-testid="test-id">Test Content</div>
          <div data-role="navigation">Nav</div>
          <div class="content">Regular Content</div>
        </div>
      `;
      const addedPaths = ['html > body > div > div'];

      const result = extractAddedElementsWithSelectors(
        originalHtml,
        modifiedHtml,
        addedPaths,
        {
          include: ['[data-testid]', '[data-role="navigation"]'],
          exclude: ['.content'],
        }
      );

      expect(result.html).toContain('data-testid="test-id"');
      expect(result.html).toContain('Test Content');
      expect(result.html).toContain('data-role="navigation"');
      expect(result.html).toContain('Nav');
      expect(result.html).not.toContain('Regular Content');
    });

    it('should work without configuration', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml = '<div><p>New paragraph</p></div>';
      const addedPaths = ['html > body > div > p'];

      const result = extractAddedElementsWithSelectors(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('<p');
      expect(result.html).toContain('New paragraph');
    });

    it('should preserve nested structure with filtering', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml = `
        <div>
          <section class="keep">
            <h2>Title</h2>
            <p class="keep">Content</p>
            <p class="remove">Remove me</p>
          </section>
          <section class="remove">
            <p>Should be removed</p>
          </section>
        </div>
      `;
      const addedPaths = ['html > body > div > section'];

      const result = extractAddedElementsWithSelectors(
        originalHtml,
        modifiedHtml,
        addedPaths,
        {
          include: ['.keep'],
          exclude: ['.remove'],
        }
      );

      expect(result.html).toContain('<section class="keep"');
      expect(result.html).toContain('<h2>Title</h2>');
      expect(result.html).toContain('<p class="keep">Content</p>');
      expect(result.html).not.toContain('class="remove"');
      expect(result.html).not.toContain('Remove me');
      expect(result.html).not.toContain('Should be removed');
    });
  });

  describe('edge cases', () => {
    it('should handle empty paths array', () => {
      const originalHtml = '<div>Content</div>';
      const modifiedHtml = '<div>Content</div>';
      const addedPaths: string[] = [];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toBe('');
      expect(result.extractedCount).toBe(0);
    });

    it('should handle malformed HTML gracefully', () => {
      const originalHtml = '<div>Original';
      const modifiedHtml = '<div>Original<span>New';
      const addedPaths = ['html > body > div > span'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      // Should not throw and return some result
      expect(result).toBeDefined();
    });

    it('should handle complex nested paths', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml =
        '<div><article><section><div><p><strong>Bold text</strong></p></div></section></article></div>';
      const addedPaths = [
        'html > body > div > article > section > div > p > strong',
      ];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('<strong');
      expect(result.html).toContain('Bold text');
    });

    it('should extract elements with special characters', () => {
      const originalHtml = '<div></div>';
      const modifiedHtml = '<div><p>Text with &amp; entities &lt;3</p></div>';
      const addedPaths = ['html > body > div > p'];

      const result = extractAddedElements(
        originalHtml,
        modifiedHtml,
        addedPaths
      );

      expect(result.html).toContain('Text with &amp; entities &lt;3');
    });
  });
});
