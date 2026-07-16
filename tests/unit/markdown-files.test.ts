import { expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadMarkdownFiles } from '../../src/utils/markdown-files.ts';

it('reports unreadable markdown files and continues loading', () => {
  const dir = mkdtempSync(join(process.cwd(), '.markdown-files-'));
  const unreadablePath = join(dir, 'unreadable.md');
  const errors: Array<{ filePath: string; error: unknown }> = [];

  try {
    writeFileSync(join(dir, 'valid.md'), '---\nurl: /page\n---\nContent');
    mkdirSync(unreadablePath);

    const files = loadMarkdownFiles(dir, {
      onError: (filePath, error) => errors.push({ filePath, error }),
    });

    expect(files).toHaveLength(1);
    expect(files[0].data.url).toBe('/page');
    expect(errors).toHaveLength(1);
    expect(errors[0].filePath).toBe(unreadablePath);
    expect(errors[0].error).toBeInstanceOf(Error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
