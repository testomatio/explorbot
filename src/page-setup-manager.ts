import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExplorbotConfig } from './config.js';
import type Explorer from './explorer.js';
import type { KnowledgeTracker } from './knowledge-tracker.js';
import type { StateManager } from './state-manager.js';
import { createDebug, tag } from './utils/logger.js';

const debugLog = createDebug('explorbot:page-setup');

export interface SetupScriptContext {
  page: any;
  context: any;
  explorer: Explorer;
  stateManager: StateManager;
  knowledgeTracker: KnowledgeTracker;
  config: ExplorbotConfig;
  log: (...args: any[]) => void;
}

interface SetupScriptModule {
  setup: (context: SetupScriptContext) => Promise<void>;
}

export class PageSetupManager {
  private scripts: SetupScriptModule[] = [];
  private explorer: Explorer;
  private config: ExplorbotConfig;
  private isLoaded = false;

  constructor(explorer: Explorer, config: ExplorbotConfig) {
    this.explorer = explorer;
    this.config = config;
  }

  async loadSetupScripts(): Promise<void> {
    if (this.isLoaded) return;

    const scriptPaths = this.config.playwright?.setupScripts || [];
    if (scriptPaths.length === 0) {
      debugLog('No setup scripts configured');
      this.isLoaded = true;
      return;
    }

    for (const scriptPath of scriptPaths) {
      try {
        const fullPath = resolve(scriptPath);

        if (!existsSync(fullPath)) {
          tag('warning').log(`Setup script not found: ${scriptPath}`);
          continue;
        }

        const module = await import(fullPath);

        if (typeof module.setup !== 'function') {
          tag('warning').log(`Setup script ${scriptPath} does not export a setup() function`);
          continue;
        }

        this.scripts.push(module);
        debugLog(`Loaded setup script: ${scriptPath}`);
        tag('substep').log(`Loaded setup script: ${scriptPath}`);
      } catch (error) {
        tag('error').log(`Failed to load setup script ${scriptPath}: ${error}`);
      }
    }

    this.isLoaded = true;
  }

  async executeAfterNavigation(page: any, url: string): Promise<void> {
    if (this.scripts.length === 0) return;

    debugLog(`Executing ${this.scripts.length} setup scripts after navigation to ${url}`);

    const context = this.createContext(page);

    for (const script of this.scripts) {
      try {
        await script.setup(context);
      } catch (error) {
        debugLog(`Setup script error: ${error}`);
      }
    }
  }

  private createContext(page: any): SetupScriptContext {
    return {
      page,
      context: page.context(),
      explorer: this.explorer,
      stateManager: this.explorer.getStateManager(),
      knowledgeTracker: this.explorer.getKnowledgeTracker(),
      config: this.config,
      log: (...args: any[]) => tag('setup').log(...args),
    };
  }
}
