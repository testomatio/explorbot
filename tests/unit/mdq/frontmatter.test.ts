import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../../../src/utils/mdq/edit.ts';
import { buildTokenIndex } from '../../../src/utils/mdq/query.ts';

describe('splitFrontmatter', () => {
  it('splits a leading yaml block from the body', () => {
    const src = '---\nurl: /login\nwait: 1000\n---\n\n# Title\n';
    const fm = splitFrontmatter(src);
    expect(fm.raw).toBe('url: /login\nwait: 1000');
    expect(fm.body).toBe('\n# Title\n');
    expect(fm.offset).toBe(src.length - fm.body.length);
  });

  it('returns no frontmatter when the document does not open with ---', () => {
    const fm = splitFrontmatter('# Title\n\n---\n');
    expect(fm.raw).toBe('');
    expect(fm.offset).toBe(0);
  });

  it('treats an unterminated --- as body, not frontmatter', () => {
    const fm = splitFrontmatter('---\nnot closed\n');
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
