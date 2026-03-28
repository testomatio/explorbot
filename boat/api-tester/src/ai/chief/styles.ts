import { RulesLoader } from '../../../../../src/utils/rules-loader.ts';

const DEFAULT_STYLES = ['normal', 'psycho', 'curious', 'hacker'];

let cache: Record<string, string> | null = null;

export function getStyles(): Record<string, string> {
  if (cache) return cache;
  cache = RulesLoader.loadStyles('chief', DEFAULT_STYLES);
  return cache;
}

export function getActiveStyle(iteration: number, override?: string): { name: string; approach: string } {
  return RulesLoader.getActiveStyle(getStyles(), iteration, override);
}
