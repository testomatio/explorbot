import { describe, expect, it } from 'vitest';
import { mdq } from '../../../src/utils/mdq/query.ts';

const doc = `## API "v2"

| Method | Path |
|--------|------|
| GET | /users |

## Settings

- Option A
- Option B

<!-- test id=1 -->
`;

describe('matchers as values', () => {
  it('matches a string exactly', () => {
    expect(mdq(doc).query('h2', 'Settings').count()).toBe(1);
    expect(mdq(doc).query('h2', 'Setting').count()).toBe(0);
  });

  it('matches a RegExp honoring its flags', () => {
    expect(
      mdq(doc)
        .query('h2', /^settings$/i)
        .count()
    ).toBe(1);
    expect(
      mdq(doc)
        .query('h2', /^settings$/)
        .count()
    ).toBe(0);
  });

  it('matches a predicate', () => {
    expect(
      mdq(doc)
        .query('h2', (t) => t.startsWith('API'))
        .count()
    ).toBe(1);
  });

  it('needs no escaping for a value containing quotes', () => {
    expect(mdq(doc).query('h2', 'API "v2"').count()).toBe(1);
  });
});

describe('sugar', () => {
  it('is equivalent to the query form', () => {
    expect(mdq(doc).heading('Settings').text()).toBe(mdq(doc).query('heading', 'Settings').text());
  });

  it('takes a depth option', () => {
    expect(mdq(doc).section('Settings', { depth: 2 }).text()).toBe(mdq(doc).query('section2("Settings")').text());
  });

  it('reads comments', () => {
    expect(mdq(doc).comment(/^test/).count()).toBe(1);
  });

  it('chains from a Selection', () => {
    expect(mdq(doc).section('API "v2"').table().rows()[0].Path).toBe('/users');
  });

  it('takes no matcher', () => {
    expect(mdq(doc).table().count()).toBe(1);
  });

  it('is available on a document returned by a write', () => {
    expect(mdq(doc).table().replace('gone\n').heading().count()).toBe(2);
  });
});

describe('at and slice', () => {
  it('selects by index like the DSL', () => {
    expect(mdq(doc).heading().at(0).text()).toBe(mdq(doc).query('heading[0]').text());
  });

  it('supports a negative index', () => {
    expect(mdq(doc).heading().at(-1).text()).toContain('Settings');
  });

  it('returns nothing for an out-of-bounds index', () => {
    expect(mdq(doc).heading().at(99).count()).toBe(0);
    expect(mdq(doc).heading().at(-99).count()).toBe(0);
  });

  it('slices like the DSL', () => {
    expect(mdq(doc).item().slice(1).count()).toBe(1);
  });
});

describe('exists', () => {
  it('is true when something matched', () => {
    expect(mdq(doc).heading('Settings').exists()).toBe(true);
  });

  it('is false when nothing matched', () => {
    expect(mdq(doc).heading('Nope').exists()).toBe(false);
  });
});

describe('canonical read names', () => {
  it('rows matches the deprecated toJson', () => {
    expect(mdq(doc).table().rows()).toEqual(mdq(doc).table().toJson());
  });

  it('preceding matches the deprecated before', () => {
    expect(mdq(doc).heading('Settings').preceding().text()).toBe(mdq(doc).query('heading("Settings")').before().text());
  });

  it('following matches the deprecated after', () => {
    expect(mdq(doc).heading('API "v2"').following().text()).toBe(mdq(doc).query('heading(~"API")').after().text());
  });

  it('entries matches the deprecated keyValue', () => {
    const block = mdq('> Container: .x\n').query('blockquote[0]');
    expect(block.entries()).toEqual(block.keyValue());
  });
});

describe('stringification', () => {
  const src = '# A\n\ntext\n';

  it('stringifies to the whole document, matched or not', () => {
    expect(String(mdq(src))).toBe(src);
    expect(String(mdq(src).query('paragraph'))).toBe(src);
  });

  it('gives the matched markdown through text()', () => {
    expect(mdq(src).query('paragraph').text()).toBe('text\n');
  });

  it('survives a round trip back through mdq()', () => {
    expect(mdq(mdq(src).query('paragraph')).toString()).toBe(src);
  });
});
