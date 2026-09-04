import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';
import { createScoutTools, excludeCorpusUrls, loadScoutCorpus } from '../../src/ai/scout/tools.ts';
import { APPLICATION_SPEC_FORMAT, APPLICATION_SPEC_VERSION } from '../../src/application-spec-contract.ts';

describe('scout corpus', () => {
  it('loads markdown files with their frontmatter URLs', () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');
      writePage(dir, 'plain.md', undefined, 'A doc without frontmatter');

      const corpus = loadScoutCorpus([dir]);

      expect(corpus.files).toHaveLength(2);
      expect(corpus.files.find((file) => file.path.endsWith('invite.md'))?.url).toBe('/invite');
      expect(corpus.files.find((file) => file.path.endsWith('plain.md'))?.url).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes pages whose URL is already injected in full', () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');
      writePage(dir, 'settings.md', '/settings', 'User can change settings');

      const corpus = excludeCorpusUrls(loadScoutCorpus([dir]), ['/invite']);

      expect(corpus.files.map((file) => file.url)).toEqual(['/settings']);
      expect(corpus.excludedPaths).toHaveLength(1);
      expect(corpus.excludedPaths[0].endsWith('invite.md')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caps the corpus and stops loading further files', () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      for (let i = 0; i < 502; i++) writeFileSync(join(dir, `f${i}.md`), `page ${i}`);

      const corpus = loadScoutCorpus([dir]);

      expect(corpus.files).toHaveLength(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('scout tools', () => {
  it('searches the corpus and filters excluded paths', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'teammate invitations flow');
      writePage(dir, 'settings.md', '/settings', 'teammate settings flow');

      const corpus = excludeCorpusUrls(loadScoutCorpus([dir]), ['/settings']);
      const { tools } = createScoutTools(corpus);

      const result = await tools.searchDocs.execute({ query: 'teammate' });

      expect(result.success).toBe(true);
      expect(result.count).toBeGreaterThan(0);
      expect(result.hits.every((hit: any) => !hit.path.endsWith('settings.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads corpus files and rejects paths outside the corpus or excluded', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');
      writePage(dir, 'settings.md', '/settings', 'User can change settings');

      const corpus = excludeCorpusUrls(loadScoutCorpus([dir]), ['/settings']);
      const { tools } = createScoutTools(corpus);
      const settingsPath = join(dir, 'settings.md');

      const inside = await tools.readDoc.execute({ path: join(dir, 'invite.md') });
      expect(inside.success).toBe(true);
      expect(inside.content).toContain('invite teammates');

      const excluded = await tools.readDoc.execute({ path: settingsPath });
      expect(excluded.success).toBe(false);

      const excludedRelative = await tools.readDoc.execute({ path: relative(process.cwd(), settingsPath) });
      expect(excludedRelative.success).toBe(false);

      const outside = await tools.readDoc.execute({ path: join(process.cwd(), 'package.json') });
      expect(outside.success).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a report before anything was searched or read', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');

      const { tools, getResult, isFinished } = createScoutTools(loadScoutCorpus([dir]));

      const rejected = await tools.report.execute({ findings: 'made up findings' });
      expect(rejected.finished).toBe(false);
      expect(isFinished()).toBe(false);

      await tools.searchDocs.execute({ query: 'invite' });
      const accepted = await tools.report.execute({ findings: '- /invite: user can invite teammates' });
      expect(accepted.finished).toBe(true);
      expect(isFinished()).toBe(true);
      expect(getResult()).toBe('- /invite: user can invite teammates');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clamps reported findings', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');

      const { tools, getResult } = createScoutTools(loadScoutCorpus([dir]));

      await tools.searchDocs.execute({ query: 'invite' });
      await tools.report.execute({ findings: 'x'.repeat(10000) });

      expect(getResult().length).toBe(6000);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('warns the model when search results were capped', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      const lines = Array.from({ length: 80 }, (_, i) => `repeated marker line ${i}`);
      writeFileSync(join(dir, 'big.md'), lines.join('\n'));

      const { tools } = createScoutTools(loadScoutCorpus([dir]));

      const result = await tools.searchDocs.execute({ query: 'marker' });

      expect(result.count).toBe(50);
      expect(result.note).toContain('capped');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writePage(dir: string, filename: string, url: string | undefined, body: string): void {
  const data: Record<string, any> = { format: APPLICATION_SPEC_FORMAT, version: APPLICATION_SPEC_VERSION };
  if (url) data.url = url;
  writeFileSync(join(dir, filename), matter.stringify(body, data), 'utf8');
}
