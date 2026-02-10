interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export class Stats {
  static startTime = Date.now();
  static researches = 0;
  static tests = 0;
  static plans = 0;
  static models: Record<string, TokenUsage> = {};

  static recordTokens(_agent: string, model: string, usage: TokenUsage): void {
    if (!this.models[model]) {
      this.models[model] = { input: 0, output: 0, total: 0 };
    }
    this.models[model].input += usage.input;
    this.models[model].output += usage.output;
    this.models[model].total += usage.total;
  }

  static getElapsedTime(): string {
    const elapsed = Date.now() - this.startTime;
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
    if (this.tests > 0 || this.plans > 0 || this.researches > 0) return true;
    const totalTokens = Object.values(this.models).reduce((sum, m) => sum + m.total, 0);
    return totalTokens > 0;
  }
}
