import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchMarkdown } from '../../src/ai/scout/search.ts';

describe('searchMarkdown', () => {
  it('finds case-insensitive hits with path and line via the js engine', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-search-'));
    try {
      mkdirSync(join(dir, 'pages'));
      writeFileSync(join(dir, 'pages', 'invite.md'), '---\nurl: /invite\n---\n# Invite\nUser can invite teammates');
      writeFileSync(join(dir, 'pages', 'other.md'), 'nothing relevant here');

      const hits = await searchMarkdown([dir], 'INVITE', { engine: 'js' });

      expect(hits.length).toBeGreaterThanOrEqual(2);
      expect(hits.some((hit) => hit.path.endsWith('invite.md'))).toBe(true);
      const contentHit = hits.find((hit) => hit.text.includes('invite teammates'));
      expect(contentHit?.line).toBe(5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caps hits and clamps long lines', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-search-'));
    try {
      const longLine = `${'x'.repeat(500)}login`;
      const lines = Array.from({ length: 80 }, () => `line about login ${longLine}`);
      writeFileSync(join(dir, 'big.md'), lines.join('\n'));

      const hits = await searchMarkdown([dir], 'login', { engine: 'js', maxHits: 10 });

      expect(hits).toHaveLength(10);
      expect(hits[0].text.length).toBeLessThanOrEqual(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('degrades an invalid regex to literal matching', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-search-'));
    try {
      writeFileSync(join(dir, 'page.md'), '---\nurl: /page\n---\nUser can (maybe) do things');

      const hits = await searchMarkdown([dir], '(maybe', { engine: 'js' });

      expect(hits).toHaveLength(1);
      expect(hits[0].text).toContain('(maybe)');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns no hits for empty pattern or missing dirs', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-search-'));
    try {
      writeFileSync(join(dir, 'page.md'), 'login content');

      expect(await searchMarkdown([dir], '   ', { engine: 'js' })).toEqual([]);
      expect(await searchMarkdown([join(dir, 'missing')], 'login', { engine: 'js' })).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto-detected engine returns the same hits as the js engine', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-search-'));
    try {
      mkdirSync(join(dir, 'pages'));
      writeFileSync(join(dir, 'pages', 'invite.md'), '---\nurl: /invite\n---\nUser can invite teammates');
      writeFileSync(join(dir, 'notes.txt'), 'login in a non-markdown file');

      const jsHits = await searchMarkdown([dir], 'invite', { engine: 'js' });
      const autoHits = await searchMarkdown([dir], 'invite');

      expect(autoHits.length).toBeGreaterThanOrEqual(jsHits.length);
      expect(autoHits.every((hit) => hit.path.endsWith('.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('translates regex character classes for the grep engine', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-search-'));
    try {
      writeFileSync(join(dir, 'nums.md'), 'item 42 ready\nletter dddd line\n');

      const hits = await searchMarkdown([dir], '\\d+', { engine: 'grep' });

      expect(hits.some((hit) => hit.text.includes('item 42'))).toBe(true);
      expect(hits.some((hit) => hit.text.includes('dddd'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives every matching file a share of the capped results', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.scout-search-'));
    try {
      mkdirSync(join(dir, 'sub'));
      const noisy = Array.from({ length: 60 }, (_, i) => `marker line ${i}`).join('\n');
      writeFileSync(join(dir, 'noisy.md'), noisy);
      writeFileSync(join(dir, 'sub', 'quiet.md'), 'one marker line only');

      const hits = await searchMarkdown([dir], 'marker', { engine: 'js' });

      expect(hits).toHaveLength(50);
      expect(hits.some((hit) => hit.path.endsWith('quiet.md'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
