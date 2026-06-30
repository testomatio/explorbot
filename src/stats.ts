import { uniqExplorationName } from './utils/unique-names.ts';

interface TokenUsage {
  input: number;
  output: number;
  total: number;
  cached?: number;
}

export type ExplorbotMode = 'explore' | 'test' | 'freesail' | 'tui';

export class Stats {
  static startTime = Date.now();
  static sessionName = uniqExplorationName();
  static researches = 0;
  static tests = 0;
  static plans = 0;
  static mode?: ExplorbotMode;
  static focus?: string;
  static models: Record<string, TokenUsage> = {};

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

  static modelsTable(roleModels: Record<string, string>): string {
    const usedModels = Object.entries(Stats.models).filter(([, tokens]) => tokens.total > 0);
    if (usedModels.length === 0) return '';

    const rolesByModel: Record<string, string[]> = {};
    for (const [role, model] of Object.entries(roleModels)) {
      if (!rolesByModel[model]) rolesByModel[model] = [];
      rolesByModel[model].push(role);
    }

    const rows = usedModels.map(([model, tokens]) => {
      const roles = rolesByModel[model]?.join(', ') || '-';
      return `| ${roles} | ${model} | ${Stats.humanizeTokens(tokens.total)} |`;
    });

    return ['## Models', '', '| Role | Model | Tokens |', '| --- | --- | --- |', ...rows].join('\n');
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
