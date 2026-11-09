import path from 'node:path';
import chalk from 'chalk';
import figures from 'figures';
import { tag } from './logger.js';

export interface NextStepCommand {
  label: string;
  command: string;
}

export interface NextStepSection {
  label: string;
  path?: string;
  commands?: NextStepCommand[];
}

export function relativeToCwd(absPath: string): string {
  const rel = path.relative(process.cwd(), absPath);
  return rel || '.';
}

export function printNextSteps(sections: NextStepSection[]): void {
  if (sections.length === 0) return;

  const lines: string[] = [''];
  let isDefault = true;
  for (const section of sections) {
    const headerPath = section.path ? relativeToCwd(section.path) : '';
    lines.push(headerPath ? `${chalk.bold(section.label)}  ${chalk.gray(headerPath)}` : `${chalk.bold(section.label)}`);

    for (const cmd of section.commands || []) {
      if (cmd.label) lines.push(BLANK);
      if (isDefault) {
        if (cmd.label) lines.push(chalk.bold.yellow(`${figures.pointer} ${cmd.label}`));
        lines.push(chalk.bold(`    ${cmd.command}`));
        isDefault = false;
        continue;
      }
      if (cmd.label) lines.push(chalk.dim(`  ${cmd.label}`));
      lines.push(`  ${cmd.command}`);
    }
    lines.push(BLANK);
  }

  tag('info').log(lines.join('\n'));
}

const BLANK = ' ';
