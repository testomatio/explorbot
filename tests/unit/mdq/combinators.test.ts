import { describe, expect, it } from 'vitest';
import { MdqSelectorError, mdq, parseQuery } from '../../../src/utils/mdq/query.ts';

const doc = `# Guide

## API

| Method | Path |
|--------|------|
| GET | /users |

\`\`\`js
fetch('/users');
\`\`\`

## Install

\`\`\`bash
npm i
\`\`\`

## FAQ

- why, though?

## Empty
`;

describe('selector list (OR)', () => {
  it('parses each comma-separated selector as its own chain', () => {
    const chains = parseQuery('section("API") table, code');
    expect(chains).toHaveLength(2);
    expect(chains[0].map((segment) => segment.selector)).toEqual(['section', 'table']);
    expect(chains[1][0].selector).toBe('code');
  });

  it('unions the matches in document order', () => {
    expect(
      mdq(doc)
        .query('h2("Install"), h2("API")')
        .nodes()
        .map((node) => node.text)
    ).toEqual(['API', 'Install']);
  });

  it('matches when only one side exists', () => {
    expect(mdq(doc).query('h5, table').count()).toBe(1);
  });

  it('returns each node once when selectors overlap', () => {
    expect(mdq(doc).query('code, section("API") code').count()).toBe(2);
  });

  it('keeps a heading and its empty section as separate matches', () => {
    expect(mdq(doc).query('h2("Empty"), section("Empty")').count()).toBe(2);
  });

  it('does not split on a comma inside a text matcher', () => {
    expect(mdq(doc).query('item(~"why, though"), table').count()).toBe(2);
  });

  it('applies an index to its own selector, not to the union', () => {
    expect(mdq(doc).query('h2[0], h2[-1]').count()).toBe(2);
  });

  it('applies a JavaScript matcher to every selector in the list', () => {
    expect(
      mdq(doc)
        .query('h1, h2', /^(Guide|FAQ)$/)
        .count()
    ).toBe(2);
  });
});

describe(':has() (AND)', () => {
  it('keeps sections whose body matches', () => {
    expect(
      mdq(doc)
        .query('section2:has(code)')
        .nodes()
        .map((node) => node.text)
    ).toEqual(['API', 'Install']);
  });

  it('treats a list inside :has() as OR', () => {
    expect(mdq(doc).query('section2:has(table, list)').count()).toBe(2);
  });

  it('requires every repeated :has() to match', () => {
    expect(
      mdq(doc)
        .query('section2:has(table):has(code)')
        .nodes()
        .map((node) => node.text)
    ).toEqual(['API']);
  });

  it('scopes like a space-separated selector', () => {
    expect(mdq(doc).query('section2:has(code(~"npm"))').nodes()[0].text).toBe('Install');
    expect(mdq(doc).query('list:has(item(~"why"))').count()).toBe(1);
  });

  it('filters before the index is applied', () => {
    expect(mdq(doc).query('section2:has(code)[1]').nodes()[0].text).toBe('Install');
  });

  it('combines with text matchers and scoping', () => {
    expect(mdq(doc).query('section1 section2(!"API"):has(code) code').text()).toContain('npm i');
  });

  it('nests inside another :has()', () => {
    expect(mdq(doc).query('section1:has(section2:has(table))').count()).toBe(1);
  });
});

describe('combinator errors', () => {
  it.each(['h2,', ', h2', 'h2,,table', 'h2:has()', 'h2:has(table', 'h2[0]:has(table)', 'h2:not(table)', 'h2)'])('rejects %s', (selector) => {
    expect(() => mdq(doc).query(selector)).toThrow(MdqSelectorError);
  });
});
