import micromatch from 'micromatch';
import type { ExplorbotConfig, Hook, HookConfig } from '../config.ts';
import type Explorer from '../explorer.ts';
import { createDebug } from './logger.ts';

const debugLog = createDebug('explorbot:hooks');

export class HooksRunner {
  constructor(
    private explorer: Explorer,
    private config: ExplorbotConfig
  ) {}

  async runBeforeHook(agentName: string, url: string): Promise<void> {
    await this.runHook(agentName, 'beforeHook', url);
  }

  async runAfterHook(agentName: string, url: string): Promise<void> {
    await this.runHook(agentName, 'afterHook', url);
  }

  private async runHook(agentName: string, hookType: 'beforeHook' | 'afterHook', url: string): Promise<void> {
    const agentConfig = this.config.ai?.agents?.[agentName as keyof typeof this.config.ai.agents];
    if (!agentConfig) return;

    const hookConfig = agentConfig[hookType];
    if (!hookConfig) return;

    const hook = this.findMatchingHook(hookConfig, url);
    if (!hook) return;

    debugLog(`Running ${hookType} for ${agentName} at ${url}`);
    await this.executeHook(hook, url);
  }

  private findMatchingHook(config: HookConfig, url: string): Hook | null {
    if (this.isSingleHook(config)) return config as Hook;

    const urlPath = this.extractPath(url);
    for (const [pattern, hook] of Object.entries(config)) {
      if (this.matchesPattern(pattern, urlPath)) return hook as Hook;
    }
    return null;
  }

  private async executeHook(hook: Hook, url: string): Promise<void> {
    try {
      if (hook.type === 'playwright') {
        const page = this.explorer.playwrightHelper.page;
        await hook.hook({ page, url });
      } else {
        const I = this.explorer.actor;
        await hook.hook({ I, url });
      }
    } catch (error) {
      debugLog(`Hook error: ${error}`);
    }
  }

  private isSingleHook(config: HookConfig): boolean {
    return 'type' in config && 'hook' in config;
  }

  private extractPath(url: string): string {
    if (url.startsWith('/')) return url;
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private matchesPattern(pattern: string, path: string): boolean {
    if (pattern === '*') return true;
    if (pattern.toLowerCase() === path.toLowerCase()) return true;

    if (pattern.endsWith('/*')) {
      const base = pattern.slice(0, -2);
      if (path === base || path.startsWith(`${base}/`)) return true;
    }

    if (pattern.startsWith('^')) {
      try {
        return new RegExp(pattern.slice(1)).test(path);
      } catch {
        return false;
      }
    }

    return micromatch.isMatch(path, pattern);
  }
}
