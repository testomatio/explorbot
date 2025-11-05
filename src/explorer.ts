import path, { join } from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import { createTest } from 'codeceptjs/lib/mocha/test.js';
import Action from './action.js';
import { AIProvider } from './ai/provider.js';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.js';
import type { UserResolveFunction } from './explorbot.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import { StateManager } from './state-manager.js';
import { createDebug, log, tag } from './utils/logger.js';
import { Test } from './test-plan.ts';
import { ActionResult } from './action-result.ts';
import { Reporter, TestomatioReporter } from './reporter.ts';

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
  private options?: { show?: boolean; headless?: boolean; incognito?: boolean };
  private reporter!: Reporter;

  constructor(config: ExplorbotConfig, aiProvider: AIProvider, options?: { show?: boolean; headless?: boolean; incognito?: boolean }) {
    this.config = config;
    this.aiProvider = aiProvider;
    this.options = options;
    this.initializeContainer();
    this.stateManager = new StateManager({ incognito: this.options?.incognito });
    this.knowledgeTracker = new KnowledgeTracker();
    this.reporter = new Reporter();
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

  private convertToCodeceptConfig(config: ExplorbotConfig): any {
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
          highlightElement: true,
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

    codeceptjs.event.dispatcher.emit('global.before');
    this.reporter.startRun();
    tag('success').log('Browser started, ready to explore');

    return I;
  }

  createAction() {
    return new Action(this.actor, this.stateManager);
  }

  async visit(url: string) {
    await this.closeOtherTabs();

    const serializedUrl = JSON.stringify(url);
    const currentState = this.stateManager.getCurrentState();
    const actionResult = currentState ? ActionResult.fromState(currentState) : null;

    const { statePush = false, wait, waitForElement } = this.knowledgeTracker.getStateParameters(actionResult!, ['statePush', 'wait', 'waitForElement']);

    const action = this.createAction();

    if (statePush) {
      await action.execute(`I.executeScript(() => { window.history.pushState({}, '', ${serializedUrl}); window.dispatchEvent(new PopStateEvent('popstate')); })`);
    } else {
      await action.execute(`I.amOnPage(${serializedUrl})`);
    }

    if (wait !== undefined) {
      console.log('Waiting for', wait);
      await action.execute(`I.wait(${wait})`);
    }

    if (waitForElement) {
      await action.execute(`I.waitForElement(${JSON.stringify(waitForElement)})`);
    }

    return action;
  }

  async switchToMainFrame() {
    if (this.playwrightHelper.frame) {
      debugLog('Switching to main frame');
      await this.playwrightHelper.switchTo();
    }
  }

  setUserResolve(userResolveFn: UserResolveFunction): void {
    this.userResolveFn = userResolveFn;
  }

  private listenToStateChanged(): void {
    if (!this.playwrightHelper) {
      debugLog('Playwright helper not available for state monitoring');
      return;
    }

    try {
      const page = this.playwrightHelper.page;
      if (!page) {
        debugLog('Playwright page not available for state monitoring');
        return;
      }
      const initialPage = page;
      const context = this.playwrightHelper.page.context();

      context.on('page', async (newPage: any) => {
        if (newPage === initialPage) {
          return;
        }

        tag('info').log('New browser tab detected. Switching to it');

        await newPage.waitForLoadState();
        await newPage.bringToFront();

        this.playwrightHelper.page = newPage;

        this.stateManager.updateStateFromBasic(await newPage.url(), await newPage.title(), 'navigation');

        debugLog(`Successfully switched to new tab`);
      });

      page.on('framenavigated', async (frame: any) => {
        if (frame !== page.mainFrame()) return;

        const newUrl = await frame.url();
        let newTitle = '';

        try {
          newTitle = await frame.title();
        } catch (error) {
          debugLog('Failed to get page title:', error);
        }

        // // Update state from navigation
        this.stateManager.updateStateFromBasic(newUrl, newTitle, 'navigation');

        await new Promise((resolve) => setTimeout(resolve, 500));
      });

      debugLog('Listening for automatic state changes');
    } catch (error) {
      debugLog('Failed to set up state change monitoring:', error);
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    codeceptjs.event.dispatcher.emit('global.after');
    codeceptjs.event.dispatcher.emit('global.result');
    this.reporter.finishRun();
    await this.playwrightHelper._stopBrowser();
    await codeceptjs.recorder.stop();
  }

  async startTest(test: Test) {
    // await this.reporter.reportTest(test);
    const codeceptjsTest = toCodeceptjsTest(test);
    const stepTracker = (step: any) => {
      if (!step.toCode) {
        return;
      }
      // if (step.name === 'fillField' || step.name === 'appendField') {
      //   this.stateManager.getCurrentState()?.notes.push(`Filled field ${step.locator} with value ${step.value}`);
      // }
      if (step?.name?.startsWith('grab')) return;
      test.addStep(step.toString());
      if (!this.stateManager.getCurrentState()) return;

      const lastScreenshot = ActionResult.fromState(this.stateManager.getCurrentState()!).screenshotFile;
      if (!lastScreenshot) return;

      test.addArtifact(join(ConfigParser.getInstance().getOutputDir(), lastScreenshot));
    };
    codeceptjs.event.dispatcher.emit('test.before', codeceptjsTest);
    codeceptjs.event.dispatcher.emit('test.start', codeceptjsTest);
    codeceptjs.event.dispatcher.on('step.passed', stepTracker);
    codeceptjs.event.dispatcher.on('test.after', () => {
      codeceptjs.event.dispatcher.off('step.passed', stepTracker);
    });
  }

  async stopTest(test: Test) {
    await this.reporter.reportTest(test);
    const codeceptjsTest = toCodeceptjsTest(test);

    if (test.isSuccessful) {
      codeceptjsTest.state = 'passed';
      codeceptjs.event.dispatcher.emit('test.passed', codeceptjsTest);
    } else {
      codeceptjsTest.state = 'failed';
      codeceptjs.event.dispatcher.emit('test.failed', codeceptjsTest);
    }

    codeceptjs.event.dispatcher.emit('test.finish', codeceptjsTest);
    codeceptjs.event.dispatcher.emit('test.after', codeceptjsTest);
  }

  private async closeOtherTabs(): Promise<void> {
    if (!this.playwrightHelper) {
      return;
    }

    const context = this.playwrightHelper.page.context();
    const pages = context.pages();

    if (pages.length <= 1) {
      return;
    }

    debugLog(`Found ${pages.length} tabs, cleaning up to keep only the first one`);

    const firstPage = pages[0];
    const tabsToClose = pages.slice(1);

    for (const page of tabsToClose) {
      await page.close();
      debugLog(`Closed extra tab: ${await page.url()}`);
    }

    await firstPage.bringToFront();

    this.playwrightHelper.page = firstPage;

    debugLog(`Cleaned up tabs, now focused on: ${await firstPage.url()}`);
  }
}

function toCodeceptjsTest(test: Test): any {
  const parent = {
    title: 'Auto-Explorotary Testing',
    fullTitle: () => 'Auto-Explorotary Testing',
  };

  const codeceptjsTest = createTest(test.scenario, () => {});
  codeceptjsTest.parent = parent;
  codeceptjsTest.fullTitle = () => parent.title + ' ' + test.scenario;
  codeceptjsTest.state = 'pending';
  codeceptjsTest.notes = test.getPrintableNotes();
  return codeceptjsTest;
}

export default Explorer;
