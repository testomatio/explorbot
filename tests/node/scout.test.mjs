import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '../../..');

describe('Scout on Node.js', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(process.cwd(), 'scout-node-'));
    writeFileSync(join(dir, 'invite.md'), 'User can invite teammates');
  });

  after(() => rmSync(dir, { recursive: true, force: true }));

  it('finds a scanner and searches the corpus', async () => {
    const { createScoutTools, loadScoutCorpus } = await import(join(root, 'dist/src/ai/scout/tools.js'));

    const { tools, scanner } = await createScoutTools(loadScoutCorpus([dir]));

    assert.ok(['rg', 'grep'].includes(scanner));
    const result = await tools.bash.execute({ command: 'grep -r teammates .' });
    assert.match(result.stdout, /invite teammates/);
  });
});
