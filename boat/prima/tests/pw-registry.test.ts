import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readDescriptors, registryDir, selectDescriptor } from '../src/pw-registry.ts';

function writeDescriptor(dir: string, name: string, data: Record<string, unknown>) {
  writeFileSync(path.join(dir, name), JSON.stringify({ playwrightVersion: '1.62.0', playwrightLib: '/lib/pw', endpoint: `/tmp/pw/${name}.sock`, browser: { browserName: 'chromium' }, ...data }));
}

describe('registryDir', () => {
  test('points at the ms-playwright browser-server cache', () => {
    expect(registryDir()).toContain(path.join('ms-playwright', 'b'));
  });
});

describe('readDescriptors', () => {
  test('parses descriptor files and skips malformed ones', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
    writeDescriptor(dir, 'a', { title: 'default', workspaceDir: '/work/app' });
    writeFileSync(path.join(dir, 'broken'), 'not json');
    const list = readDescriptors(dir);
    expect(list.length).toBe(1);
    expect(list[0].title).toBe('default');
    expect(list[0].browserName).toBe('chromium');
    expect(list[0].playwrightLib).toBe('/lib/pw');
  });

  test('skips descriptors without an endpoint or a title', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
    writeDescriptor(dir, 'b', { workspaceDir: '/work/app' });
    writeDescriptor(dir, 'c', { title: 'default', workspaceDir: '/work/app', endpoint: undefined });
    expect(readDescriptors(dir)).toEqual([]);
  });

  test('keeps descriptors that carry no workspaceDir, as playwright-cli writes them', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
    writeDescriptor(dir, 'a', { title: 'default' });
    const list = readDescriptors(dir);
    expect(list.length).toBe(1);
    expect(list[0].workspaceDir).toBe('');
  });

  test('returns nothing when the registry directory is missing', () => {
    expect(readDescriptors(path.join(tmpdir(), 'pwb-missing-registry'))).toEqual([]);
  });
});

describe('selectDescriptor', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
  writeDescriptor(dir, 'a', { title: 'default' });
  writeDescriptor(dir, 'b', { title: 'auth' });
  const all = readDescriptors(dir);

  test('explicit title wins', () => {
    expect(selectDescriptor(all, { title: 'auth' }).match?.title).toBe('auth');
  });

  test('default title picked when no title is asked for', () => {
    expect(selectDescriptor(all).match?.title).toBe('default');
  });

  test('the single live session is picked without a title', () => {
    const single = all.filter((descriptor) => descriptor.title === 'auth');
    expect(selectDescriptor(single).match?.title).toBe('auth');
  });

  test('no descriptors returns no match and no candidates', () => {
    const { match, candidates } = selectDescriptor([]);
    expect(match).toBeUndefined();
    expect(candidates.length).toBe(0);
  });

  test('ambiguity returns no match with candidates listed', () => {
    const noDefault = all.filter((d) => d.title !== 'default');
    const extra = [...noDefault, { ...noDefault[0], title: 'second' }];
    const { match, candidates } = selectDescriptor(extra);
    expect(match).toBeUndefined();
    expect(candidates.length).toBe(2);
  });

  test('unknown title returns every candidate', () => {
    const { match, candidates } = selectDescriptor(all, { title: 'missing' });
    expect(match).toBeUndefined();
    expect(candidates.map((candidate) => candidate.title).sort()).toEqual(['auth', 'default']);
  });
});
