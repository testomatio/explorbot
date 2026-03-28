import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tag } from './logger.ts';
import { matchesUrl } from './url-matcher.ts';

const BUILT_IN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../rules');

export class RulesLoader {
  static loadRules(agentName: string, rulesConfig: RuleEntry[], currentUrl: string): string {
    const parts: string[] = [];

    for (const entry of rulesConfig) {
      if (typeof entry === 'string') {
        const content = loadFile(agentName, entry);
        if (content) parts.push(content);
        continue;
      }

      for (const [pattern, filename] of Object.entries(entry)) {
        if (!matchesUrl(pattern, currentUrl)) continue;
        const content = loadFile(agentName, filename);
        if (content) parts.push(content);
      }
    }

    return parts.join('\n\n');
  }

  static loadStyles(agentName: string, styleNames: string[]): Record<string, string> {
    const styles: Record<string, string> = {};
    for (const name of styleNames) {
      styles[name] = loadStyleFile(agentName, name);
    }
    return styles;
  }

  static getActiveStyle(styles: Record<string, string>, iteration: number, override?: string): { name: string; approach: string } {
    const names = Object.keys(styles);

    if (override) {
      const approach = styles[override];
      if (!approach) throw new Error(`Unknown planning style: "${override}". Available: ${names.join(', ')}`);
      return { name: override, approach };
    }

    const idx = iteration % names.length;
    const name = names[idx];
    return { name, approach: styles[name] };
  }

  static extractStyles(agentName: string, targetDir: string): string[] {
    const sourceDir = join(BUILT_IN_DIR, agentName, 'styles');
    if (!existsSync(sourceDir)) throw new Error(`No built-in styles found for agent: ${agentName}`);

    mkdirSync(targetDir, { recursive: true });

    const files = readdirSync(sourceDir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    const extracted: string[] = [];

    for (const file of files) {
      const target = join(targetDir, file);
      if (existsSync(target)) {
        tag('info').log(`Skipping ${file} (already exists)`);
        continue;
      }
      writeFileSync(target, readFileSync(join(sourceDir, file), 'utf8'));
      extracted.push(file);
      tag('success').log(`Extracted ${file}`);
    }

    return extracted;
  }
}

function loadFile(agentName: string, name: string, subdir?: string): string | undefined {
  const file = `${name}.md`;
  const segments = subdir ? [agentName, subdir, file] : [agentName, file];

  const userPath = join(process.cwd(), 'rules', ...segments);
  if (existsSync(userPath)) return readFileSync(userPath, 'utf8').trim();

  const builtInPath = join(BUILT_IN_DIR, ...segments);
  if (existsSync(builtInPath)) return readFileSync(builtInPath, 'utf8').trim();

  return undefined;
}

function loadStyleFile(agentName: string, name: string): string {
  const content = loadFile(agentName, name, 'styles');
  if (content) return content;

  const userPath = join(process.cwd(), 'rules', agentName, 'styles', `${name}.md`);
  const builtInPath = join(BUILT_IN_DIR, agentName, 'styles', `${name}.md`);
  throw new Error(`Style "${name}" not found for agent "${agentName}". Searched: ${userPath}, ${builtInPath}`);
}

type RuleEntry = string | Record<string, string>;

export type { RuleEntry };
