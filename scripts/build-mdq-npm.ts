#!/usr/bin/env bun
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STAGE = path.join(ROOT, 'dist-mdq');
const PACKAGE = path.join(ROOT, 'src', 'utils', 'mdq');
const EXTERNAL = ['marked', 'yaml', 'commander'];

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(path.join(STAGE, 'bin'), { recursive: true });

async function bundle(entry: string, outfile: string) {
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'node',
    format: 'esm',
    external: EXTERNAL,
    outdir: path.dirname(outfile),
    naming: path.basename(outfile),
  });
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await bundle(path.join(PACKAGE, 'query.ts'), path.join(STAGE, 'index.js'));
await bundle(path.join(ROOT, 'bin', 'mdq.ts'), path.join(STAGE, 'bin', 'mdq.js'));

const cli = path.join(STAGE, 'bin', 'mdq.js');
const shebanged = readFileSync(cli, 'utf8').replace(/^#!.*\n/, '');
writeFileSync(cli, `#!/usr/bin/env node\n${shebanged}`, { mode: 0o755 });

const types = path.join(STAGE, 'types');
const declarations = Bun.spawnSync([
  'bunx',
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
if (declarations.exitCode !== 0) {
  console.error(declarations.stderr.toString());
  process.exit(1);
}

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
