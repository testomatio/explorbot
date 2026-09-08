import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  it('detects a scanner and exposes bash with readFile', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');

      const { tools, scanner } = await createScoutTools(loadScoutCorpus([dir]));

      expect(['rg', 'grep']).toContain(scanner);
      expect(Object.keys(tools).sort()).toEqual(['bash', 'readFile']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads corpus files through readFile and rejects excluded or outside paths', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');
      writePage(dir, 'settings.md', '/settings', 'User can change settings');

      const corpus = excludeCorpusUrls(loadScoutCorpus([dir]), ['/settings']);
      const { tools } = await createScoutTools(corpus);

      const inside = await tools.readFile.execute({ path: join(dir, 'invite.md') });
      expect(inside.success).toBe(true);
      expect(inside.content).toContain('invite teammates');

      const excluded = await tools.readFile.execute({ path: join(dir, 'settings.md') });
      expect(excluded.success).toBe(false);

      const outside = await tools.readFile.execute({ path: join(process.cwd(), 'package.json') });
      expect(outside.success).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runs commands over the corpus files through bash', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');

      const { tools, scanner } = await createScoutTools(loadScoutCorpus([dir]));
      const scan = scanner === 'rg' ? `${scanner} -l invite ${dir}` : `${scanner} -rl invite ${dir}`;
      const output = await tools.bash.execute({ command: scan.split('\\').join('/') });

      expect(output.exitCode).toBe(0);
      expect(output.stdout).toContain('invite.md');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts a text digest only after bash or readFile ran', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');

      const { tools, getResult, finishFromText } = await createScoutTools(loadScoutCorpus([dir]));

      finishFromText('made up digest');
      expect(getResult()).toBe('');

      await tools.readFile.execute({ path: join(dir, 'invite.md') });
      finishFromText('grounded digest');
      expect(getResult()).toBe('grounded digest');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('clamps the text digest', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-corpus-'));
    try {
      writePage(dir, 'invite.md', '/invite', 'User can invite teammates');

      const { tools, getResult, finishFromText } = await createScoutTools(loadScoutCorpus([dir]));

      await tools.readFile.execute({ path: join(dir, 'invite.md') });
      finishFromText('x'.repeat(10000));

      expect(getResult().length).toBe(6000);
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
