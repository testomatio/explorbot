#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STAGE = path.join(ROOT, 'dist-mdq');
const PACKAGE = path.join(ROOT, 'src', 'utils', 'mdq');
const EXTERNAL = ['marked', 'yaml', 'commander'];

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(path.join(STAGE, 'bin'), { recursive: true });

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status === 0) return;
  console.error(result.stderr || result.stdout);
  process.exit(1);
}

function bundle(entry: string, outfile: string) {
  const args = [entry, '--target', 'node', '--format', 'esm', '--outfile', outfile];
  for (const name of EXTERNAL) args.push('--external', name);
  run('bun', ['build', ...args]);
}

bundle(path.join(PACKAGE, 'query.ts'), path.join(STAGE, 'index.js'));
bundle(path.join(ROOT, 'bin', 'mdq.ts'), path.join(STAGE, 'bin', 'mdq.js'));

const cli = path.join(STAGE, 'bin', 'mdq.js');
const shebanged = readFileSync(cli, 'utf8').replace(/^#!.*\n/, '');
writeFileSync(cli, `#!/usr/bin/env node\n${shebanged}`, { mode: 0o755 });

const types = path.join(STAGE, 'types');
run('bunx', [
  'tsc',
  path.join(PACKAGE, 'query.ts'),
  path.join(PACKAGE, 'edit.ts'),
  '--declaration',
  '--emitDeclarationOnly',
  '--noCheck',
  '--module',
  'esnext',
  '--moduleResolution',
  'bundler',
  '--target',
  'esnext',
  '--allowImportingTsExtensions',
  '--rewriteRelativeImportExtensions',
  '--skipLibCheck',
  '--outDir',
  types,
]);

for (const file of readdirSync(types)) {
  const target = path.join(types, file);
  writeFileSync(target, readFileSync(target, 'utf8').replaceAll("./edit.ts'", "./edit.js'"));
}

const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(PACKAGE, 'package.json'), 'utf8'));
manifest.version = root.version;
manifest.dependencies = {};
for (const name of EXTERNAL) manifest.dependencies[name] = root.dependencies[name];

writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(path.join(PACKAGE, 'README.md'), path.join(STAGE, 'README.md'));

console.log(`mdq ${manifest.version} staged in dist-mdq/`);
