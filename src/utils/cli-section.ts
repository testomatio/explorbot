import chalk from 'chalk';

export function renderSection(title: string, entries: [string, string][], indent = 0): string[] {
  if (!entries.length) return [];

  const pad = ' '.repeat(indent);
  const width = Math.max(...entries.map(([label]) => label.length));
  const lines = [`${pad}${chalk.bold(title)}`];
  for (const [label, value] of entries) lines.push(`${pad}  ${chalk.dim(label.padEnd(width))}  ${value}`);
  lines.push('');
  return lines;
}
