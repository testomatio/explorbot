import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dist = join(root, 'dist');

describe('npm build', () => {
  it('dist/ directory exists', () => {
    assert.ok(existsSync(dist), 'dist/ not found — run `bun run build:npm` first');
  });

  it('CLI entry point has node shebang', () => {
    const cli = join(dist, 'bin/explorbot-cli.js');
    assert.ok(existsSync(cli), 'dist/bin/explorbot-cli.js not found');
    const firstLine = readFileSync(cli, 'utf8').split('\n')[0];
    assert.strictEqual(firstLine, '#!/usr/bin/env node');
  });

  it('CLI --help runs on Node.js', () => {
    const output = execSync(`node ${join(dist, 'bin/explorbot-cli.js')} --help`, { encoding: 'utf8' });
    assert.ok(output.includes('Usage:'), 'CLI help output missing Usage:');
    assert.ok(output.includes('explorbot'), 'CLI help output missing explorbot');
  });

  it('fingerprint worker resolves to .js in compiled output', () => {
    const cacheFile = join(dist, 'src/ai/researcher/cache.js');
    assert.ok(existsSync(cacheFile), 'compiled cache.js not found');
    const content = readFileSync(cacheFile, 'utf8');
    assert.ok(content.includes('import.meta.url.endsWith'), 'worker extension detection missing');

    const workerFile = join(dist, 'src/ai/researcher/fingerprint-worker.js');
    assert.ok(existsSync(workerFile), 'compiled fingerprint-worker.js not found');
  });

  it('rules/ directory is copied to dist/', () => {
    assert.ok(existsSync(join(dist, 'rules')), 'dist/rules/ not found');
    assert.ok(existsSync(join(dist, 'rules/researcher')), 'dist/rules/researcher/ not found');
  });

  it('assets are copied to dist/', () => {
    assert.ok(existsSync(join(dist, 'assets/sample-files')), 'dist/assets/sample-files/ not found');
  });

  it('.ts imports are rewritten to .js', () => {
    const explorerFile = join(dist, 'src/explorer.js');
    const content = readFileSync(explorerFile, 'utf8');
    assert.ok(!content.match(/from ['"]\..*\.ts['"]/), 'found unrewritten .ts import in explorer.js');
  });

  it('no require() mixed with ESM imports', () => {
    const curlerTools = join(dist, 'boat/api-tester/src/ai/curler-tools.js');
    const content = readFileSync(curlerTools, 'utf8');
    assert.ok(!content.includes('require('), 'found require() in curler-tools.js — breaks Node.js ESM');
  });
});
