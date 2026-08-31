import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os, { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSite } from '../../src/global-config.ts';
import { resolvePlanPath } from '../../src/utils/plan-path.ts';

let home: string;
let workDir: string;
let plansDir: string;
let originalCwd: string;
let homedirSpy: ReturnType<typeof spyOn>;

function writePlan(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, '# Plan\n', 'utf8');
  return file;
}

function registerSitePlans(url: string, name: string): string {
  const site = registerSite(url);
  return writePlan(join(site.dir, 'output', 'plans'), name);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'explorbot-home-'));
  workDir = mkdtempSync(join(tmpdir(), 'explorbot-work-'));
  plansDir = join(workDir, 'output', 'plans');
  homedirSpy = spyOn(os, 'homedir').mockReturnValue(home);
  originalCwd = process.cwd();
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  homedirSpy.mockRestore();
  rmSync(home, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
});

describe('resolvePlanPath', () => {
  it('returns an absolute path as is', () => {
    const file = writePlan(plansDir, 'saved.md');
    expect(resolvePlanPath(file)).toBe(file);
  });

  it('appends .md to an absolute path', () => {
    const file = writePlan(plansDir, 'saved.md');
    expect(resolvePlanPath(join(plansDir, 'saved'))).toBe(file);
  });

  it('finds a plan in the working directory', () => {
    writePlan(workDir, 'saved.md');
    expect(resolvePlanPath('saved')).toBe(join(workDir, 'saved.md'));
    expect(resolvePlanPath('saved.md')).toBe(join(workDir, 'saved.md'));
  });

  it('finds a plan in the plans directory', () => {
    const file = writePlan(plansDir, 'saved.md');
    expect(resolvePlanPath('saved', plansDir)).toBe(file);
  });

  it('prefers the working directory over the plans directory', () => {
    writePlan(plansDir, 'saved.md');
    writePlan(workDir, 'saved.md');
    expect(resolvePlanPath('saved', plansDir)).toBe(join(workDir, 'saved.md'));
  });

  it('finds a plan in a registered site when no plans directory is known', () => {
    const file = registerSitePlans('https://app.example.com', 'saved.md');
    expect(resolvePlanPath('saved')).toBe(file);
  });

  it('ignores registered sites once a plans directory is known', () => {
    registerSitePlans('https://app.example.com', 'saved.md');
    expect(resolvePlanPath('saved', plansDir)).toBe(join(plansDir, 'saved.md'));
  });

  it('falls back to the plans directory when nothing is found', () => {
    expect(resolvePlanPath('missing', plansDir)).toBe(join(plansDir, 'missing.md'));
    expect(resolvePlanPath('missing')).toBe(join(workDir, 'missing.md'));
  });
});
