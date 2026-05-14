import { dirname } from 'node:path';
import { ConfigParser } from '../../config.ts';
import type { ExplorBot } from '../../explorbot.ts';
import type { Task } from '../../test-plan.ts';
import { createDebug } from '../../utils/logger.js';

export type Constructor<T = object> = new (...args: any[]) => T;

export const debugLog = createDebug('explorbot:captain');

export type CaptainMode = 'idle' | 'web' | 'test' | 'heal';

export interface ModeContext {
  explorBot: ExplorBot;
  task: Task;
}

export function resolveProjectRoot(): string | null {
  const configPath = ConfigParser.getInstance().getConfigPath();
  if (!configPath) return null;
  return dirname(configPath);
}
