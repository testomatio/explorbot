import { describe, expect, it } from 'bun:test';
import { PromptParser } from '../../src/prompt-parser';

describe('PromptParser', () => {
  describe('getPromptsByCriteria', () => {
    it('should return empty array for no prompts', () => {
      const parser = new PromptParser();
      const results = parser.getPromptsByCriteria({
        url: 'https://example.com',
      });
      expect(results).toEqual([]);
    });

    it('should handle empty criteria', () => {
      const parser = new PromptParser();
      const results = parser.getPromptsByCriteria({});
      expect(results).toEqual([]);
    });
  });

  describe('getPromptsByUrl', () => {
    it('should return empty array for no prompts', () => {
      const parser = new PromptParser();
      const results = parser.getPromptsByUrl('https://example.com');
      expect(results).toEqual([]);
    });
  });

  describe('getAllPrompts', () => {
    it('should return empty array initially', () => {
      const parser = new PromptParser();
      const results = parser.getAllPrompts();
      expect(results).toEqual([]);
    });
  });

  describe('getPromptUrls', () => {
    it('should return empty array initially', () => {
      const parser = new PromptParser();
      const results = parser.getPromptUrls();
      expect(results).toEqual([]);
    });
  });

  describe('getPromptTitles', () => {
    it('should return empty array initially', () => {
      const parser = new PromptParser();
      const results = parser.getPromptTitles();
      expect(results).toEqual([]);
    });
  });

  describe('globToRegex', () => {
    it('should convert simple glob to regex', () => {
      const parser = new PromptParser();
      const regex = (parser as any).globToRegex('test');
      expect(regex.test('test')).toBe(true);
      expect(regex.test('Test')).toBe(true);
      expect(regex.test('testing')).toBe(false);
    });

    it('should handle wildcard globs', () => {
      const parser = new PromptParser();
      const regex = (parser as any).globToRegex('test*');
      expect(regex.test('test')).toBe(true);
      expect(regex.test('testing')).toBe(true);
      expect(regex.test('best')).toBe(false);
    });
  });

  describe('normalizeUrl', () => {
    it('should remove query parameters', () => {
      const parser = new PromptParser();
      const normalized = (parser as any).normalizeUrl(
        'https://example.com/path?query=value'
      );
      expect(normalized).toBe('https://example.com/path');
    });

    it('should remove hash fragments', () => {
      const parser = new PromptParser();
      const normalized = (parser as any).normalizeUrl(
        'https://example.com/path#section'
      );
      expect(normalized).toBe('https://example.com/path');
    });

    it('should handle both query and hash', () => {
      const parser = new PromptParser();
      const normalized = (parser as any).normalizeUrl(
        'https://example.com/path?query=value#section'
      );
      expect(normalized).toBe('https://example.com/path');
    });

    it('should return unchanged for clean URL', () => {
      const parser = new PromptParser();
      const normalized = (parser as any).normalizeUrl(
        'https://example.com/path'
      );
      expect(normalized).toBe('https://example.com/path');
    });
  });

  describe('matchesPattern', () => {
    it('should match exact strings', () => {
      const parser = new PromptParser();
      const result = (parser as any).matchesPattern('test', 'test');
      expect(result).toBe(true);
    });

    it('should not match different strings', () => {
      const parser = new PromptParser();
      const result = (parser as any).matchesPattern('test', 'other');
      expect(result).toBe(false);
    });

    it('should handle wildcard patterns', () => {
      const parser = new PromptParser();
      const result = (parser as any).matchesPattern('testing', 'test*');
      expect(result).toBe(true);
    });

    it('should handle exact match with wildcard', () => {
      const parser = new PromptParser();
      const result = (parser as any).matchesPattern('test', 'test*');
      expect(result).toBe(true);
    });
  });
});
