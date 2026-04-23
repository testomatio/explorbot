import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigParser } from '../config.ts';
import { tag } from '../utils/logger.ts';
import { BaseCommand } from './base-command.js';

export class RerunCommand extends BaseCommand {
  name = 'rerun';
  description = 'Re-run generated tests with AI auto-healing';
  tuiEnabled = true;

  async execute(args: string): Promise<void> {
    const { args: remaining } = this.parseArgs(args);
    const filename = remaining[0];
    const indexArg = remaining[1];

    if (!filename) {
      tag('error').log('Usage: /rerun <filename> [index]');
      return;
    }

    let filePath = resolve(filename);
    if (!existsSync(filePath)) {
      filePath = resolve(ConfigParser.getInstance().getTestsDir(), filename);
    }

    if (filePath.endsWith('.spec.ts') || filePath.endsWith('.spec.js')) {
      tag('error').log(`Rerun does not support Playwright tests. Run them with: npx playwright test ${filePath}`);
      return;
    }

    const testIndices = indexArg ? parseTestIndices(indexArg) : undefined;
    await this.explorBot.agentRerunner().rerun(filePath, { testIndices });
  }
}

function parseTestIndices(input: string): number[] {
  if (input === '*' || input === 'all') return [];

  const indices = new Set<number>();
  for (const part of input.split(',')) {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let i = Number.parseInt(range[1]); i <= Number.parseInt(range[2]); i++) indices.add(i - 1);
    } else {
      indices.add(Number.parseInt(trimmed) - 1);
    }
  }
  return [...indices].sort((a, b) => a - b);
}
