import path from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import Action from './action.js';
import { AIProvider } from './ai/provider.js';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.js';
import type { UserResolveFunction } from './explorbot.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import { StateManager } from './state-manager.js';
import { createDebug, log, tag } from './utils/logger.js';

declare global {
  namespace NodeJS {
    interface Global {
      output_dir: string;
    }
  }
}

declare namespace CodeceptJS {
  interface I {
    [key: string]: any;
  }
}

const debugLog = createDebug('explorbot:explorer');
class Explorer {
  private aiProvider: AIProvider;
  playwrightHelper: any;
  public isStarted = false;
  actor!: CodeceptJS.I;
  private stateManager!: StateManager;
  private knowledgeTracker!: KnowledgeTracker;
  config: ExplorbotConfig;
  private userResolveFn: UserResolveFunction | null = null;
  private options?: { show?: boolean; headless?: boolean };

  constructor(config: ExplorbotConfig, aiProvider: AIProvider, options?: { show?: boolean; headless?: boolean }) {
    this.config = config;
    this.aiProvider = aiProvider;
    this.options = options;
    this.initializeContainer();
    this.stateManager = new StateManager();
    this.knowledgeTracker = new KnowledgeTracker();
  }

  private initializeContainer() {
    try {
      // Use project root for output directory, not current working directory
      const configParser = ConfigParser.getInstance();
      const configPath = configParser.getConfigPath();
      const projectRoot = configPath ? path.dirname(configPath) : process.cwd();
      (global as any).output_dir = path.join(projectRoot, 'output');

      configParser.validateConfig(this.config);

      const codeceptConfig = this.convertToCodeceptConfig(this.config);

      codeceptjs.container.create(codeceptConfig, {});
    } catch (error) {
      log(`❌ Failed to initialize container: ${error}`);
      throw error;
    }
  }

  private convertToCodeceptConfig(config: ExplorbotConfig): {
    helpers: { Playwright: any };
  } {
    const playwrightConfig = { ...config.playwright };

    if (this.options?.show !== undefined) {
      playwrightConfig.show = this.options.show;
    }
    if (this.options?.headless !== undefined) {
      playwrightConfig.show = !this.options.headless;
    }

    let debugInfo = '';

    if (!playwrightConfig.show && !process.env.CI) {
      if (config.playwright.browser === 'chromium') {
        const debugPort = 9222;
        playwrightConfig.chromium ||= {};
        playwrightConfig.chromium.args = [...(config.playwright.args || []), `--remote-debugging-port=${debugPort}`, '--remote-debugging-address=0.0.0.0'];

        debugInfo = `Enabling debug protocol for Chromium at http://localhost:${debugPort}`;
      } else if (config.playwright.browser === 'firefox') {
        const debugPort = 9222;
        playwrightConfig.firefox ||= {};
        playwrightConfig.firefox.args = [...(config.playwright.args || []), `--remote-debugging-port=${debugPort}`];
        debugInfo = `Enabling debug protocol for Firefox at http://localhost:${debugPort}`;
      }
    }

    log(`${playwrightConfig.browser} starting in ${playwrightConfig.show ? 'headed' : 'headless'} mode`);
    if (debugInfo) {
      tag('substep').log(debugInfo);
    }
    return {
      helpers: {
        Playwright: {
          ...playwrightConfig,
        },
      },
    };
  }

  public getConfig(): ExplorbotConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call run() first.');
    }
    return this.config;
  }

  public getConfigPath(): string | null {
    const configParser = ConfigParser.getInstance();
    return configParser.getConfigPath();
  }

  public getAIProvider(): AIProvider {
    return this.aiProvider;
  }

  public getStateManager(): StateManager {
    return this.stateManager;
  }

  public getCurrentUrl(): string {
    return this.stateManager.getCurrentState()!.url || '?';
  }

  public getKnowledgeTracker(): KnowledgeTracker {
    return this.knowledgeTracker;
  }

  async start() {
    if (this.isStarted) {
      return;
    }

    if (!this.config) {
      await this.initializeContainer();
    }

    await codeceptjs.recorder.start();
    await codeceptjs.container.started(null);

    codeceptjs.recorder.retry({
      retries: this.config.action?.retries || 3,
      when: (err: any) => {
        if (!err || typeof err.message !== 'string') {
          return false;
        }
        // ignore context errors
        return err.message.includes('context');
      },
    });

    this.playwrightHelper = codeceptjs.container.helpers('Playwright');
    if (!this.playwrightHelper) {
      throw new Error('Playwright helper not available');
    }
    await this.playwrightHelper._startBrowser();
    await this.playwrightHelper._createContextPage();
    const I = codeceptjs.container.support('I');

    this.actor = I;
    this.isStarted = true;

    this.listenToStateChanged();

    tag('success').log('Browser started, ready to explore');

    return I;
  }

  createAction() {
    return new Action(this.actor, this.stateManager);
  }

  visit(url: string) {
    return this.createAction().execute(`I.amOnPage('${url}')`);
  }

  setUserResolve(userResolveFn: UserResolveFunction): void {
    this.userResolveFn = userResolveFn;
  }

  trackSteps(enable = true) {
    if (enable) {
      codeceptjs.event.dispatcher.on('step.start', stepTracker);
    } else {
      codeceptjs.event.dispatcher.off('step.start', stepTracker);
    }
  }

  private listenToStateChanged(): void {
    if (!this.playwrightHelper) {
      debugLog('⚠️ Playwright helper not available for state monitoring');
      return;
    }

    try {
      const page = this.playwrightHelper.page;
      if (!page) {
        debugLog('⚠️ Playwright page not available for state monitoring');
        return;
      }

      page.on('framenavigated', async (frame: any) => {
        if (frame !== page.mainFrame()) return;

        const newUrl = await frame.url();
        let newTitle = '';

        try {
          newTitle = await frame.title();
        } catch (error) {
          debugLog('Failed to get page title:', error);
        }

        // Update state from navigation
        this.stateManager.updateStateFromBasic(newUrl, newTitle, 'navigation');

        await new Promise((resolve) => setTimeout(resolve, 500));

        // try {
        //   const action = this.createAction();
        //   await action.execute('// Automatic state capture on navigation');
        // } catch (error) {
        //   const errorMessage = error instanceof Error ? error.message : String(error);
        //   console.warn(
        //     '⚠️ Failed to capture state on navigation:',
        //     errorMessage
        //   );
        // }
      });

      debugLog('👂 Listening for automatic state changes');
    } catch (error) {
      debugLog('⚠️ Failed to set up state change monitoring:', error);
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    await this.playwrightHelper._stopBrowser();
    await codeceptjs.recorder.stop();
  }
}

function stepTracker(step: any) {
  if (!step.toCode) {
    return;
  }
  if (step?.name?.startsWith('grab')) return;
  tag('step').log(step.toCode());
}

export default Explorer;
