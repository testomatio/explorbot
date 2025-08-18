import path from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import type { ExplorbotConfig } from '../explorbot.config.js';
import Action from './action.js';
import { Navigator } from './ai/navigator.js';
import { AIProvider } from './ai/provider.js';
import { ConfigParser } from './config.js';
import { StateManager } from './state-manager.js';
import { log, createDebug } from './utils/logger.js';
import { Researcher } from './ai/researcher.ts';
import { ActionResult } from './action-result.ts';

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
  private config: ExplorbotConfig | null = null;
  private configParser: ConfigParser;
  private aiProvider!: AIProvider;
  playwrightHelper: any;
  public isStarted = false;
  actor!: CodeceptJS.I;
  private stateManager!: StateManager;
  private researcher!: Researcher;
  private navigator!: Navigator;

  constructor() {
    this.configParser = ConfigParser.getInstance();
  }

  private async initializeContainer(): Promise<void> {
    try {
      this.config = this.configParser.getConfig();

      (global as any).output_dir = path.join(process.cwd(), 'output');

      this.configParser.validateConfig(this.config);

      const codeceptConfig = this.convertToCodeceptConfig(this.config);

      codeceptjs.container.create(codeceptConfig, {});
    } catch (error) {
      log(`❌ Failed to initialize container: ${error}`);
      throw error;
    }
  }

  private async initializeAI(): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call run() first.');
    }

    if (!this.aiProvider) {
      this.aiProvider = new AIProvider(this.config.ai);
      await this.aiProvider.initialize();
      this.navigator = new Navigator(this.aiProvider);
      this.researcher = new Researcher(this.aiProvider);
    }

    const configPath = this.configParser.getConfigPath();
    const configDir = configPath ? path.dirname(configPath) : process.cwd();
    const experienceDir = path.join(
      configDir,
      this.config?.dirs?.experience || 'experience'
    );

    const knowledgeDir = path.join(
      configDir,
      this.config?.dirs?.knowledge || 'knowledge'
    );
    this.stateManager = new StateManager(knowledgeDir, experienceDir);
  }

  private convertToCodeceptConfig(config: ExplorbotConfig): any {
    const playwrightConfig = { ...config.playwright };

    if (!config.playwright.show && !process.env.CI) {
      if (config.playwright.browser === 'chromium') {
        const debugPort = 9222;
        playwrightConfig.chromium ||= {};
        playwrightConfig.chromium.args = [
          ...(config.playwright.args || []),
          `--remote-debugging-port=${debugPort}`,
          '--remote-debugging-address=0.0.0.0',
        ];

        log('🔧 Browser started in headless mode with debug protocol');
        log('🌐 To connect your local Chrome to the headless browser:');
        log(`   Visit: http://localhost:${debugPort}`);
      } else if (config.playwright.browser === 'firefox') {
        const debugPort = 9222;
        playwrightConfig.firefox ||= {};
        playwrightConfig.firefox.args = [
          ...(config.playwright.args || []),
          `--remote-debugging-port=${debugPort}`,
        ];

        log('🔧 Browser started in headless mode with debug protocol');
        log('🌐 To connect your local Firefox to the headless browser:');
        log('   1. Open Firefox browser');
        log('   2. Navigate to: about:debugging#/runtime/this-firefox');
        log(`   3. Click "Connect..." and enter: localhost:${debugPort}`);
      } else {
        log(`🔧 Browser started in headless mode`);
        log(`ℹ️  WebKit doesn't support remote debugging in headless mode`);
        log(`   To see browser actions, set headless: false in your config`);
      }
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
    return this.configParser.getConfigPath();
  }

  public getAIProvider(): AIProvider | null {
    return this.aiProvider;
  }

  public getStateManager(): StateManager {
    return this.stateManager;
  }

  async start() {
    if (!this.config) {
      await this.initializeContainer();
    }

    await codeceptjs.recorder.start();
    await codeceptjs.container.started(null);

    this.playwrightHelper = codeceptjs.container.helpers('Playwright');
    await this.playwrightHelper._startBrowser();
    await this.playwrightHelper._createContextPage();
    await this.initializeAI();
    const I = codeceptjs.container.support('I');

    this.actor = I;
    this.isStarted = true;

    this.listenToStateChanged();

    return I;
  }

  createAction() {
    return new Action(this.actor, this.aiProvider, this.stateManager);
  }

  async visit(url: string) {
    const action = this.createAction();
    await action.execute(`I.amOnPage('${url}')`);
    await action.expect(`I.seeInCurrentUrl('${url}')`);
    await action.resolve();
  }

  async research() {
    const state = this.stateManager.getCurrentState();
    if (!state) return 'No state found';

    // Create ActionResult from current state
    const actionResult = ActionResult.fromState(state);
    const research = await this.researcher.research(actionResult);
    return research;
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

export default Explorer;
