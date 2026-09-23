import { describe, expect, it } from 'vitest';
import { mdq } from '../../../src/utils/mdq/query.ts';

const table = `| Method | Path |
|--------|------|
| GET | /users |
`;

describe('addRow', () => {
  it('appends a row and re-aligns every column', () => {
    expect(mdq(table).query('table').addRow({ Method: 'POST', Path: '/sessions' }).toString()).toBe(['| Method | Path      |', '| ------ | --------- |', '| GET    | /users    |', '| POST   | /sessions |', ''].join('\n'));
  });

  it('round-trips through rows()', () => {
    const out = mdq(table).query('table').addRow({ Method: 'POST', Path: '/sessions' });
    expect(mdq(out).query('table').rows()).toEqual([
      { Method: 'GET', Path: '/users' },
      { Method: 'POST', Path: '/sessions' },
    ]);
  });

  it('leaves a column blank when the object omits it', () => {
    const out = mdq(table).query('table').addRow({ Method: 'PUT' });
    expect(mdq(out).query('table').rows()[1]).toEqual({ Method: 'PUT', Path: '' });
  });

  it('ignores keys that are not columns', () => {
    const out = mdq(table).query('table').addRow({ Method: 'PUT', Nope: 'x' });
    expect(mdq(out).query('table').rows()[1].Method).toBe('PUT');
    expect(mdq(out).query('table').text()).not.toContain('Nope');
  });

  it('preserves column alignment markers', () => {
    const aligned = '| A | B |\n|:--|--:|\n| 1 | 2 |\n';
    const out = mdq(aligned).query('table').addRow({ A: '3', B: '4' }).toString();
    expect(out).toContain(':--');
    expect(out).toContain('--:');
  });

  it('throws on a non-table node', () => {
    expect(() => mdq('para\n').query('paragraph').addRow({ a: 'b' })).toThrow();
  });
});

describe('addItem', () => {
  it('copies a dash marker', () => {
    expect(mdq('- a\n- b\n').query('list').addItem('c').toString()).toBe('- a\n- b\n- c\n');
  });

  it('copies a star marker', () => {
    expect(mdq('* a\n* b\n').query('list').addItem('c').toString()).toBe('* a\n* b\n* c\n');
  });

  it('continues an ordered list', () => {
    expect(mdq('1. a\n2. b\n').query('list').addItem('c').toString()).toBe('1. a\n2. b\n3. c\n');
  });

  it('preserves indentation', () => {
    expect(mdq('  - a\n  - b\n').query('list').addItem('c').toString()).toBe('  - a\n  - b\n  - c\n');
  });

  it('throws on a non-list node', () => {
    expect(() => mdq('para\n').query('paragraph').addItem('x')).toThrow();
  });
});
