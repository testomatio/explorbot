import { describe, expect, it } from 'vitest';
import { mdq, parseQuery } from '../../src/utils/markdown-query.ts';

const sampleMarkdown = `# Main Title

Some intro paragraph.

## API

API description paragraph.

| Method | Path | Description |
|--------|------|-------------|
| GET | /users | List users |
| POST | /users | Create user |

### Authentication

Auth details here.

\`\`\`javascript
const token = getToken();
\`\`\`

### Rate Limiting

Rate limit info.

| Limit | Window |
|-------|--------|
| 100 | 1 hour |

## Settings

Settings description.

- Option A
- Option B
- Option C

### Advanced Settings

Advanced info.

1. First step
2. Second step
3. Third step

## FAQ

> This is a blockquote.

---

\`\`\`python
print("hello")
\`\`\`

Some final paragraph.
`;

describe('Markdown Query (mdq)', () => {
  describe('parseQuery', () => {
    it('should parse simple selector', () => {
      const segments = parseQuery('heading');
      expect(segments).toHaveLength(1);
      expect(segments[0].selector).toBe('heading');
    });

    it('should parse h3 selector', () => {
      const segments = parseQuery('h3');
      expect(segments[0].selector).toBe('h3');
    });

    it('should parse section3 selector', () => {
      const segments = parseQuery('section3(~"Auth")');
      expect(segments[0].selector).toBe('section3');
      expect(segments[0].textMatch).toEqual({ mode: 'contains', value: 'Auth', negated: false });
    });

    it('should parse exact text matcher', () => {
      const segments = parseQuery('section("API")');
      expect(segments[0].textMatch).toEqual({ mode: 'exact', value: 'API', negated: false });
    });

    it('should parse contains text matcher', () => {
      const segments = parseQuery('section(~"Settings")');
      expect(segments[0].textMatch).toEqual({ mode: 'contains', value: 'Settings', negated: false });
    });

    it('should parse regex text matcher', () => {
      const segments = parseQuery('heading(/api/)');
      expect(segments[0].textMatch).toEqual({ mode: 'regex', value: 'api', negated: false });
    });

    it('should skip regex flags', () => {
      const segments = parseQuery('section(/^api$/i)');
      expect(segments[0].textMatch).toEqual({ mode: 'regex', value: '^api$', negated: false });
    });

    it('should parse negated text matcher', () => {
      const segments = parseQuery('section(!"API")');
      expect(segments[0].textMatch).toEqual({ mode: 'exact', value: 'API', negated: true });
    });

    it('should parse negated contains matcher', () => {
      const segments = parseQuery('section(!~"Set")');
      expect(segments[0].textMatch).toEqual({ mode: 'contains', value: 'Set', negated: true });
    });

    it('should parse negated regex matcher', () => {
      const segments = parseQuery('heading(!/api/)');
      expect(segments[0].textMatch).toEqual({ mode: 'regex', value: 'api', negated: true });
    });

    it('should parse numeric index', () => {
      const segments = parseQuery('table[0]');
      expect(segments[0].index).toBe(0);
    });

    it('should parse negative index', () => {
      const segments = parseQuery('table[-1]');
      expect(segments[0].index).toBe(-1);
    });

    it('should parse slice', () => {
      const segments = parseQuery('heading[1:3]');
      expect(segments[0].slice).toEqual({ from: 1, to: 3 });
    });

    it('should parse slice from start', () => {
      const segments = parseQuery('heading[:2]');
      expect(segments[0].slice).toEqual({ from: undefined, to: 2 });
    });

    it('should parse slice to end', () => {
      const segments = parseQuery('heading[2:]');
      expect(segments[0].slice).toEqual({ from: 2, to: undefined });
    });

    it('should parse compound query', () => {
      const segments = parseQuery('section("API") table[0]');
      expect(segments).toHaveLength(2);
      expect(segments[0].selector).toBe('section');
      expect(segments[0].textMatch?.value).toBe('API');
      expect(segments[1].selector).toBe('table');
      expect(segments[1].index).toBe(0);
    });
  });

  describe('h1-h6 selectors', () => {
    it('should find h2 headings', () => {
      const q = mdq(sampleMarkdown).query('h2');
      expect(q.count()).toBe(3);
      expect(q.text()).toContain('API');
      expect(q.text()).toContain('Settings');
      expect(q.text()).toContain('FAQ');
    });

    it('should find h3 headings', () => {
      const q = mdq(sampleMarkdown).query('h3');
      expect(q.count()).toBe(3);
      expect(q.text()).toContain('Authentication');
      expect(q.text()).toContain('Rate Limiting');
      expect(q.text()).toContain('Advanced Settings');
    });

    it('should find h1 headings', () => {
      const q = mdq(sampleMarkdown).query('h1');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('Main Title');
    });

    it('should filter h2 with text match', () => {
      const q = mdq(sampleMarkdown).query('h2("API")');
      expect(q.count()).toBe(1);
    });

    it('should negate h2 text match', () => {
      const q = mdq(sampleMarkdown).query('h2(!"API")');
      expect(q.count()).toBe(2);
      expect(q.text()).not.toContain('## API');
    });
  });

  describe('heading selector', () => {
    it('should find all headings', () => {
      const count = mdq(sampleMarkdown).query('heading').count();
      expect(count).toBeGreaterThan(0);
    });

    it('should get first heading', () => {
      const text = mdq(sampleMarkdown).query('heading').first().text();
      expect(text).toContain('Main Title');
    });

    it('should get last heading', () => {
      const text = mdq(sampleMarkdown).query('heading').last().text();
      expect(text).toContain('FAQ');
    });

    it('should select by index', () => {
      const text = mdq(sampleMarkdown).query('heading[0]').text();
      expect(text).toContain('Main Title');
    });

    it('should select by negative index', () => {
      const text = mdq(sampleMarkdown).query('heading[-1]').text();
      expect(text).toContain('FAQ');
    });

    it('should select by slice', () => {
      const q = mdq(sampleMarkdown).query('h2[:2]');
      expect(q.count()).toBe(2);
      expect(q.text()).toContain('API');
      expect(q.text()).toContain('Settings');
    });
  });

  describe('paragraph selector', () => {
    it('should find paragraphs', () => {
      const count = mdq(sampleMarkdown).query('paragraph').count();
      expect(count).toBeGreaterThan(0);
    });

    it('should find paragraph by text match', () => {
      const q = mdq(sampleMarkdown).query('paragraph(~"intro")');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('intro paragraph');
    });

    it('should negate paragraph text match', () => {
      const all = mdq(sampleMarkdown).query('paragraph').count();
      const withIntro = mdq(sampleMarkdown).query('paragraph(~"intro")').count();
      const withoutIntro = mdq(sampleMarkdown).query('paragraph(!~"intro")').count();
      expect(withoutIntro).toBe(all - withIntro);
    });
  });

  describe('table selector', () => {
    it('should find all tables', () => {
      expect(mdq(sampleMarkdown).query('table').count()).toBe(2);
    });

    it('should get first table raw markdown', () => {
      const text = mdq(sampleMarkdown).query('table[0]').text();
      expect(text).toContain('Method');
      expect(text).toContain('/users');
    });

    it('should convert table to JSON', () => {
      const json = mdq(sampleMarkdown).query('table[0]').toJson();
      expect(json).toHaveLength(2);
      expect(json[0]).toEqual({ Method: 'GET', Path: '/users', Description: 'List users' });
      expect(json[1]).toEqual({ Method: 'POST', Path: '/users', Description: 'Create user' });
    });

    it('should get last table', () => {
      const json = mdq(sampleMarkdown).query('table[-1]').toJson();
      expect(json).toHaveLength(1);
      expect(json[0]).toEqual({ Limit: '100', Window: '1 hour' });
    });
  });

  describe('code selector', () => {
    it('should find all code blocks', () => {
      expect(mdq(sampleMarkdown).query('code').count()).toBe(2);
    });

    it('should filter code by text match', () => {
      const q = mdq(sampleMarkdown).query('code(~"getToken")');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('javascript');
    });

    it('should negate code text match', () => {
      const q = mdq(sampleMarkdown).query('code(!~"getToken")');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('print');
    });
  });

  describe('list selector', () => {
    it('should find all lists', () => {
      expect(mdq(sampleMarkdown).query('list').count()).toBe(2);
    });

    it('should select list by index', () => {
      const q = mdq(sampleMarkdown).query('list[0]');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('Option A');
    });
  });

  describe('item selector', () => {
    it('should extract items from all lists', () => {
      const count = mdq(sampleMarkdown).query('item').count();
      expect(count).toBe(6);
    });

    it('should get specific item by index', () => {
      const text = mdq(sampleMarkdown).query('list[0] item[2]').text();
      expect(text).toContain('Option C');
    });

    it('should filter items by text', () => {
      const q = mdq(sampleMarkdown).query('item(~"step")');
      expect(q.count()).toBe(3);
    });

    it('should filter items with negated text', () => {
      const q = mdq(sampleMarkdown).query('item(!~"Option")');
      expect(q.count()).toBe(3);
      expect(q.text()).toContain('First step');
    });

    it('should get items from specific list via chaining', () => {
      const q = mdq(sampleMarkdown).query('list[1]').query('item');
      expect(q.count()).toBe(3);
      expect(q.text()).toContain('First step');
    });
  });

  describe('blockquote selector', () => {
    it('should find blockquotes', () => {
      const q = mdq(sampleMarkdown).query('blockquote');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('blockquote');
    });
  });

  describe('hr selector', () => {
    it('should find horizontal rules', () => {
      expect(mdq(sampleMarkdown).query('hr').count()).toBe(1);
    });
  });

  describe('section selector', () => {
    it('should find section by exact heading', () => {
      const q = mdq(sampleMarkdown).query('section("API")');
      expect(q.count()).toBe(1);
      const text = q.text();
      expect(text).toContain('## API');
      expect(text).toContain('Authentication');
      expect(text).toContain('Rate Limiting');
    });

    it('should find section by contains match', () => {
      const q = mdq(sampleMarkdown).query('section(~"Setting")');
      expect(q.count()).toBe(2);
      expect(q.text()).toContain('Option A');
      expect(q.text()).toContain('Advanced Settings');
    });

    it('should find section by exact match', () => {
      const q = mdq(sampleMarkdown).query('section("Settings")');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('Option A');
    });

    it('should find section by regex', () => {
      const q = mdq(sampleMarkdown).query('section(/^api$/i)');
      expect(q.count()).toBe(1);
    });

    it('should scope section correctly (stops at next same-depth heading)', () => {
      const text = mdq(sampleMarkdown).query('section("API")').text();
      expect(text).not.toContain('Settings description');
      expect(text).not.toContain('FAQ');
    });

    it('should negate section text match', () => {
      const q = mdq(sampleMarkdown).query('section(!"API")');
      const text = q.text();
      expect(text).toContain('Settings');
      expect(text).toContain('FAQ');
    });

    it('should find tables within a section', () => {
      const json = mdq(sampleMarkdown).query('section("API") table[0]').toJson();
      expect(json[0].Method).toBe('GET');
    });

    it('should find nested section', () => {
      const q = mdq(sampleMarkdown).query('section("API") section("Authentication")');
      expect(q.count()).toBe(1);
      const text = q.text();
      expect(text).toContain('Auth details');
      expect(text).toContain('getToken');
    });

    it('should chain section queries', () => {
      const q = mdq(sampleMarkdown).query('section("API")').query('section("Rate Limiting")');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('100');
    });

    it('should find code in nested section', () => {
      const q = mdq(sampleMarkdown).query('section("API") section("Authentication") code');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('getToken');
    });

    it('should find all h3 sections', () => {
      const q = mdq(sampleMarkdown).query('section3');
      expect(q.count()).toBe(3);
    });
  });

  describe('section with depth (section3)', () => {
    it('should find only h2 sections', () => {
      const q = mdq(sampleMarkdown).query('section2');
      expect(q.count()).toBe(3);
      const text = q.text();
      expect(text).toContain('API');
      expect(text).toContain('Settings');
      expect(text).toContain('FAQ');
    });

    it('should find only h3 sections', () => {
      const q = mdq(sampleMarkdown).query('section3');
      expect(q.count()).toBe(3);
      expect(q.text()).toContain('Authentication');
      expect(q.text()).toContain('Rate Limiting');
      expect(q.text()).toContain('Advanced Settings');
    });

    it('should combine section depth with text match', () => {
      const q = mdq(sampleMarkdown).query('section3(~"Setting")');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('Advanced');
    });

    it('should scope per-section for compound queries', () => {
      const md = `# Doc

## Section One

First paragraph.

More content.

## Section Two

Second paragraph.

Extra content.
`;
      const results = mdq(md)
        .query('section2 paragraph[0]')
        .each()
        .map((p) => p.text());

      expect(results).toHaveLength(2);
      expect(results[0]).toContain('First paragraph');
      expect(results[1]).toContain('Second paragraph');
    });
  });

  describe('text matchers', () => {
    it('should match exact text', () => {
      const q = mdq(sampleMarkdown).query('heading("API")');
      expect(q.count()).toBe(1);
    });

    it('should not match partial on exact', () => {
      const q = mdq(sampleMarkdown).query('heading("AP")');
      expect(q.count()).toBe(0);
    });

    it('should match contains', () => {
      const q = mdq(sampleMarkdown).query('heading(~"Sett")');
      expect(q.count()).toBe(2);
    });

    it('should match regex', () => {
      const q = mdq(sampleMarkdown).query('heading(/^f/i)');
      expect(q.count()).toBe(1);
      expect(q.text()).toContain('FAQ');
    });
  });

  describe('not operator', () => {
    it('should negate exact match', () => {
      const all = mdq(sampleMarkdown).query('h2').count();
      const match = mdq(sampleMarkdown).query('h2("API")').count();
      const notMatch = mdq(sampleMarkdown).query('h2(!"API")').count();
      expect(notMatch).toBe(all - match);
    });

    it('should negate contains match', () => {
      const q = mdq(sampleMarkdown).query('heading(!~"Settings")');
      expect(q.text()).not.toContain('Settings');
    });

    it('should negate regex match', () => {
      const q = mdq(sampleMarkdown).query('heading(!/setting/i)');
      expect(q.text()).not.toContain('Settings');
    });

    it('should negate section text match', () => {
      const q = mdq(sampleMarkdown).query('section2(!"FAQ")');
      expect(q.count()).toBe(2);
      const text = q.text();
      expect(text).toContain('API');
      expect(text).toContain('Settings');
      expect(text).not.toContain('blockquote');
    });
  });

  describe('before and after', () => {
    it('should select everything before first h3', () => {
      const text = mdq(sampleMarkdown).query('h3').first().before().text();
      expect(text).toContain('Main Title');
      expect(text).toContain('API description');
      expect(text).toContain('GET');
      expect(text).not.toContain('Authentication');
    });

    it('should select everything after last h2', () => {
      const text = mdq(sampleMarkdown).query('h2').last().after().text();
      expect(text).toContain('blockquote');
      expect(text).toContain('print');
      expect(text).not.toContain('Settings');
    });

    it('should return empty when no matches for before', () => {
      const q = mdq(sampleMarkdown).query('h6').before();
      expect(q.count()).toBe(0);
      expect(q.text()).toBe('');
    });

    it('should return empty when no matches for after', () => {
      const q = mdq(sampleMarkdown).query('h6').after();
      expect(q.count()).toBe(0);
      expect(q.text()).toBe('');
    });

    it('should select everything after a heading', () => {
      const text = mdq(sampleMarkdown).query('h2("API")').after().text();
      expect(text).toContain('API description');
      expect(text).toContain('Settings');
      expect(text).not.toContain('Main Title');
    });
  });

  describe('each', () => {
    it('should return array of individual matches', () => {
      const sections = mdq(sampleMarkdown).query('h2').each();
      expect(sections).toHaveLength(3);
      expect(sections[0].text()).toContain('API');
      expect(sections[1].text()).toContain('Settings');
      expect(sections[2].text()).toContain('FAQ');
    });

    it('should select each h3 section with their first paragraph', () => {
      const md = `# Doc

## Overview

Intro text.

### Section One

First section paragraph.

More content.

### Section Two

Second section paragraph.

Extra content.

### Other

Not a section.
`;
      const results = mdq(md)
        .query('section3(~"Section")')
        .each()
        .map((s) => s.query('paragraph[0]').text());

      expect(results).toHaveLength(2);
      expect(results[0]).toContain('First section paragraph');
      expect(results[1]).toContain('Second section paragraph');
    });

    it('should return empty array when no matches', () => {
      const sections = mdq(sampleMarkdown).query('h6').each();
      expect(sections).toHaveLength(0);
    });
  });

  describe('replace', () => {
    it('should replace matched content', () => {
      const result = mdq(sampleMarkdown).query('heading("FAQ")').replace('## Questions\n');
      expect(result).toContain('## Questions');
      expect(result).not.toContain('## FAQ');
    });

    it('should replace table', () => {
      const result = mdq(sampleMarkdown).query('section("Rate Limiting") table').replace('No limits!\n');
      expect(result).toContain('No limits!');
      expect(result).not.toContain('1 hour');
      expect(result).toContain('/users');
    });

    it('should replace section', () => {
      const result = mdq(sampleMarkdown).query('section("FAQ")').replace('## FAQ\n\nNo questions.\n');
      expect(result).toContain('No questions');
      expect(result).not.toContain('blockquote');
    });

    it('should return source unchanged when no matches', () => {
      const result = mdq(sampleMarkdown).query('heading("Nonexistent")').replace('replaced');
      expect(result).toBe(sampleMarkdown);
    });

    it('should handle overlapping ranges (keep outermost)', () => {
      const md = '## Parent\n\n### Child\n\nContent\n';
      const result = mdq(md).query('section').replace('REPLACED\n');
      expect(result).toBe('REPLACED\n');
    });
  });

  describe('composable chaining', () => {
    it('should chain query calls', () => {
      const q = mdq(sampleMarkdown).query('section("Settings")').query('list').query('item[0]');
      expect(q.text()).toContain('Option A');
    });

    it('should chain section then table then toJson', () => {
      const json = mdq(sampleMarkdown).query('section("API")').query('table[0]').toJson();
      expect(json[0].Method).toBe('GET');
    });

    it('should chain section then h3', () => {
      const q = mdq(sampleMarkdown).query('section("API")').query('h3');
      expect(q.count()).toBe(2);
      expect(q.text()).toContain('Authentication');
      expect(q.text()).toContain('Rate Limiting');
    });
  });

  describe('edge cases', () => {
    it('should handle empty markdown', () => {
      const q = mdq('');
      expect(q.query('heading').count()).toBe(0);
      expect(q.query('heading').text()).toBe('');
      expect(q.query('table').toJson()).toEqual([]);
    });

    it('should handle no matches', () => {
      const q = mdq(sampleMarkdown).query('heading("Nonexistent")');
      expect(q.count()).toBe(0);
      expect(q.text()).toBe('');
      expect(q.first().count()).toBe(0);
      expect(q.last().count()).toBe(0);
    });

    it('should handle empty replace', () => {
      const result = mdq('').query('heading').replace('x');
      expect(result).toBe('');
    });

    it('should handle markdown with only a heading', () => {
      const q = mdq('# Hello\n');
      expect(q.query('heading').count()).toBe(1);
      expect(q.query('heading').text()).toBe('# Hello\n');
    });

    it('should handle index out of bounds', () => {
      const q = mdq(sampleMarkdown).query('heading[999]');
      expect(q.count()).toBe(0);
    });

    it('should handle negative index out of bounds', () => {
      const q = mdq(sampleMarkdown).query('heading[-999]');
      expect(q.count()).toBe(0);
    });

    it('should handle table with no rows', () => {
      const md = '| A | B |\n|---|---|\n';
      const json = mdq(md).query('table').toJson();
      expect(json).toEqual([]);
    });
  });
});
