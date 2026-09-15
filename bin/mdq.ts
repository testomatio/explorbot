#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { runMdq } from '../src/utils/mdq/cli.ts';

let stdin = '';
if (!process.stdin.isTTY) stdin = readFileSync(0, 'utf8');

const result = await runMdq(process.argv.slice(2), stdin);
if (result.output) {
  let text = result.output;
  if (!text.endsWith('\n')) text = `${text}\n`;
  process.stdout.write(text);
}
process.exit(result.code);
