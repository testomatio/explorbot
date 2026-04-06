import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ConfigParser, outputPath } from '../config.js';
import { tag } from '../utils/logger.js';
import { BaseCommand } from './base-command.js';

export const CLEAN_TARGETS: Record<string, { description: string; getDir: () => string }> = {
  states: { description: 'page states', getDir: () => outputPath('states') },
  research: { description: 'research cache', getDir: () => outputPath('research') },
  plans: { description: 'test plans', getDir: () => outputPath('plans') },
  experiences: { description: 'experience files', getDir: () => getExperienceDir() },
  output: { description: 'all output files', getDir: () => outputPath() },
};

function getExperienceDir(): string {
  const configParser = ConfigParser.getInstance();
  const config = configParser.getConfig();
  const configPath = configParser.getConfigPath();
  if (configPath) {
    return join(dirname(configPath), config.dirs?.experience || 'experience');
  }
  return config.dirs?.experience || 'experience';
}

function cleanDirectoryContents(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;
  let count = 0;
  for (const item of readdirSync(dirPath)) {
    const itemPath = join(dirPath, item);
    if (statSync(itemPath).isDirectory()) {
      count += cleanDirectoryContents(itemPath);
      rmSync(itemPath, { recursive: true });
    } else {
      unlinkSync(itemPath);
      count++;
    }
  }
  return count;
}

export class CleanCommand extends BaseCommand {
  name = 'clean';
  description = 'Clean files: clean [states|research|plans|experiences|output]';
  suggestions = Object.keys(CLEAN_TARGETS).map((t) => `/clean ${t}`);

  async execute(args: string): Promise<void> {
    const target = args.trim().toLowerCase();

    if (!target) {
      this.cleanTarget('output');
      this.cleanTarget('experiences');
      return;
    }

    if (!CLEAN_TARGETS[target]) {
      tag('error').log(`Unknown clean target: ${target}. Available: ${Object.keys(CLEAN_TARGETS).join(', ')}`);
      return;
    }

    this.cleanTarget(target);
  }

  private cleanTarget(name: string): void {
    const target = CLEAN_TARGETS[name];
    const dir = target.getDir();
    if (!existsSync(dir)) {
      tag('info').log(`${name}: nothing to clean (${dir} not found)`);
      return;
    }
    const count = cleanDirectoryContents(dir);
    tag('success').log(`Cleaned ${count} ${target.description} files from ${dir}`);
  }
}
