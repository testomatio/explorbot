import path from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import type { ExplorbotConfig } from '../explorbot.config.js';
import Action from './action.js';
import { Navigator } from './ai/navigator.js';
import { AIProvider } from './ai/provider.js';
import { ConfigParser } from './config.js';
import { StateManager } from './state-manager.js';
import { log, createDebug, tag } from './utils/logger.js';
import { Researcher } from './ai/researcher.js';
import { Planner, type Task } from './ai/planner.js';
import { createCodeceptJSTools } from './ai/tools.js';
import { ActionResult } from './action-result.js';
import { Conversation } from './ai/conversation.js';
import { ExperienceCompactor } from './ai/experience-compactor.js';
import type { UserResolveFunction } from './explorbot.js';

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
  private configParser: ConfigParser;
  private aiProvider!: AIProvider;
  playwrightHelper: any;
  public isStarted = false;
  actor!: CodeceptJS.I;
  private stateManager!: StateManager;
  private researcher!: Researcher;
  private planner!: Planner;
  private navigator!: Navigator;
  config: ExplorbotConfig;
  private userResolveFn: UserResolveFunction | null = null;
  scenarios: Task[] = [];

  constructor() {
    this.configParser = ConfigParser.getInstance();
    this.config = this.configParser.getConfig();
    this.initializeContainer();
    this.initializeAI();
  }

  private initializeContainer() {
    try {
      // Use project root for output directory, not current working directory
      const configPath = this.configParser.getConfigPath();
      const projectRoot = configPath ? path.dirname(configPath) : process.cwd();
      (global as any).output_dir = path.join(projectRoot, 'output');

      this.configParser.validateConfig(this.config);

      const codeceptConfig = this.convertToCodeceptConfig(this.config);

      codeceptjs.container.create(codeceptConfig, {});
    } catch (error) {
      log(`❌ Failed to initialize container: ${error}`);
      throw error;
    }
  }

  private async initializeAI(): Promise<void> {
    if (!this.aiProvider) {
      this.aiProvider = new AIProvider(this.config.ai);
      this.stateManager = new StateManager();
      this.navigator = new Navigator(this.aiProvider);
      this.researcher = new Researcher(this.aiProvider, this.stateManager);
      this.planner = new Planner(this.aiProvider, this.stateManager);
    }
  }

  private convertToCodeceptConfig(config: ExplorbotConfig): {
    helpers: { Playwright: any };
  } {
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

        log(
          `Enabling debug protocol for Chromium at http://localhost:${debugPort}`
        );
      } else if (config.playwright.browser === 'firefox') {
        const debugPort = 9222;
        playwrightConfig.firefox ||= {};
        playwrightConfig.firefox.args = [
          ...(config.playwright.args || []),
          `--remote-debugging-port=${debugPort}`,
        ];
        log(
          `Enabling debug protocol for Firefox at http://localhost:${debugPort}`
        );
      }
    }

    log(`${playwrightConfig.browser} started in headless mode`);

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

  public getAIProvider(): AIProvider {
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
    if (!this.playwrightHelper) {
      throw new Error('Playwright helper not available');
    }
    await this.playwrightHelper._startBrowser();
    await this.playwrightHelper._createContextPage();
    const I = codeceptjs.container.support('I');

    this.actor = I;
    this.isStarted = true;

    this.listenToStateChanged();

    return I;
  }

  createAction() {
    return new Action(
      this.actor,
      this.aiProvider,
      this.stateManager,
      this.userResolveFn || undefined
    );
  }

  async visit(url: string) {
    try {
      const action = this.createAction();

      await action.execute(`I.amOnPage('${url}')`);
      await action.expect(`I.seeInCurrentUrl('${url}')`);
      await action.resolve();
    } catch (error) {
      console.error(`Failed to visit initial page ${url}:`, error);
      throw error;
    }
  }

  async research() {
    log('Researching...');
    const tools = createCodeceptJSTools(this.actor);
    const conversation = await this.researcher.research(tools);
    return conversation;
  }

  async plan() {
    log('Researching...');

    await this.researcher.research();
    log('Planning...');
    const scenarios = await this.planner.plan();
    this.scenarios = scenarios;
    return scenarios;
  }

  setUserResolve(userResolveFn: UserResolveFunction): void {
    this.userResolveFn = userResolveFn;
  }

  async compactPreviousExperiences(): Promise<void> {
    tag('debug').log('Compacting previous experiences...');
    const experienceCompactor = new ExperienceCompactor(this.getAIProvider());
    const experienceTracker = this.getStateManager().getExperienceTracker();
    const experienceFiles = experienceTracker.getAllExperience();
    let compactedCount = 0;
    for (const experience of experienceFiles) {
      const prevContent = experience.content;
      const frontmatter = experience.data;
      const compactedContent = await experienceCompactor.compactExperienceFile(
        experience.filePath
      );
      if (prevContent !== compactedContent) {
        const stateHash =
          experience.filePath.split('/').pop()?.replace('.md', '') || '';
        experienceTracker.writeExperienceFile(
          stateHash,
          compactedContent,
          frontmatter
        );
        tag('debug').log('Experience file compacted:', experience.filePath);
        compactedCount++;
      }
    }
    tag('debug').log(`${compactedCount} previous experiences compacted`);
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
