import { existsSync, mkdirSync } from 'node:fs';
import path, { join } from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import stepsListener from 'codeceptjs/lib/listener/steps';
import storeListener from 'codeceptjs/lib/listener/store';
import { createTest } from 'codeceptjs/lib/mocha/test';
import dedent from 'dedent';
import type { BrowserContextOptions } from 'playwright';
import { ActionResult } from './action-result.ts';
import Action from './action.js';
import { AIProvider } from './ai/provider.js';
import { visuallyAnnotateContainers } from './ai/researcher/coordinates.ts';
import { RequestStore } from './api/request-store.ts';
import { XhrCapture } from './api/xhr-capture.ts';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.js';
import type { ExperienceTracker } from './experience-tracker.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import { PlaywrightRecorder } from './playwright-recorder.ts';
import { Reporter } from './reporter.ts';
import { StateManager } from './state-manager.js';
import { Test, TestResult } from './test-plan.ts';
import { BrowserRecoveryError, browserErrorMessage, isFatalBrowserError, isNavigationTransitionError } from './utils/browser-errors.ts';
import { ELEMENT_EXTRACTION_CONFIG, getElementDataExtractorSource } from './utils/html.ts';
import { createDebug, log, tag } from './utils/logger.js';
import { sleep, waitForPageReadiness } from './utils/page-readiness.ts';
import { WebElement } from './utils/web-element.ts';

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
const RECOVERABLE_NAVIGATION_ERRORS = /net::ERR_ABORTED|page\.screenshot.*Timeout|waiting for fonts to load/i;

interface TabInfo {
  url: string;
  title: string;
}

interface BrowserExecutionErrorResult {
  action: 'continue' | 'stop';
  message: string;
  recovered?: boolean;
}

class Explorer {
  private aiProvider: AIProvider;
  playwrightHelper: any;
  public isStarted = false;
  private isSharedBrowser = false;
  actor!: CodeceptJS.I;
  private stateManager!: StateManager;
  private knowledgeTracker!: KnowledgeTracker;
  config: ExplorbotConfig;
  private options?: { show?: boolean; headless?: boolean; incognito?: boolean; session?: string };
  private reporter!: Reporter;
  private otherTabs: TabInfo[] = [];
  private _activeTest: Test | null = null;
  private xhrCapture: XhrCapture | null = null;
  private requestStore: RequestStore | null = null;
  private playwrightRecorder: PlaywrightRecorder = new PlaywrightRecorder();
  private observedTestPages = new Set<any>();
  private testPageErrorHandler: ((error: Error) => void) | null = null;
  private testConsoleHandler: ((message: any) => void) | null = null;
  private testDialogHandler: ((dialog: any) => void) | null = null;

  constructor(config: ExplorbotConfig, aiProvider: AIProvider, options: { show?: boolean; headless?: boolean; incognito?: boolean; session?: string } | undefined, experienceTracker: ExperienceTracker, knowledgeTracker: KnowledgeTracker) {
    this.config = config;
    this.aiProvider = aiProvider;
    this.options = options;
    this.initializeContainer();
    this.knowledgeTracker = knowledgeTracker;
    this.stateManager = new StateManager(experienceTracker, knowledgeTracker);
    this.reporter = new Reporter(config.reporter, this.stateManager);
  }

  private initializeContainer() {
    try {
      // Use project root for output directory, not current working directory
      const configParser = ConfigParser.getInstance();
      const projectRoot = configParser.getProjectRoot();
      (global as any).output_dir = path.join(projectRoot, 'output', 'states');
      (global as any).codecept_dir = projectRoot;

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
    const PlaywrightConfig = {
      timeout: 3000,
      highlightElement: true,
      waitForAction: 500,
      ...playwrightConfig,
      strict: true,
      fullPageScreenshots: true,
    };
    tag('debug').log(JSON.stringify(PlaywrightConfig, null, 2));

    const codeceptConfig: any = {
      helpers: {
        Playwright: PlaywrightConfig,
      },
    };

    if (this.config.stepsFile) {
      const projectRoot = ConfigParser.getInstance().getProjectRoot();
      codeceptConfig.include = { I: path.resolve(projectRoot, this.config.stepsFile) };
    }

    return codeceptConfig;
  }

  public getConfig(): ExplorbotConfig {
    return this.config;
  }

  public getAIProvider(): AIProvider {
    return this.aiProvider;
  }

  public getStateManager(): StateManager {
    return this.stateManager;
  }

  public getKnowledgeTracker(): KnowledgeTracker {
    return this.knowledgeTracker;
  }

  public getReporter(): Reporter {
    return this.reporter;
  }

  public getRequestStore(): RequestStore | null {
    return this.requestStore;
  }

  async extractCookies(): Promise<Record<string, string>> {
    if (!this.playwrightHelper?.browserContext) return {};
    try {
      const cookies = await this.playwrightHelper.browserContext.cookies();
      if (!cookies.length) return {};
      const cookieString = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
      return { Cookie: cookieString };
    } catch {
      return {};
    }
  }

  private setupXhrCapture(reuseRequestStore = false): void {
    const configParser = ConfigParser.getInstance();
    const outputDir = configParser.getOutputDir();
    if (!reuseRequestStore || !this.requestStore) {
      this.requestStore = new RequestStore(outputDir);
    }
    const baseUrl = this.config.playwright.url;
    this.xhrCapture = new XhrCapture(this.requestStore!, baseUrl);
    this.xhrCapture.attach(this.playwrightHelper.page);
  }

  async start() {
    if (this.isStarted) {
      return;
    }

    await codeceptjs.recorder.start();
    await codeceptjs.container.started(null);
    storeListener();
    stepsListener();

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
    await this.connectOrLaunchBrowser();
    const hasSession = this.options?.session && existsSync(this.options.session);
    await this.playwrightHelper._createContextPage(this.createBrowserContextOptions());
    await this.playwrightRecorder.start(this.playwrightHelper.browserContext);
    this.setupXhrCapture();
    if (hasSession) {
      tag('info').log(`Session restored from ${path.relative(process.cwd(), this.options!.session!)}`);
    }
    const I = codeceptjs.container.support('I');

    this.actor = I;
    this.isStarted = true;

    this.listenToStateChanged();

    codeceptjs.event.dispatcher.emit('global.before');
    tag('success').log('Browser started, ready to explore');

    return I;
  }

  private async connectOrLaunchBrowser(): Promise<void> {
    const { getAliveEndpoint } = await import('./browser-server.js');
    const endpoint = await getAliveEndpoint();

    if (endpoint) {
      const browserName = this.config.playwright.browser || 'chromium';
      this.playwrightHelper.options[browserName] ||= {};
      this.playwrightHelper.options[browserName].browserWSEndpoint = endpoint;
      this.playwrightHelper._setConfig(this.playwrightHelper.options);
      await this.playwrightHelper._startBrowser();
      this.isSharedBrowser = true;
      tag('success').log('Connected to persistent browser server');
      return;
    }

    await this.playwrightHelper._startBrowser();
  }

  private createBrowserContextOptions(): BrowserContextOptions {
    const helperOptions = this.playwrightHelper.options || {};
    const contextOptions: BrowserContextOptions = {
      ...helperOptions,
    };

    if (helperOptions.emulate) Object.assign(contextOptions, helperOptions.emulate);
    if (helperOptions.basicAuth) contextOptions.httpCredentials = helperOptions.basicAuth;
    if (this.options?.session && existsSync(this.options.session)) contextOptions.storageState = this.options.session;

    return contextOptions;
  }

  createAction() {
    return new Action(this.actor, this.stateManager, this.playwrightRecorder);
  }

  async runWithBrowserRecovery<T>(label: string, operation: () => Promise<T>): Promise<T> {
    if (!(await this.ensurePageAvailable())) {
      throw new Error(`Browser page is unavailable before ${label}`);
    }

    try {
      return await operation();
    } catch (error) {
      let recoveryError = error;

      if (isNavigationTransitionError(error)) {
        tag('warning').log(`${label}: page is still navigating, waiting before retry...`);
        await this.waitForPageReadiness();
        try {
          return await operation();
        } catch (retryError) {
          if (!isNavigationTransitionError(retryError) && !this.isFatalBrowserError(retryError)) throw retryError;
          recoveryError = retryError;
        }
      }

      if (!this.isFatalBrowserError(recoveryError)) throw recoveryError;

      tag('warning').log(`${label}: browser page is unavailable, recovering...`);
      let recovered = await this.recoverFromBrowserError();
      if (!recovered) recovered = await this.restartBrowser();
      if (!recovered) throw new BrowserRecoveryError(label, recoveryError, false);
      if (!(await this.waitForPageReadiness())) throw new BrowserRecoveryError(label, recoveryError, true);

      try {
        return await operation();
      } catch (retryError) {
        if (this.isFatalBrowserError(retryError)) {
          throw new BrowserRecoveryError(label, retryError, true);
        }
        throw retryError;
      }
    }
  }

  async capturePageState(opts: { includeScreenshot?: boolean } = {}): Promise<ActionResult> {
    return this.runWithBrowserRecovery('capturePageState', () => this.createAction().capturePageState(opts));
  }

  async capturePageWithScreenshot(): Promise<ActionResult> {
    return this.capturePageState({ includeScreenshot: true });
  }

  async executeAction(code: string): Promise<Action> {
    return this.runWithBrowserRecovery('executeAction', () => this.createAction().execute(code));
  }

  async attemptAction(code: string, originalMessage?: string): Promise<boolean> {
    return this.runWithBrowserRecovery('attemptAction', () => this.createAction().attempt(code, originalMessage));
  }

  getPlaywrightRecorder(): PlaywrightRecorder {
    return this.playwrightRecorder;
  }

  async visit(url: string) {
    return this.runWithBrowserRecovery('visit', () => this.visitOnce(url));
  }

  private async visitOnce(url: string) {
    await this.closeOtherTabs();

    const serializedUrl = JSON.stringify(url);
    const currentState = this.stateManager.getCurrentState();
    const actionResult = currentState ? ActionResult.fromState(currentState) : new ActionResult({ url });

    const { statePush = false, wait, waitForElement, code } = this.knowledgeTracker.getStateParameters(actionResult, ['statePush', 'wait', 'waitForElement', 'code']);

    const action = this.createAction();

    if (statePush) {
      await action.execute(`I.executeScript(() => { window.history.pushState({}, '', ${serializedUrl}); window.dispatchEvent(new PopStateEvent('popstate')); })`);
    } else {
      try {
        await action.execute(`I.amOnPage(${serializedUrl})`);
      } catch (err) {
        const msg = browserErrorMessage(err);
        if (!RECOVERABLE_NAVIGATION_ERRORS.test(msg)) throw err;
        tag('warning').log(`Navigation warning (continuing after load): ${msg.split('\n')[0]}`);
        await this.waitForPageReadiness();
        await action.capturePageState();
      }
    }

    if (wait !== undefined) {
      debugLog('Waiting for', wait);
      await action.execute(`I.wait(${wait})`);
    }

    if (waitForElement) {
      await action.execute(`I.waitForElement(${JSON.stringify(waitForElement)})`);
    }

    if (code) {
      debugLog('Executing knowledge code:', code);
      await action.execute(code);
    }

    return action;
  }

  async annotateElements(): Promise<WebElement[]> {
    return this.runWithBrowserRecovery('annotateElements', async () => {
      const { elements } = await annotatePageElements(this.playwrightHelper.page);
      return elements;
    });
  }

  async visuallyAnnotateElements(opts?: { containers?: Array<{ css: string; label: string }> }): Promise<number> {
    return this.runWithBrowserRecovery('visuallyAnnotateElements', () => visuallyAnnotateContainers(this.playwrightHelper.page, opts?.containers || []));
  }

  async getEidxInContainer(containerCss: string | null): Promise<string[]> {
    const page = this.playwrightHelper.page;
    try {
      const selector = containerCss ? `${containerCss} [${ELEMENT_EXTRACTION_CONFIG.attrs.eidx}]` : `[${ELEMENT_EXTRACTION_CONFIG.attrs.eidx}]`;
      const elements = await page.locator(selector).all();
      const result: string[] = [];
      for (const el of elements) {
        const attr = await el.getAttribute(ELEMENT_EXTRACTION_CONFIG.attrs.eidx);
        if (attr) result.push(attr);
      }
      return result;
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`getEidxInContainer: ${browserErrorMessage(error)}`);
        await this.recoverFromBrowserError();
      }
      return [];
    }
  }

  async getEidxByLocator(locator: string, container?: string | null): Promise<string | null> {
    try {
      const page = this.playwrightHelper.page;
      const base = container ? page.locator(container) : page;
      const el = locator.startsWith('//') ? base.locator(`xpath=${locator}`) : base.locator(locator);
      return await el.first().getAttribute(ELEMENT_EXTRACTION_CONFIG.attrs.eidx);
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`getEidxByLocator: ${browserErrorMessage(error)}`);
        await this.recoverFromBrowserError();
      }
      return null;
    }
  }

  private resolveBrowserUrl(url?: string): string | null {
    if (!url) return null;
    try {
      return new URL(url).toString();
    } catch {}

    const baseUrl = this.config.playwright?.url || this.config.web?.url;
    if (!baseUrl) return null;

    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return null;
    }
  }

  isFatalBrowserError(error: unknown): boolean {
    return isFatalBrowserError(error);
  }

  async recoverFromBrowserError(): Promise<boolean> {
    try {
      if (!this.playwrightHelper?.page || this.playwrightHelper.page.isClosed?.()) {
        const context = this.playwrightHelper?.browserContext;
        if (!context) return await this.restartBrowser();
        const page = await context.newPage();
        await page.bringToFront();
        await this.playwrightHelper._setPage(page);
        this.bindFrameNavigated(page);
        if (this.xhrCapture) {
          this.xhrCapture.attach(this.playwrightHelper.page);
        }
      }

      const url = this.resolveBrowserUrl(this.stateManager.getCurrentState()?.url);
      if (url) {
        tag('warning').log(`Browser error detected, recovering by navigating to ${url}`);
        await this.playwrightHelper.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        return this.waitForPageReadiness();
      }
      tag('warning').log('Browser error detected, reloading page');
      await this.playwrightHelper.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      return this.waitForPageReadiness();
    } catch (err) {
      tag('error').log(`Browser recovery failed: ${browserErrorMessage(err)}`);
      return false;
    }
  }

  async restartBrowser(): Promise<boolean> {
    if (!this.playwrightHelper) return false;

    const url = this.resolveBrowserUrl(this.stateManager.getCurrentState()?.url);

    try {
      if (this.xhrCapture && this.playwrightHelper.page) {
        this.xhrCapture.detach(this.playwrightHelper.page);
      }

      await this.playwrightRecorder.stop();

      if (this.playwrightHelper.browserContext) {
        await this.playwrightHelper.browserContext.close().catch((err: unknown) => {
          debugLog('Failed to close browser context before restart:', err);
        });
        this.playwrightHelper.browserContext = null;
      }

      if (!this.isSharedBrowser) {
        await this.playwrightHelper._stopBrowser().catch((err: unknown) => {
          debugLog('Failed to stop browser before restart:', err);
        });
      }

      await this.connectOrLaunchBrowser();
      await this.playwrightHelper._createContextPage(this.createBrowserContextOptions());
      await this.playwrightRecorder.start(this.playwrightHelper.browserContext);
      this.setupXhrCapture(true);
      this.listenToStateChanged();

      if (url) {
        await this.playwrightHelper.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        if (!(await this.waitForPageReadiness())) return false;
      }

      tag('success').log('Browser restarted');
      return true;
    } catch (err) {
      tag('error').log(`Browser restart failed: ${browserErrorMessage(err)}`);
      return false;
    }
  }

  async switchToMainFrame() {
    if (this.playwrightHelper.frame) {
      debugLog('Switching to main frame');
      await this.playwrightHelper.switchTo();
    }
  }

  private async waitForPageReadiness(): Promise<boolean> {
    const page = this.playwrightHelper?.page;
    if (!page) return false;

    await waitForPageReadiness(page, {
      timeout: this.config.playwright.waitForTimeout,
      spinnerSelectors: this.config.playwright.spinnerSelectors,
    });
    return true;
  }

  async isInsideIframe(): Promise<boolean> {
    if (this.playwrightHelper.frame) return true;

    try {
      const page = this.playwrightHelper.page;
      if (!page) return false;
      return await page.evaluate(() => window.top !== window.self);
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`isInsideIframe: ${browserErrorMessage(error)}`);
        await this.recoverFromBrowserError();
      }
      return false;
    }
  }

  getCurrentIframeInfo(): string | null {
    if (!this.playwrightHelper?.frame) return null;
    return 'iframe context active';
  }

  hasOtherTabs(): boolean {
    return this.otherTabs.length > 0;
  }

  getOtherTabsInfo(): TabInfo[] {
    return [...this.otherTabs];
  }

  clearOtherTabsInfo(): void {
    this.otherTabs = [];
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

        try {
          if (newPage.url() === 'about:blank') {
            await newPage.waitForURL(/^(?!about:blank$)/, { timeout: 5000 }).catch(() => {});
          }
          await newPage.waitForLoadState('domcontentloaded', { timeout: 5000 });
          const url = await newPage.url();
          const title = await newPage.title().catch(() => 'Unknown');

          this.otherTabs.push({ url, title });
          if (url !== 'about:blank') {
            tag('info').log(`New browser tab opened: ${url}`);
          }
          debugLog(`New tab detected: ${url} - ${title}`);
        } catch (error) {
          debugLog('Failed to get new tab info:', error);
          this.otherTabs.push({ url: 'unknown', title: 'unknown' });
        }
      });

      this.bindFrameNavigated(page);

      debugLog('Listening for automatic state changes');
    } catch (error) {
      debugLog('Failed to set up state change monitoring:', error);
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    if (this.xhrCapture && this.playwrightHelper?.page) {
      this.xhrCapture.detach(this.playwrightHelper.page);
    }

    await this.playwrightRecorder.stop();

    if (this.options?.session && this.playwrightHelper?.browserContext) {
      const dir = path.dirname(this.options.session);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      await this.playwrightHelper.browserContext.storageState({ path: this.options.session });
      debugLog(`Session saved to ${path.relative(process.cwd(), this.options.session)}`);
    }

    codeceptjs.event.dispatcher.emit('global.after');
    codeceptjs.event.dispatcher.emit('global.result');

    if (this.isSharedBrowser) {
      tag('info').log('Closing browser context (persistent browser stays running)');
      try {
        if (this.playwrightHelper.browserContext) {
          await this.playwrightHelper.browserContext.close();
          this.playwrightHelper.browserContext = null;
        }
      } catch (err) {
        debugLog('Failed to close browser context:', err);
      }
      this.playwrightHelper.browser = null;
      this.playwrightHelper.isRunning = false;
      await Promise.all([this.reporter.finishRun(), codeceptjs.recorder.stop()]);
    } else {
      await Promise.all([this.reporter.finishRun(), this.playwrightHelper._stopBrowser(), codeceptjs.recorder.stop()]);
    }
  }

  get activeTest(): Test | null {
    return this._activeTest;
  }

  async startTest(test: Test): Promise<boolean> {
    this._activeTest = test;
    test.start();
    await this.reporter.reportTestStart(test);
    await this.closeOtherTabs();
    this.otherTabs = [];
    if (!(await this.ensurePageAvailable())) return false;

    const codeceptjsTest = toCodeceptjsTest(test);

    const stepHandler = (step: any, status?: string, error?: string, log?: string) => {
      if (!step.toCode) return;
      if (step?.name?.startsWith('grab')) return;
      if (step?.name?.startsWith('save')) return;

      test.addStep(step.toCode(), step.duration, status, error, log);

      if (!this.stateManager.getCurrentState()) return;

      const lastScreenshot = ActionResult.fromState(this.stateManager.getCurrentState()!).screenshotFile;
      test.setActiveNoteScreenshot(lastScreenshot);
    };

    this.watchActiveTestPage();

    const onStepPassed = (step: any) => stepHandler(step, 'passed');
    const onStepFailed = (step: any, error: any) => {
      stepHandler(step, 'failed', error?.message || String(error), error?.stack);
    };
    const onTestAfter = () => {
      codeceptjs.event.dispatcher.off('step.passed', onStepPassed);
      codeceptjs.event.dispatcher.off('step.failed', onStepFailed);
      codeceptjs.event.dispatcher.off('test.after', onTestAfter);
      this.unwatchActiveTestPages();
    };

    codeceptjs.event.dispatcher.emit('test.before', codeceptjsTest);
    codeceptjs.event.dispatcher.emit('test.start', codeceptjsTest);
    codeceptjs.event.dispatcher.on('step.passed', onStepPassed);
    codeceptjs.event.dispatcher.on('step.failed', onStepFailed);
    codeceptjs.event.dispatcher.on('test.after', onTestAfter);

    return true;
  }

  async ensurePageAvailable(): Promise<boolean> {
    const page = this.playwrightHelper?.page;
    if (page && !page.isClosed?.()) {
      this.watchActiveTestPage(page);
      return true;
    }

    const recovered = await this.recoverFromBrowserError();
    if (!recovered) return false;
    this.watchActiveTestPage();
    return true;
  }

  async handleExecutionError(error: unknown): Promise<BrowserExecutionErrorResult> {
    const message = browserErrorMessage(error);
    tag('error').log(`Browser execution error: ${message}`);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        action: 'stop',
        message,
      };
    }

    if (error instanceof BrowserRecoveryError) {
      return {
        action: 'stop',
        recovered: error.recovered,
        message: error.message,
      };
    }

    if (!this.isFatalBrowserError(error)) {
      return {
        action: 'continue',
        message: `Previous execution error: ${message}. Investigate the current state and choose a different approach.`,
      };
    }

    let recovered = await this.recoverFromBrowserError();
    if (!recovered) recovered = await this.restartBrowser();

    if (!recovered) {
      return {
        action: 'stop',
        recovered: false,
        message: `Browser could not be recovered after fatal error: ${message}`,
      };
    }

    this.watchActiveTestPage();
    return {
      action: 'continue',
      recovered: true,
      message: dedent`
        Browser was recovered after a fatal page error.
        Continue from the restored page.
        The interrupted browser action is not product evidence.
        Inspect the restored page and retry the current step when it is still required.
      `,
    };
  }

  watchActiveTestPage(page = this.playwrightHelper?.page): void {
    if (!this._activeTest) return;
    if (!page) return;
    if (this.observedTestPages.has(page)) return;

    this.testPageErrorHandler ||= (err: Error) => {
      this._activeTest?.addNote(`Console error: ${err.message}`, TestResult.FAILED);
    };
    this.testConsoleHandler ||= (msg: any) => {
      if (msg.type() !== 'error') return;
      this._activeTest?.addNote(`Console error: ${msg.text()}`, TestResult.FAILED);
    };
    this.testDialogHandler ||= (dialog: any) => {
      const dialogType = dialog.type();
      const dialogMessage = dialog.message();
      this._activeTest?.addNote(`Native dialog ${dialogType} appeared: ${dialogMessage}. Accepted automatically`);
    };

    page.on('pageerror', this.testPageErrorHandler);
    page.on('console', this.testConsoleHandler);
    page.on('dialog', this.testDialogHandler);
    this.observedTestPages.add(page);
  }

  async stopTest(test: Test, meta?: Record<string, string>) {
    this.unwatchActiveTestPages();
    this._activeTest = null;
    const lastScreenshot = this.stateManager.getCurrentState()?.screenshotFile;
    if (lastScreenshot) {
      meta ||= {};
      meta.screenshotFile = lastScreenshot;
    }
    await this.reporter.reportTest(test, meta);
    const codeceptjsTest = toCodeceptjsTest(test);

    if (test.isSuccessful) {
      codeceptjsTest.state = 'passed';
      codeceptjs.event.dispatcher.emit('test.passed', codeceptjsTest);
    } else if (test.isSkipped) {
      codeceptjsTest.state = 'skipped';
      codeceptjs.event.dispatcher.emit('test.skipped', codeceptjsTest);
    } else {
      codeceptjsTest.state = 'failed';
      codeceptjs.event.dispatcher.emit('test.failed', codeceptjsTest);
    }

    codeceptjs.event.dispatcher.emit('test.finish', codeceptjsTest);
    codeceptjs.event.dispatcher.emit('test.after', codeceptjsTest);
  }

  private unwatchActiveTestPages(): void {
    for (const page of this.observedTestPages) {
      if (this.testPageErrorHandler) page.off('pageerror', this.testPageErrorHandler);
      if (this.testConsoleHandler) page.off('console', this.testConsoleHandler);
      if (this.testDialogHandler) page.off('dialog', this.testDialogHandler);
    }
    this.observedTestPages.clear();
  }

  async playwrightLocatorCount(locatorFn: (page: any) => any): Promise<number> {
    try {
      const pwLocator = locatorFn(this.playwrightHelper.page);
      return await pwLocator.count();
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`playwrightLocatorCount: ${browserErrorMessage(error)}`);
        await this.recoverFromBrowserError();
      }
      throw error;
    }
  }

  private bindFrameNavigated(page: any): void {
    page.on('framenavigated', async (frame: any) => {
      if (frame !== page.mainFrame()) return;

      const newUrl = await frame.url();
      let newTitle = '';

      try {
        newTitle = await frame.title();
      } catch (error) {
        debugLog('Failed to get page title:', error);
      }

      this.stateManager.updateStateFromBasic(newUrl, newTitle, 'navigation');

      await sleep(500);
    });
  }

  async openFreshTab(): Promise<void> {
    if (!this.playwrightHelper?.page) return;

    const oldPage = this.playwrightHelper.page;
    const context = oldPage.context();
    const newPage = await context.newPage();

    await oldPage.close();
    await newPage.bringToFront();

    await this.playwrightHelper._setPage(newPage);
    this.otherTabs = [];

    this.bindFrameNavigated(newPage);
    if (this.xhrCapture) {
      this.xhrCapture.attach(newPage);
    }

    debugLog('Opened fresh tab, closed previous tab');
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
    await this.playwrightHelper._setPage(firstPage);

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
  codeceptjsTest.fullTitle = () => `${parent.title} ${test.scenario}`;
  codeceptjsTest.state = 'pending';
  codeceptjsTest.notes = test.getPrintableNotes();
  codeceptjsTest._explorbotTest = test;
  return codeceptjsTest;
}

const REF_LINE_PATTERN = /^(\s*)-\s+(\w+)\s*(?:"([^"]*)")?.*?\[ref=(e\d+)\]/;

const ANNOTATABLE_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'combobox', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'treeitem']);

function parseAriaRefs(ariaSnapshot: string): Array<{ role: string; name: string; ref: string }> {
  const entries: Array<{ role: string; name: string; ref: string }> = [];
  for (const line of ariaSnapshot.split('\n')) {
    const match = line.match(REF_LINE_PATTERN);
    if (!match) continue;
    if (!ANNOTATABLE_ROLES.has(match[2])) continue;
    entries.push({ role: match[2], name: match[3] || '', ref: match[4] });
  }
  return entries;
}

export async function annotatePageElements(page: any): Promise<{ ariaSnapshot: string; elements: WebElement[] }> {
  const ariaSnapshot: string = await page.locator('body').ariaSnapshot({ mode: 'ai' });
  const refEntries = parseAriaRefs(ariaSnapshot);

  const byRole = new Map<string, Array<{ name: string; ref: string }>>();
  for (const { role, name, ref } of refEntries) {
    let list = byRole.get(role);
    if (!list) {
      list = [];
      byRole.set(role, list);
    }
    list.push({ name, ref });
  }

  const elements: WebElement[] = [];
  for (const [role, entries] of byRole) {
    try {
      const rawList = await page.getByRole(role).evaluateAll(
        (domElements: Element[], [data, extractFnStr, config]: [Array<{ name: string; ref: string }>, string, typeof ELEMENT_EXTRACTION_CONFIG]) => {
          const extract = new Function(`return ${extractFnStr}`)() as (el: Element) => any;
          const results: any[] = [];
          let ariaIdx = 0;
          for (const el of domElements) {
            if (ariaIdx >= data.length) break;
            el.setAttribute(config.attrs.eidx, data[ariaIdx].ref);
            const elData = extract(el, config);
            if (elData) results.push(elData);
            ariaIdx++;
          }
          return results;
        },
        [entries, getElementDataExtractorSource(), ELEMENT_EXTRACTION_CONFIG]
      );
      for (const raw of rawList) {
        elements.push(WebElement.fromRawData(raw, role));
      }
    } catch {
      debugLog(`Failed to annotate role=${role}`);
    }
  }

  return { ariaSnapshot, elements };
}

export default Explorer;
