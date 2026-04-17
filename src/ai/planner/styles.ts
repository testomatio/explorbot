import { ConfigParser } from '../../config.ts';
import { RulesLoader } from '../../utils/rules-loader.ts';

const DEFAULT_STYLES = ['normal', 'curious', 'psycho'];

let cache: Record<string, string> | null = null;

export function getStyles(): Record<string, string> {
  if (cache) return cache;
  const cfg = ConfigParser.getInstance().getConfig().ai?.agents?.planner;
  cache = RulesLoader.loadStyles('planner', cfg?.styles || DEFAULT_STYLES);
  return cache;
}

export function getActiveStyle(iteration: number, override?: string): { name: string; approach: string } {
  return RulesLoader.getActiveStyle(getStyles(), iteration, override);
}

export function clearStyleCache(): void {
  cache = null;
}
