import path from 'node:path';
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

  const blocks: string[] = [];
  for (const section of sections) {
    const lines: string[] = [];
    const headerPath = section.path ? relativeToCwd(section.path) : '';
    lines.push(headerPath ? `${section.label}: ${headerPath}` : section.label);

    const commands = section.commands || [];
    if (commands.length > 0) {
      const labeled = commands.filter((c) => c.label);
      const maxLabel = labeled.length > 0 ? Math.max(...labeled.map((c) => c.label.length)) : 0;
      for (const cmd of commands) {
        if (!cmd.label) {
          lines.push(`  ${cmd.command}`);
          continue;
        }
        const padded = `${cmd.label}:`.padEnd(maxLabel + 2);
        lines.push(`  ${padded} ${cmd.command}`);
      }
    }
    blocks.push(lines.join('\n'));
  }

  for (let i = 0; i < blocks.length; i++) {
    if (i > 0) tag('info').log('');
    for (const line of blocks[i].split('\n')) {
      tag('info').log(line);
    }
  }
}
