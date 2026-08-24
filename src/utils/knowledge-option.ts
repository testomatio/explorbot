import type { Command } from 'commander';

export function addKnowledgeOption(cmd: Command): Command {
  return cmd.option('--knowledge <text>', 'Knowledge for this run only, not saved to disk. Markdown text; add url: or endpoint: frontmatter to scope it, otherwise it applies everywhere. Repeatable', (value: string, previous: string[] = []) => [...previous, value]);
}
