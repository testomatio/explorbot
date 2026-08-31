import { existsSync } from 'node:fs';
import path from 'node:path';
import { listSites } from '../global-config.ts';

const SITE_PLANS_DIR = ['output', 'plans'];

export function resolvePlanPath(filename: string, plansDir?: string): string {
  const names = [filename];
  if (!filename.endsWith('.md')) names.push(`${filename}.md`);

  if (path.isAbsolute(filename)) return names.find(existsSync) || filename;

  const dirs = [process.cwd()];
  if (plansDir) dirs.push(plansDir);
  if (!plansDir) dirs.push(...listSites().map((site) => path.join(site.dir, ...SITE_PLANS_DIR)));

  for (const dir of dirs) {
    const found = names.map((name) => path.join(dir, name)).find(existsSync);
    if (found) return found;
  }

  return path.join(plansDir || process.cwd(), names[names.length - 1]);
}
