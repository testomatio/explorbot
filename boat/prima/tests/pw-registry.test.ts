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

  test('skips descriptors without an endpoint, a title or a workspace', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
    writeDescriptor(dir, 'a', { title: 'default' });
    writeDescriptor(dir, 'b', { workspaceDir: '/work/app' });
    writeDescriptor(dir, 'c', { title: 'default', workspaceDir: '/work/app', endpoint: undefined });
    expect(readDescriptors(dir)).toEqual([]);
  });

  test('returns nothing when the registry directory is missing', () => {
    expect(readDescriptors(path.join(tmpdir(), 'pwb-missing-registry'))).toEqual([]);
  });
});

describe('selectDescriptor', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'pwb-'));
  writeDescriptor(dir, 'a', { title: 'default', workspaceDir: '/work/app' });
  writeDescriptor(dir, 'b', { title: 'auth', workspaceDir: '/work/app' });
  writeDescriptor(dir, 'c', { title: 'default', workspaceDir: '/work/other' });
  const all = readDescriptors(dir);

  test('explicit title wins within workspace', () => {
    const { match } = selectDescriptor(all, { workspaceDir: '/work/app', title: 'auth' });
    expect(match?.title).toBe('auth');
  });

  test('default title picked for workspace when present', () => {
    const { match } = selectDescriptor(all, { workspaceDir: '/work/app' });
    expect(match?.title).toBe('default');
  });

  test('single survivor for workspace picked without title', () => {
    const { match } = selectDescriptor(all, { workspaceDir: '/work/other' });
    expect(match?.workspaceDir).toBe('/work/other');
  });

  test('no workspace match returns candidates empty', () => {
    const { match, candidates } = selectDescriptor(all, { workspaceDir: '/elsewhere' });
    expect(match).toBeUndefined();
    expect(candidates.length).toBe(0);
  });

  test('ambiguity returns no match with candidates listed', () => {
    const noDefault = all.filter((d) => d.title !== 'default');
    const extra = [...noDefault, { ...noDefault[0], title: 'second' }];
    const { match, candidates } = selectDescriptor(extra, { workspaceDir: '/work/app' });
    expect(match).toBeUndefined();
    expect(candidates.length).toBe(2);
  });

  test('unknown title in a populated workspace returns the workspace candidates', () => {
    const { match, candidates } = selectDescriptor(all, { workspaceDir: '/work/app', title: 'missing' });
    expect(match).toBeUndefined();
    expect(candidates.map((candidate) => candidate.title).sort()).toEqual(['auth', 'default']);
  });

  test('workspace paths are compared resolved', () => {
    const { match } = selectDescriptor(all, { workspaceDir: '/work/app/../app' });
    expect(match?.title).toBe('default');
  });
});
