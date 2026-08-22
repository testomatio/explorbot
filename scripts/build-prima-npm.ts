#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(ROOT, 'dist-prima');
const TEMPLATE = path.join(ROOT, 'boat', 'prima', 'package.json');
const README = path.join(ROOT, 'boat', 'prima', 'README.md');
const PAYLOAD = ['src', 'boat/prima', 'models.json', 'rules', 'assets/sample-files'];

function distPath(entry: string): string {
  const source = path.join(DIST, entry);
  if (existsSync(source)) return source;
  console.error(`dist/${entry} is missing. Run \`bun run build:npm\` first.`);
  process.exit(1);
}

distPath('boat/prima/bin/prima-cli.js');

rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

for (const entry of PAYLOAD) {
  const target = path.join(STAGE, 'dist', entry);
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(distPath(entry), target, { recursive: true });
}

const root = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(TEMPLATE, 'utf8'));
manifest.version = root.version;
manifest.dependencies = root.dependencies;
manifest.overrides = root.overrides;
manifest.resolutions = root.resolutions;

writeFileSync(path.join(STAGE, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
cpSync(README, path.join(STAGE, 'README.md'));

console.log(`prima-cli ${manifest.version} staged in dist-prima/`);
