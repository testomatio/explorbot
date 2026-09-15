import { describe, expect, it } from 'vitest';
import { MdqSelectorError, mdq } from '../../../src/utils/mdq/query.ts';

const doc = `<!-- suite -->

## Plan

<!-- test priority=critical
     style=bdd -->

para with <!-- inline --> comment

<div>a block</div>

| Method | Path |
|--------|------|
| GET | /users |
`;

describe('comment selector', () => {
  it('matches block comments and not other html', () => {
    expect(mdq(doc).query('comment').count()).toBe(2);
  });

  it('matches on the inner body so anchored patterns work', () => {
    expect(mdq(doc).query('comment(/^test/)').count()).toBe(1);
  });

  it('exposes the inner body as node text, without the markers', () => {
    expect(mdq(doc).query('comment[0]').nodes()[0].text).toBe('suite');
  });

  it('keeps newlines inside a multi-line comment', () => {
    expect(mdq(doc).query('comment(/^test/)').nodes()[0].text).toContain('\n');
  });

  it('does not reach comments inline in a paragraph', () => {
    expect(mdq(doc).query('comment(~"inline")').count()).toBe(0);
  });

  it('matches an exact single-line comment body', () => {
    expect(mdq(doc).query('comment("suite")').count()).toBe(1);
  });
});

describe('html selector', () => {
  it('matches every html block including comments', () => {
    expect(mdq(doc).query('html').count()).toBe(3);
  });

  it('matches on raw text', () => {
    expect(mdq(doc).query('html(~"<div")').count()).toBe(1);
  });
});

describe('regex flags', () => {
  it('honors an explicit i flag', () => {
    expect(mdq('## Summary\n').query('h2(/^summary/i)').count()).toBe(1);
  });

  it('is case sensitive without the i flag', () => {
    expect(mdq('## Summary\n').query('h2(/^summary/)').count()).toBe(0);
  });
});

describe('table text matching', () => {
  it('matches cell content, not only headers', () => {
    expect(mdq(doc).query('table(~"/users")').count()).toBe(1);
  });

  it('still matches header content', () => {
    expect(mdq(doc).query('table(~"Method")').count()).toBe(1);
  });
});

describe('selector errors', () => {
  it('throws on an unknown selector rather than matching nothing', () => {
    expect(() => mdq(doc).query('secton("A")')).toThrow(MdqSelectorError);
  });

  it('reports where the problem is', () => {
    try {
      mdq(doc).query('h2("A") secton("B")');
      expect.unreachable();
    } catch (error: any) {
      expect(error.index).toBe(8);
    }
  });

  it('accepts a leading dot for jq muscle memory', () => {
    expect(mdq('## A\n').query('.h2').count()).toBe(1);
  });
});
