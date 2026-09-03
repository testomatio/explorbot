import type { ExplorbotConfig } from '../../config.ts';
import { createDebug } from '../../utils/logger.js';

export type Constructor<T = object> = new (...args: any[]) => T;
export const debugLog = createDebug('explorbot:researcher');

export function researchEnabled(config: ExplorbotConfig): boolean {
  return config.ai?.agents?.researcher?.enabled !== false;
}
