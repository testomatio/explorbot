import { describe, expect, it } from 'vitest';
import { mdq } from '../../../src/utils/mdq/query.ts';

describe('remove', () => {
  it('takes a paragraph and its separator, leaving no crater', () => {
    expect(mdq('# A\n\nfirst\n\nsecond\n').query('paragraph("first")').remove().toString()).toBe('# A\n\nsecond\n');
  });

  it('takes a heading with its baked-in separator', () => {
    expect(mdq('# A\n\n## B\n\ntext\n').query('h2').remove().toString()).toBe('# A\n\ntext\n');
  });

  it('takes the leading separator when the node is last', () => {
    expect(mdq('# A\n\nlast\n').query('paragraph').remove().toString()).toBe('# A\n');
  });

  it('removes a whole section including its children', () => {
    expect(mdq('## A\n\nx\n\n## B\n\ny\n').query('section("A")').remove().toString()).toBe('## B\n\ny\n');
  });

  it('removes every match', () => {
    expect(mdq('# T\n\n```js\na\n```\n\ntext\n\n```js\nb\n```\n').query('code').remove().toString()).toBe('# T\n\ntext\n');
  });

  it('returns the document unchanged when nothing matches', () => {
    const src = '# A\n\ntext\n';
    expect(mdq(src).query('h5').remove().toString()).toBe(src);
  });

  it('never rewrites blank lines inside a fenced code block', () => {
    const src = '# A\n\n```js\na\n\n\nb\n```\n\ngone\n';
    expect(mdq(src).query('paragraph("gone")').remove().toString()).toContain('a\n\n\nb');
  });
});

describe('insertBefore and insertAfter', () => {
  it('inserts a sibling before a node', () => {
    expect(mdq('## B\n\ntext\n').query('h2').insertBefore('## A\n').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('inserts a sibling after a node', () => {
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter('## B\n').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('normalizes an insert that already ends with blank lines', () => {
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter('## B\n\n\n\n').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('normalizes an insert with no trailing newline', () => {
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter('## B').toString()).toBe('## A\n\n## B\n\ntext\n');
  });

  it('accepts a MarkdownDoc', () => {
    expect(mdq('## A\n\ntext\n').query('h2').insertAfter(mdq('## B\n')).toString()).toContain('## B');
  });

  it('never rewrites blank lines inside a fenced code block', () => {
    const src = '```js\na\n\n\nb\n```\n\n## A\n';
    expect(mdq(src).query('h2').insertAfter('## B\n').toString()).toContain('a\n\n\nb');
  });
});

describe('prepend and append on a section', () => {
  const src = '## A\n\nfirst\n\n## B\n\nother\n';

  it('appends inside the section, before the next same-depth heading', () => {
    expect(mdq(src).query('section("A")').append('last\n').toString()).toBe('## A\n\nfirst\n\nlast\n\n## B\n\nother\n');
  });

  it('prepends directly after the section heading', () => {
    expect(mdq(src).query('section("A")').prepend('intro\n').toString()).toBe('## A\n\nintro\n\nfirst\n\n## B\n\nother\n');
  });

  it('appends at the end of the document when the section is last', () => {
    expect(mdq(src).query('section("B")').append('tail\n').toString()).toBe('## A\n\nfirst\n\n## B\n\nother\n\ntail\n');
  });

  it('throws when applied to a leaf node', () => {
    expect(() => mdq(src).query('paragraph[0]').append('x\n')).toThrow();
  });
});

describe('chained edits', () => {
  it('composes several writes in one expression', () => {
    const out = mdq('## A\n\nfirst\n\n## B\n\nother\n').query('section("A")').append('added\n').query('paragraph("other")').remove().toString();
    expect(out).toBe('## A\n\nfirst\n\nadded\n\n## B\n');
  });
});
