import { describe, expect, it } from 'vitest';
import { MarkdownEditor } from '../../../src/utils/mdq/edit.ts';
import { buildTokenIndex, mdq } from '../../../src/utils/mdq/query.ts';

describe('splitFrontmatter', () => {
  it('splits a leading yaml block from the body', () => {
    const src = '---\nurl: /login\nwait: 1000\n---\n\n# Title\n';
    const fm = MarkdownEditor.splitFrontmatter(src);
    expect(fm.raw).toBe('url: /login\nwait: 1000');
    expect(fm.body).toBe('\n# Title\n');
    expect(fm.offset).toBe(src.length - fm.body.length);
  });

  it('returns no frontmatter when the document does not open with ---', () => {
    const fm = MarkdownEditor.splitFrontmatter('# Title\n\n---\n');
    expect(fm.raw).toBe('');
    expect(fm.offset).toBe(0);
  });

  it('treats an unterminated --- as body, not frontmatter', () => {
    const fm = MarkdownEditor.splitFrontmatter('---\nnot closed\n');
    expect(fm.raw).toBe('');
    expect(fm.offset).toBe(0);
  });
});

describe('buildTokenIndex', () => {
  it('excludes frontmatter so it is never lexed as a setext heading', () => {
    const ranges = buildTokenIndex('---\nurl: /login\n---\n\n# Title\n');
    expect(ranges.filter((r) => r.token.type === 'heading')).toHaveLength(1);
    expect(ranges.every((r) => r.start >= 20)).toBe(true);
  });

  it('keeps offsets absolute so slicing the original source works', () => {
    const src = '---\nurl: /x\n---\n\n# Title\n';
    const ranges = buildTokenIndex(src);
    const heading = ranges.find((r) => r.token.type === 'heading');
    expect(src.slice(heading!.start, heading!.start + heading!.length)).toBe('# Title\n');
  });

  it('records the trailing space token of a paragraph', () => {
    const ranges = buildTokenIndex('para\n\n# Next\n');
    const para = ranges.find((r) => r.token.type === 'paragraph');
    expect(para!.length).toBe(4);
    expect(para!.trailing).toEqual({ start: 4, length: 2 });
  });

  it('leaves trailing undefined for a node with no following space', () => {
    expect(buildTokenIndex('# Only\n')[0].trailing).toBeUndefined();
  });

  it('bakes the separator into a document-final paragraph instead of a space token', () => {
    const ranges = buildTokenIndex('# A\n\nlast\n');
    const para = ranges.find((r) => r.token.type === 'paragraph');
    expect(para!.length).toBe(5);
    expect(para!.trailing).toBeUndefined();
  });

  it('never yields a space token as a match', () => {
    expect(buildTokenIndex('a\n\nb\n\nc\n').some((r) => r.token.type === 'space')).toBe(false);
  });
});

describe('frontmatter API', () => {
  const src = '---\n# a leading comment\nurl: /login\nwait: 1000\ntags:\n  - auth\n  - smoke\n---\n\n# Title\n';

  it('reads typed scalars, lists and nested maps', () => {
    expect(mdq(src).frontmatter()).toEqual({ url: '/login', wait: 1000, tags: ['auth', 'smoke'] });
  });

  it('returns an empty object when there is no frontmatter', () => {
    expect(mdq('# Title\n').frontmatter()).toEqual({});
  });

  it('updates a key in place', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).frontmatter().wait).toBe(2000);
  });

  it('preserves comments through a write', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).toString()).toContain('# a leading comment');
  });

  it('preserves the body exactly', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).toString()).toContain('# Title');
  });

  it('adds a key that was not there', () => {
    expect(mdq(src).setFrontmatter('region', 'sidebar').frontmatter().region).toBe('sidebar');
  });

  it('deletes a key when the value is null', () => {
    expect(mdq(src).setFrontmatter('wait', null).frontmatter().wait).toBeUndefined();
  });

  it('creates a frontmatter block on a document that has none', () => {
    const out = mdq('# Title\n').setFrontmatter('url', '/x');
    expect(out.frontmatter()).toEqual({ url: '/x' });
    expect(out.toString()).toContain('# Title');
  });

  it('keeps body queries blind to frontmatter after a write', () => {
    expect(mdq(src).setFrontmatter('wait', 2000).query('h2').count()).toBe(0);
  });
});

describe('entries and setEntry', () => {
  const block = "## S\n\n> Container: '.old'\n> Pagination: controls\n\ntext\n";

  it('reads every entry of a blockquote without its markers', () => {
    expect(mdq(block).query('blockquote[0]').entries()).toEqual({ container: "'.old'", pagination: 'controls' });
  });

  it('replaces an entry in place and keeps the others', () => {
    expect(mdq(block).query('blockquote[0]').setEntry('Container', "'.new'").toString()).toBe("## S\n\n> Container: '.new'\n> Pagination: controls\n\ntext\n");
  });

  it('appends an entry that was not there', () => {
    const out = mdq(block).query('blockquote[0]').setEntry('Region', 'sidebar');
    expect(mdq(out).query('blockquote[0]').entries().region).toBe('sidebar');
  });

  it('removes an entry when the value is null', () => {
    const out = mdq(block).query('blockquote[0]').setEntry('Pagination', null);
    expect(mdq(out).query('blockquote[0]').entries()).toEqual({ container: "'.old'" });
  });
});
