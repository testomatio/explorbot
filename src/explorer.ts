import { existsSync, mkdirSync } from 'node:fs';
import path, { join } from 'node:path';
// @ts-ignore
import * as codeceptjs from 'codeceptjs';
import stepsListener from 'codeceptjs/lib/listener/steps';
import storeListener from 'codeceptjs/lib/listener/store';
import { createTest } from 'codeceptjs/lib/mocha/test';
import { ActionResult } from './action-result.ts';
import Action from './action.js';
import { AIProvider } from './ai/provider.js';
import { visuallyAnnotateContainers } from './ai/researcher/coordinates.ts';
import type { ExplorbotConfig } from './config.js';
import { ConfigParser, outputPath } from './config.js';
import type { UserResolveFunction } from './explorbot.js';
import { KnowledgeTracker } from './knowledge-tracker.js';
import { Reporter } from './reporter.ts';
import { StateManager } from './state-manager.js';
import { Test } from './test-plan.ts';
import { RequestStore } from './api/request-store.ts';
import { XhrCapture } from './api/xhr-capture.ts';
import { createDebug, log, tag } from './utils/logger.js';
import { WebElement, extractElementData } from './utils/web-element.ts';

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
const FATAL_BROWSER_ERRORS = /Frame was detached|Target closed|Execution context was destroyed|Protocol error|Session closed/i;

interface TabInfo {
  url: string;
  title: string;
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
  private userResolveFn: UserResolveFunction | null = null;
  private options?: { show?: boolean; headless?: boolean; incognito?: boolean; session?: string };
  private reporter!: Reporter;
  private otherTabs: TabInfo[] = [];
  private _activeTest: Test | null = null;
  private xhrCapture: XhrCapture | null = null;
  private requestStore: RequestStore | null = null;

  constructor(config: ExplorbotConfig, aiProvider: AIProvider, options?: { show?: boolean; headless?: boolean; incognito?: boolean; session?: string }) {
    this.config = config;
    this.aiProvider = aiProvider;
    this.options = options;
    this.initializeContainer();
    this.stateManager = new StateManager({ incognito: this.options?.incognito });
    this.knowledgeTracker = new KnowledgeTracker();
    this.reporter = new Reporter(config.reporter);
  }

  private initializeContainer() {
    try {
      // Use project root for output directory, not current working directory
      const configParser = ConfigParser.getInstance();
      const configPath = configParser.getConfigPath();
      const projectRoot = configPath ? path.dirname(configPath) : process.cwd();
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
      timeout: 1000,
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
      const configPath = ConfigParser.getInstance().getConfigPath();
      const projectRoot = configPath ? path.dirname(configPath) : process.cwd();
      codeceptConfig.include = { I: path.resolve(projectRoot, this.config.stepsFile) };
    }

    return codeceptConfig;
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

  private setupXhrCapture(): void {
    const configParser = ConfigParser.getInstance();
    const outputDir = configParser.getOutputDir();
    this.requestStore = new RequestStore(outputDir);
    const baseUrl = this.config.playwright.url;
    this.xhrCapture = new XhrCapture(this.requestStore, baseUrl);
    this.xhrCapture.attach(this.playwrightHelper.page);
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
    const contextOptions = hasSession ? { storageState: this.options!.session } : undefined;
    await this.playwrightHelper._createContextPage(contextOptions);
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

  createAction() {
    return new Action(this.actor, this.stateManager);
  }

  async visit(url: string) {
    await this.closeOtherTabs();

    const serializedUrl = JSON.stringify(url);
    const currentState = this.stateManager.getCurrentState();
    const actionResult = currentState ? ActionResult.fromState(currentState) : new ActionResult({ url });

    const { statePush = false, wait, waitForElement, code } = this.knowledgeTracker.getStateParameters(actionResult, ['statePush', 'wait', 'waitForElement', 'code']);

    const action = this.createAction();

    if (statePush) {
      await action.execute(`I.executeScript(() => { window.history.pushState({}, '', ${serializedUrl}); window.dispatchEvent(new PopStateEvent('popstate')); })`);
    } else {
      await action.execute(`I.amOnPage(${serializedUrl})`);
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

  async annotateElements(): Promise<{ ariaSnapshot: string; elements: WebElement[] }> {
    return annotatePageElements(this.playwrightHelper.page);
  }

  async visuallyAnnotateElements(opts?: { containers?: Array<{ css: string; label: string }> }): Promise<number> {
    return visuallyAnnotateContainers(this.playwrightHelper.page, opts?.containers || []);
  }

  async getEidxInContainer(containerCss: string | null): Promise<string[]> {
    const page = this.playwrightHelper.page;
    try {
      const selector = containerCss ? `${containerCss} [data-explorbot-eidx]` : '[data-explorbot-eidx]';
      const elements = await page.locator(selector).all();
      const result: string[] = [];
      for (const el of elements) {
        const attr = await el.getAttribute('data-explorbot-eidx');
        if (attr) result.push(attr);
      }
      return result;
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`getEidxInContainer: ${error instanceof Error ? error.message : error}`);
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
      return await el.first().getAttribute('data-explorbot-eidx');
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`getEidxByLocator: ${error instanceof Error ? error.message : error}`);
        await this.recoverFromBrowserError();
      }
      return null;
    }
  }

  async reload() {
    await this.closeOtherTabs();
    await this.playwrightHelper.page.reload();
  }

  isFatalBrowserError(error: unknown): boolean {
    const msg = error instanceof Error ? error.message : String(error);
    return FATAL_BROWSER_ERRORS.test(msg);
  }

  async recoverFromBrowserError(): Promise<boolean> {
    try {
      const url = this.stateManager.getCurrentState()?.url;
      if (url) {
        tag('warning').log(`Browser error detected, recovering by navigating to ${url}`);
        await this.playwrightHelper.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        return true;
      }
      tag('warning').log('Browser error detected, reloading page');
      await this.playwrightHelper.page.reload({ waitUntil: 'domcontentloaded', timeout: 10000 });
      return true;
    } catch (err) {
      tag('error').log(`Browser recovery failed: ${err instanceof Error ? err.message : err}`);
      return false;
    }
  }

  async switchToMainFrame() {
    if (this.playwrightHelper.frame) {
      debugLog('Switching to main frame');
      await this.playwrightHelper.switchTo();
    }
  }

  async isInsideIframe(): Promise<boolean> {
    if (this.playwrightHelper.frame) return true;

    try {
      const page = this.playwrightHelper.page;
      if (!page) return false;
      return await page.evaluate(() => window.top !== window.self);
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`isInsideIframe: ${error instanceof Error ? error.message : error}`);
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

  async startTest(test: Test) {
    this._activeTest = test;
    await this.reporter.reportTestStart(test);
    await this.closeOtherTabs();
    this.otherTabs = [];

    const codeceptjsTest = toCodeceptjsTest(test);

    const stepHandler = (step: any, status?: string, error?: string, log?: string) => {
      if (!step.toCode) return;
      if (step?.name?.startsWith('grab')) return;
      if (step?.name?.startsWith('save')) return;

      test.addStep(step.toCode(), step.duration, status, error, log);

      if (!this.stateManager.getCurrentState()) return;

      const lastScreenshot = ActionResult.fromState(this.stateManager.getCurrentState()!).screenshotFile;
      if (!lastScreenshot) return;

      const screenshotPath = outputPath('states', lastScreenshot);
      test.addArtifact(screenshotPath);
    };

    const dialogHandler = (dialog: any) => {
      const dialogType = dialog.type();
      const dialogMessage = dialog.message();
      test.addNote(`Native dialog ${dialogType} appeared: ${dialogMessage}. Accepted automatically`);
    };

    this.playwrightHelper?.page?.on('dialog', dialogHandler);

    codeceptjs.event.dispatcher.emit('test.before', codeceptjsTest);
    codeceptjs.event.dispatcher.emit('test.start', codeceptjsTest);
    codeceptjs.event.dispatcher.on('step.passed', (step: any) => stepHandler(step, 'passed'));
    codeceptjs.event.dispatcher.on('step.failed', (step: any, error: any) => {
      stepHandler(step, 'failed', error?.message || String(error), error?.stack);
    });
    codeceptjs.event.dispatcher.on('test.after', () => {
      codeceptjs.event.dispatcher.off('step.passed', stepHandler);
      codeceptjs.event.dispatcher.off('step.failed', stepHandler);
      this.playwrightHelper?.page?.off('dialog', dialogHandler);
    });
  }

  async stopTest(test: Test, meta?: Record<string, string>) {
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

  async hasPlaywrightLocator(locatorFn: (page: any) => any, opts: { multiple?: boolean; contents?: boolean; success?: (locator: any) => Promise<void> | void } = {}): Promise<boolean> {
    try {
      const pwLocator = locatorFn(this.playwrightHelper.page);
      const count = await pwLocator.count();
      if (opts.multiple ? count === 0 : count !== 1) return false;
      if (opts.contents) {
        const html = await pwLocator.first().innerHTML();
        if (!html?.trim()) return false;
      }
      if (opts.success) await opts.success(pwLocator);
      return true;
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`hasPlaywrightLocator: ${error instanceof Error ? error.message : error}`);
        await this.recoverFromBrowserError();
      }
      return false;
    }
  }

  async playwrightLocatorCount(locatorFn: (page: any) => any): Promise<number> {
    try {
      const pwLocator = locatorFn(this.playwrightHelper.page);
      return await pwLocator.count();
    } catch (error) {
      if (this.isFatalBrowserError(error)) {
        tag('warning').log(`playwrightLocatorCount: ${error instanceof Error ? error.message : error}`);
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

      await new Promise((resolve) => setTimeout(resolve, 500));
    });
  }

  async openFreshTab(): Promise<void> {
    if (!this.playwrightHelper?.page) return;

    const oldPage = this.playwrightHelper.page;
    const context = oldPage.context();
    const newPage = await context.newPage();

    await oldPage.close();
    await newPage.bringToFront();

    this.playwrightHelper.page = newPage;
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
  codeceptjsTest.fullTitle = () => `${parent.title} ${test.scenario}`;
  codeceptjsTest.state = 'pending';
  codeceptjsTest.notes = test.getPrintableNotes();
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
  const ariaSnapshot: string = await page.locator('body').ariaSnapshot({ forAI: true });
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
        (domElements: Element[], [data, extractFnStr]: [Array<{ name: string; ref: string }>, string]) => {
          const extract = new Function(`return ${extractFnStr}`)() as (el: Element) => any;
          const results: any[] = [];
          let ariaIdx = 0;
          for (const el of domElements) {
            if (ariaIdx >= data.length) break;
            el.setAttribute('data-explorbot-eidx', data[ariaIdx].ref);
            const elData = extract(el);
            if (elData) results.push(elData);
            ariaIdx++;
          }
          return results;
        },
        [entries, extractElementData.toString()]
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
