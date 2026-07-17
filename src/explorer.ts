import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import stepsListener from 'codeceptjs/lib/listener/steps';
import storeListener from 'codeceptjs/lib/listener/store';
import { createTest } from 'codeceptjs/lib/mocha/test';
import dedent from 'dedent';
import type { BrowserContextOptions, Page } from 'playwright';
import { ActionResult } from './action-result.ts';
import Action from './action.js';
import type { RequestStore } from './api/request-store.ts';
import { XhrCapture } from './api/xhr-capture.ts';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser } from './config.js';
import type { KnowledgeTracker } from './knowledge-tracker.js';
import type { PlaywrightRecorder } from './playwright-recorder.ts';
import type { Reporter } from './reporter.ts';
import type { StateManager } from './state-manager.js';
import { Test, TestResult } from './test-plan.ts';
import { BrowserRecoveryError, browserErrorMessage, isFatalBrowserError, isNavigationTransitionError } from './utils/browser-errors.ts';
import { createDebug, log, tag } from './utils/logger.js';
import { sleep, waitForPageReadiness } from './utils/page-readiness.ts';

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
const RECOVERY_NAVIGATION = { waitUntil: 'domcontentloaded', timeout: 10000 } as const;

class Explorer {
  private config: ExplorbotConfig;
  private options?: ExplorerOptions;
  private stateManager: StateManager;
  private knowledgeTracker: KnowledgeTracker;
  private reporter: Reporter;
  private requestStore: RequestStore;
  private playwrightRecorder: PlaywrightRecorder;
  private playwrightHelper: any;
  private _actor!: CodeceptJS.I;
  private started = false;
  private isSharedBrowser = false;
  private xhrCapture: XhrCapture | null = null;
  private _activeTest: Test | null = null;
  private observedTestPages = new Set<any>();
  private testPageErrorHandler: ((error: Error) => void) | null = null;
  private testConsoleHandler: ((message: any) => void) | null = null;
  private testDialogHandler: ((dialog: any) => void) | null = null;

  constructor(config: ExplorbotConfig, options: ExplorerOptions | undefined, deps: ExplorerDeps) {
    this.config = config;
    this.options = options;
    this.stateManager = deps.stateManager;
    this.knowledgeTracker = deps.knowledgeTracker;
    this.reporter = deps.reporter;
    this.requestStore = deps.requestStore;
    this.playwrightRecorder = deps.playwrightRecorder;
    this.initializeContainer();
  }

  get actor(): CodeceptJS.I {
    return this._actor;
  }

  get page(): Page | null {
    const page = this.playwrightHelper?.page;
    if (!page || page.isClosed?.()) return null;
    return page;
  }

  get activeTest(): Test | null {
    return this._activeTest;
  }

  async start(): Promise<void> {
    if (this.started) return;

    await codeceptjs.recorder.start();
    await codeceptjs.container.started(null);
    storeListener();
    stepsListener();

    codeceptjs.recorder.retry({
      retries: this.config.action?.retries || 3,
      when: (err: any) => !!err?.message?.includes?.('context'),
    });

    this.playwrightHelper = codeceptjs.container.helpers('Playwright');
    if (!this.playwrightHelper) {
      throw new Error('Playwright helper not available');
    }
    await this.connectOrLaunchBrowser();
    const hasSession = this.options?.session && existsSync(this.options.session);
    await this.playwrightHelper._createContextPage(this.createBrowserContextOptions());
    await this.playwrightRecorder.start(this.playwrightHelper.browserContext);
    this.attachXhrCapture();
    if (hasSession) {
      tag('info').log(`Session restored from ${path.relative(process.cwd(), this.options!.session!)}`);
    }

    this._actor = codeceptjs.container.support('I');
    this.started = true;

    this.listenToStateChanged();

    codeceptjs.event.dispatcher.emit('global.before');
    tag('success').log('Browser started, ready to explore');
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    await this.stopCaptures();

    if (this.options?.session && this.playwrightHelper?.browserContext) {
      const dir = path.dirname(this.options.session);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      await this.playwrightHelper.browserContext.storageState({ path: this.options.session });
      debugLog(`Session saved to ${path.relative(process.cwd(), this.options.session)}`);
    }

    codeceptjs.event.dispatcher.emit('global.after');
    codeceptjs.event.dispatcher.emit('global.result');

    if (!this.isSharedBrowser) {
      await Promise.all([this.reporter.finishRun(), this.playwrightHelper._stopBrowser(), codeceptjs.recorder.stop()]);
      return;
    }

    tag('info').log('Closing browser context (persistent browser stays running)');
    await this.closeBrowserContext();
    this.playwrightHelper.browser = null;
    this.playwrightHelper.isRunning = false;
    await Promise.all([this.reporter.finishRun(), codeceptjs.recorder.stop()]);
  }

  action(): Action {
    return new Action(this._actor, this.stateManager, this.playwrightRecorder, (fn) => this.runWithRecovery('action', fn));
  }

  async visit(url: string, opts: CaptureOpts = {}): Promise<ActionResult> {
    return this.runWithRecovery('visit', async () => {
      const action = await this.visitOnce(url);
      if (opts.screenshot) return action.capturePageState({ includeScreenshot: true });
      return action.getActionResult() ?? action.capturePageState();
    });
  }

  async capture(opts: CaptureOpts = {}): Promise<ActionResult> {
    return this.action().capturePageState({ includeScreenshot: opts.screenshot });
  }

  async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    return this.runWithRecovery('page operation', () => fn(this.playwrightHelper.page));
  }

  async exitIframe(): Promise<void> {
    if (!this.playwrightHelper.frame) return;
    debugLog('Switching to main frame');
    await this.playwrightHelper.switchTo();
  }

  async recover(error?: unknown): Promise<Recovery> {
    if (error) return this.recoverFromExecutionError(error);

    if (this.page) {
      this.watchActiveTestPage();
      return { ok: true, action: 'continue', message: 'Page is available' };
    }

    if (!(await this.recoverOrRestart())) {
      return { ok: false, action: 'stop', message: 'Browser page could not be recovered' };
    }
    this.watchActiveTestPage();
    return { ok: true, action: 'continue', recovered: true, message: 'Browser page was recovered' };
  }

  async beginTest(test: Test): Promise<TestRun> {
    this._activeTest = test;
    test.start();
    await this.reporter.reportTestStart(test);
    await this.closeOtherTabs();
    this.stateManager.otherTabs = [];
    if (!this.page && !(await this.recoverOrRestart())) {
      this._activeTest = null;
      return { started: false, stop: async () => {} };
    }

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

    return { started: true, stop: (meta) => this.finishTest(test, meta) };
  }

  async openFreshTab(): Promise<void> {
    const oldPage = this.playwrightHelper?.page;
    if (!oldPage) return;

    await this.activateNewPage(oldPage.context());
    await oldPage.close();
    this.stateManager.otherTabs = [];

    debugLog('Opened fresh tab, closed previous tab');
  }

  private initializeContainer() {
    const configParser = ConfigParser.getInstance();
    const projectRoot = configParser.getProjectRoot();
    (global as any).output_dir = path.join(projectRoot, 'output', 'states');
    (global as any).codecept_dir = projectRoot;

    configParser.validateConfig(this.config);

    codeceptjs.container.create(this.convertToCodeceptConfig(this.config), {});
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

  private attachXhrCapture(): void {
    this.xhrCapture = new XhrCapture(this.requestStore, this.config.playwright.url);
    this.xhrCapture.attach(this.playwrightHelper.page);
  }

  private async runWithRecovery<T>(label: string, operation: () => Promise<T>): Promise<T> {
    if (!this.page && !(await this.recoverOrRestart())) {
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
          if (!isNavigationTransitionError(retryError) && !isFatalBrowserError(retryError)) throw retryError;
          recoveryError = retryError;
        }
      }

      if (!isFatalBrowserError(recoveryError)) throw recoveryError;

      tag('warning').log(`${label}: browser page is unavailable, recovering...`);
      if (!(await this.recoverOrRestart())) throw new BrowserRecoveryError(label, recoveryError, false);
      if (!(await this.waitForPageReadiness())) throw new BrowserRecoveryError(label, recoveryError, true);

      try {
        return await operation();
      } catch (retryError) {
        if (isFatalBrowserError(retryError)) {
          throw new BrowserRecoveryError(label, retryError, true);
        }
        throw retryError;
      }
    }
  }

  private async visitOnce(url: string): Promise<Action> {
    await this.closeOtherTabs();

    const serializedUrl = JSON.stringify(url);
    const currentState = this.stateManager.getCurrentState();
    const actionResult = currentState ? ActionResult.fromState(currentState) : new ActionResult({ url });

    const { statePush = false, wait, waitForElement, code } = this.knowledgeTracker.getStateParameters(actionResult, ['statePush', 'wait', 'waitForElement', 'code']);

    const action = new Action(this._actor, this.stateManager, this.playwrightRecorder);

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

  private async recoverFromExecutionError(error: unknown): Promise<Recovery> {
    const message = browserErrorMessage(error);
    tag('error').log(`Browser execution error: ${message}`);

    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, action: 'stop', message };
    }

    if (error instanceof BrowserRecoveryError) {
      return { ok: false, action: 'stop', recovered: error.recovered, message: error.message };
    }

    if (!isFatalBrowserError(error)) {
      return {
        ok: true,
        action: 'continue',
        message: `Previous execution error: ${message}. Investigate the current state and choose a different approach.`,
      };
    }

    if (!(await this.recoverOrRestart())) {
      return { ok: false, action: 'stop', recovered: false, message: `Browser could not be recovered after fatal error: ${message}` };
    }

    this.watchActiveTestPage();
    return {
      ok: true,
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

  private async recoverOrRestart(): Promise<boolean> {
    if (await this.recoverPage()) return true;
    return this.restartBrowser();
  }

  private async recoverPage(): Promise<boolean> {
    try {
      if (!this.page) {
        const context = this.playwrightHelper?.browserContext;
        if (!context) return false;
        await this.activateNewPage(context);
      }

      const url = this.resolveBrowserUrl(this.stateManager.getCurrentState()?.url);
      if (url) {
        tag('warning').log(`Browser error detected, recovering by navigating to ${url}`);
        await this.playwrightHelper.page.goto(url, RECOVERY_NAVIGATION);
        return this.waitForPageReadiness();
      }
      tag('warning').log('Browser error detected, reloading page');
      await this.playwrightHelper.page.reload(RECOVERY_NAVIGATION);
      return this.waitForPageReadiness();
    } catch (err) {
      tag('error').log(`Browser recovery failed: ${browserErrorMessage(err)}`);
      return false;
    }
  }

  private async activateNewPage(context: any): Promise<void> {
    const page = await context.newPage();
    await page.bringToFront();
    await this.playwrightHelper._setPage(page);
    this.bindFrameNavigated(page);
    this.xhrCapture?.attach(page);
  }

  private async stopCaptures(): Promise<void> {
    if (this.xhrCapture && this.playwrightHelper?.page) {
      this.xhrCapture.detach(this.playwrightHelper.page);
    }
    await this.playwrightRecorder.stop();
  }

  private async closeBrowserContext(): Promise<void> {
    if (!this.playwrightHelper.browserContext) return;
    await this.playwrightHelper.browserContext.close().catch((err: unknown) => {
      debugLog('Failed to close browser context:', err);
    });
    this.playwrightHelper.browserContext = null;
  }

  private async restartBrowser(): Promise<boolean> {
    if (!this.playwrightHelper) return false;

    const url = this.resolveBrowserUrl(this.stateManager.getCurrentState()?.url);

    try {
      await this.stopCaptures();
      await this.closeBrowserContext();

      if (!this.isSharedBrowser) {
        await this.playwrightHelper._stopBrowser().catch((err: unknown) => {
          debugLog('Failed to stop browser before restart:', err);
        });
      }

      await this.connectOrLaunchBrowser();
      await this.playwrightHelper._createContextPage(this.createBrowserContextOptions());
      await this.playwrightRecorder.start(this.playwrightHelper.browserContext);
      this.attachXhrCapture();
      this.listenToStateChanged();

      if (url) {
        await this.playwrightHelper.page.goto(url, RECOVERY_NAVIGATION);
        if (!(await this.waitForPageReadiness())) return false;
      }

      tag('success').log('Browser restarted');
      return true;
    } catch (err) {
      tag('error').log(`Browser restart failed: ${browserErrorMessage(err)}`);
      return false;
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

  private async waitForPageReadiness(): Promise<boolean> {
    const page = this.playwrightHelper?.page;
    if (!page) return false;

    await waitForPageReadiness(page, {
      timeout: this.config.playwright.waitForTimeout,
      spinnerSelectors: this.config.playwright.spinnerSelectors,
    });
    return true;
  }

  private listenToStateChanged(): void {
    const page = this.playwrightHelper?.page;
    if (!page) {
      debugLog('Playwright page not available for state monitoring');
      return;
    }
    const initialPage = page;
    const context = page.context();

    context.on('page', async (newPage: any) => {
      if (newPage === initialPage) return;

      try {
        if (newPage.url() === 'about:blank') {
          await newPage.waitForURL(/^(?!about:blank$)/, { timeout: 5000 }).catch(() => {});
        }
        await newPage.waitForLoadState('domcontentloaded', { timeout: 5000 });
        const url = await newPage.url();
        const title = await newPage.title().catch(() => 'Unknown');

        this.stateManager.otherTabs.push({ url, title });
        if (url !== 'about:blank') {
          tag('info').log(`New browser tab opened: ${url}`);
        }
        debugLog(`New tab detected: ${url} - ${title}`);
      } catch (error) {
        debugLog('Failed to get new tab info:', error);
        this.stateManager.otherTabs.push({ url: 'unknown', title: 'unknown' });
      }
    });

    this.bindFrameNavigated(page);

    debugLog('Listening for automatic state changes');
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

  private async closeOtherTabs(): Promise<void> {
    if (!this.playwrightHelper) return;

    const context = this.playwrightHelper.page.context();
    const pages = context.pages();

    if (pages.length <= 1) return;

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

  private async finishTest(test: Test, meta?: Record<string, string>): Promise<void> {
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

  private watchActiveTestPage(page = this.playwrightHelper?.page): void {
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

  private unwatchActiveTestPages(): void {
    for (const page of this.observedTestPages) {
      if (this.testPageErrorHandler) page.off('pageerror', this.testPageErrorHandler);
      if (this.testConsoleHandler) page.off('console', this.testConsoleHandler);
      if (this.testDialogHandler) page.off('dialog', this.testDialogHandler);
    }
    this.observedTestPages.clear();
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

export interface ExplorerOptions {
  show?: boolean;
  headless?: boolean;
  incognito?: boolean;
  session?: string;
}

export interface ExplorerDeps {
  stateManager: StateManager;
  knowledgeTracker: KnowledgeTracker;
  reporter: Reporter;
  requestStore: RequestStore;
  playwrightRecorder: PlaywrightRecorder;
}

export interface Recovery {
  ok: boolean;
  action: 'continue' | 'stop';
  message: string;
  recovered?: boolean;
}

export interface TestRun {
  started: boolean;
  stop(meta?: Record<string, string>): Promise<void>;
}

export interface CaptureOpts {
  screenshot?: boolean;
}

export default Explorer;
