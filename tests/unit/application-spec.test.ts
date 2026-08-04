import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import matter from 'gray-matter';
import { ActionResult } from '../../src/action-result.ts';
import { APPLICATION_SPEC_FORMAT, APPLICATION_SPEC_VERSION } from '../../src/application-spec-contract.ts';
import { ApplicationSpec } from '../../src/application-spec.ts';
import { ConfigParser } from '../../src/config.ts';

const projectDir = '/tmp/explorbot-application-spec-test';

describe('ApplicationSpec', () => {
  beforeEach(() => {
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(`${projectDir}/output/docs/pages`, { recursive: true });
    writeFileSync(`${projectDir}/output/docs/index.md`, '# Website Spec', 'utf8');
    writeFileSync(`${projectDir}/config.ts`, '', 'utf8');

    const configParser = ConfigParser.getInstance();
    (configParser as any).config = {
      playwright: { browser: 'chromium', url: 'https://example.test' },
      ai: { model: 'test' },
      dirs: { knowledge: 'knowledge' },
    };
    (configParser as any).configPath = `${projectDir}/config.ts`;
  });

  afterEach(() => {
    if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
  });

  it('loads a Docbot directory and renders only the matching page', () => {
    writePage('users.md', '/users', 'User list');
    writePage('settings.md', '/settings', 'Workspace settings');

    const spec = new ApplicationSpec('output/docs');
    const rendered = spec.renderFor(new ActionResult({ url: '/users' }));

    expect(spec.pageCount).toBe(2);
    expect(rendered).toContain('<application_spec>');
    expect(rendered).toContain('User list');
    expect(rendered).not.toContain('Workspace settings');
    expect(rendered).toContain('User Might as unverified');
  });

  it('accepts the generated index.md path', () => {
    writePage('users.md', '/users', 'User list');
    const spec = new ApplicationSpec('output/docs/index.md');

    expect(spec.renderFor(new ActionResult({ url: '/users' }))).toContain('User list');
  });

  it('returns no context for an undocumented URL', () => {
    writePage('users.md', '/users', 'User list');

    const spec = new ApplicationSpec('output/docs');

    expect(spec.renderFor(new ActionResult({ url: '/billing' }))).toBe('');
  });

  it('reports a friendly error for an invalid bundle', () => {
    expect(() => new ApplicationSpec('missing/docs')).toThrow('Application spec not found');
  });

  it('rejects an unsupported page format', () => {
    writeFileSync(`${projectDir}/output/docs/pages/invalid.md`, matter.stringify('# /invalid', { url: '/invalid', format: 'unknown', version: APPLICATION_SPEC_VERSION }), 'utf8');

    expect(() => new ApplicationSpec('output/docs')).toThrow('Invalid application spec format');
  });
});

function writePage(filename: string, url: string, purpose: string): void {
  writeFileSync(
    `${projectDir}/output/docs/pages/${filename}`,
    matter.stringify(`# ${url}\n\n## Purpose\n\n${purpose}\n\n## User Can\n\n- user can view the page -> page-level\n`, {
      url,
      format: APPLICATION_SPEC_FORMAT,
      version: APPLICATION_SPEC_VERSION,
    }),
    'utf8'
  );
}
