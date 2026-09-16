#!/usr/bin/env node
import { runMdq } from '../src/utils/mdq/cli.ts';

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const result = await runMdq(process.argv.slice(2), readStdin);
if (result.output) {
  let text = result.output;
  if (!text.endsWith('\n')) text = `${text}\n`;
  process.stdout.write(text);
}
process.exit(result.code);
