import type { Command } from 'commander';
import { Stats } from '../stats.ts';

export function registerKnowledgeOption(program: Command): void {
  program.option('--knowledge <text>', 'Knowledge for this run only, not saved to disk. Markdown text; add url: or endpoint: frontmatter to scope it, otherwise it applies everywhere. Repeatable', (value: string, previous: string[] = []) => [...previous, value]);
  program.hook('preAction', (_thisCommand, actionCommand) => {
    Stats.knowledge = actionCommand.optsWithGlobals().knowledge || [];
  });
}
