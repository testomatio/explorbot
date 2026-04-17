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

  static listStyleNames(agentName: string): string[] {
    const names = new Set<string>();
    const userDir = join(process.cwd(), 'rules', agentName, 'styles');
    const builtInDir = join(BUILT_IN_DIR, agentName, 'styles');
    for (const dir of [userDir, builtInDir]) {
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.md')) names.add(basename(f, '.md'));
      }
    }
    if (!names.size) {
      throw new Error(`No planning styles found for agent "${agentName}". Expected .md files under rules/${agentName}/styles/ or bundled rules.`);
    }
    return [...names].sort();
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

  static extractRules(agentName: string, targetDir: string): string[] {
    const sourceDir = join(BUILT_IN_DIR, agentName);
    if (!existsSync(sourceDir)) throw new Error(`No built-in rules found for agent: ${agentName}`);

    const extracted: string[] = [];
    copyMarkdownTree(sourceDir, targetDir, '', extracted);
    return extracted;
  }
}

function copyMarkdownTree(sourceDir: string, targetDir: string, relative: string, extracted: string[]): void {
  const entries = readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

  let dirCreated = false;
  const ensureTargetDir = () => {
    if (dirCreated) return;
    mkdirSync(targetDir, { recursive: true });
    dirCreated = true;
  };

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    const relPath = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      copyMarkdownTree(sourcePath, targetPath, relPath, extracted);
      continue;
    }

    if (!entry.name.endsWith('.md')) continue;

    if (existsSync(targetPath)) {
      tag('info').log(`Skipping ${relPath} (already exists)`);
      continue;
    }

    ensureTargetDir();
    writeFileSync(targetPath, readFileSync(sourcePath, 'utf8'));
    extracted.push(relPath);
    tag('success').log(`Extracted ${relPath}`);
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
