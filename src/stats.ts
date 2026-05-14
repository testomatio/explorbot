import { uniqExplorationName } from './utils/unique-names.ts';

interface TokenUsage {
  input: number;
  output: number;
  total: number;
  cached?: number;
}

interface ErrorRecord {
  message: string;
  at: number;
}

export type ExplorbotMode = 'explore' | 'test' | 'freesail' | 'tui';

const MAX_RECENT_ERRORS = 8;

export class Stats {
  static startTime = Date.now();
  static sessionName = uniqExplorationName();
  static researches = 0;
  static tests = 0;
  static plans = 0;
  static mode?: ExplorbotMode;
  static focus?: string;
  static models: Record<string, TokenUsage> = {};
  static recentErrors: ErrorRecord[] = [];
  static consecutiveFailures = 0;
  static haltSession: string | null = null;
  static lastHealReason: string | null = null;

  static recordError(message: string): void {
    Stats.recentErrors.push({ message, at: Date.now() });
    if (Stats.recentErrors.length > MAX_RECENT_ERRORS) Stats.recentErrors.shift();
    Stats.consecutiveFailures++;
  }

  static recordSuccess(): void {
    Stats.consecutiveFailures = 0;
  }

  static recordTokens(_agent: string, model: string, usage: TokenUsage): void {
    if (!Stats.models[model]) {
      Stats.models[model] = { input: 0, output: 0, total: 0, cached: 0 };
    }
    Stats.models[model].input += usage.input;
    Stats.models[model].output += usage.output;
    Stats.models[model].total += usage.total;
    Stats.models[model].cached = (Stats.models[model].cached ?? 0) + (usage.cached ?? 0);
  }

  static getElapsedTime(): string {
    const elapsed = Date.now() - Stats.startTime;
    const seconds = Math.floor(elapsed / 1000) % 60;
    const minutes = Math.floor(elapsed / 60000) % 60;
    const hours = Math.floor(elapsed / 3600000);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }

  static humanizeTokens(num: number): string {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(0)}K`;
    }
    return String(num);
  }

  static hasActivity(): boolean {
    if (Stats.tests > 0 || Stats.plans > 0 || Stats.researches > 0) return true;
    const totalTokens = Object.values(Stats.models).reduce((sum, m) => sum + m.total, 0);
    return totalTokens > 0;
  }

  static sessionLabel(): string {
    return `${Stats.mode || 'session'}-${Stats.sessionName}`;
  }
}
