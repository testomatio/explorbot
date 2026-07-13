import fs from 'node:fs';
import { join } from 'node:path';
import { context, trace } from '@opentelemetry/api';
import { container, recorder } from 'codeceptjs';
import * as codeceptjs from 'codeceptjs';
import { ActionResult } from './action-result.js';
import { clearActivity, setActivity } from './activity.ts';
import { ConfigParser, outputPath } from './config.js';
import type { ExplorbotConfig } from './config.js';
import { Observability } from './observability.ts';
import type { PlaywrightRecorder } from './playwright-recorder.ts';
import type { StateManager } from './state-manager.js';
import { browserErrorMessage, isFatalBrowserError, isNavigationTransitionError } from './utils/browser-errors.ts';
import { captureHtmlForSnapshot, htmlCombinedSnapshot, minifyHtml } from './utils/html.js';
import { createDebug, setStepSpanParent, tag } from './utils/logger.js';
import { sleep, waitForPageReadiness } from './utils/page-readiness.ts';
import { codeceptJSSandbox, hasPlaywrightCommands, playwrightSandbox, sanitizeCodeBlock } from './utils/web-sandbox.ts';
import { safeFilename } from './utils/strings.ts';

const debugLog = createDebug('explorbot:action');
const CAPTURE_NAVIGATION_TRANSITION_ATTEMPTS = 3;

class Action {
  private actor: CodeceptJS.I;
  public stateManager: StateManager;
  public actionResult: ActionResult | null = null;
  private config: ExplorbotConfig;

  // action info
  private action: string | null = null;
  public lastError: Error | null = null;
  public playwrightHelper: any;
  public playwrightGroupId: string | null = null;
  public assertionSteps: Array<{ name: string; args: any[] }> = [];
  private recorder?: PlaywrightRecorder;
  private mainDocumentStatus: number | undefined = undefined;

  constructor(actor: CodeceptJS.I, stateManager: StateManager, recorder?: PlaywrightRecorder) {
    this.actor = actor;
    this.stateManager = stateManager;
    this.config = ConfigParser.getInstance().getConfig();
    this.playwrightHelper = container.helpers('Playwright');
    this.recorder = recorder;
  }

  async saveScreenshot(): Promise<string | undefined> {
    const currentState = this.stateManager.getCurrentState();
    if (currentState?.screenshotFile) return currentState.screenshotFile;

    const stateHash = currentState?.hash || 'screenshot';
    const filename = `${stateHash}_${Date.now()}.png`;
    try {
      await (this.actor as any).saveScreenshot(filename);
      if (currentState) currentState.screenshotFile = filename;
      return filename;
    } catch (err) {
      debugLog('Screenshot failed:', err);
      return undefined;
    }
  }

  async capturePageState({ includeScreenshot = false, codeBlock }: { includeScreenshot?: boolean; codeBlock?: string } = {}): Promise<ActionResult> {
    try {
      const currentState = this.stateManager.getCurrentState();
      const stateHash = currentState?.hash || 'screenshot';
      const timestamp = Date.now();
      const page = this.playwrightHelper.page;
      const frame = this.playwrightHelper.frame;
      await this.waitForPageReadiness(page);
      const grabAll = () => Promise.all([captureHtml(page, frame, this.actor), captureTitle(page, this.actor), this.captureBrowserLogs()]);
      let html = '';
      let title = '';
      let browserLogs: any[] = [];
      for (let attempt = 1; attempt <= CAPTURE_NAVIGATION_TRANSITION_ATTEMPTS; attempt++) {
        try {
          [html, title, browserLogs] = await grabAll();
          break;
        } catch (err) {
          if (!isNavigationTransitionError(err)) throw err;
          if (attempt === CAPTURE_NAVIGATION_TRANSITION_ATTEMPTS) throw err;
          await this.waitForPageReadiness(page);
        }
      }
      const url = page?.url() || (await (this.actor as any).grabCurrentUrl?.());

      let screenshotFile: string | undefined = undefined;
      const statesDir = outputPath('states');
      fs.mkdirSync(statesDir, { recursive: true });

      if (includeScreenshot) {
        const filename = safeFilename(`${stateHash}_${timestamp}`, '.png');
        const screenshotPath = join(statesDir, filename);
        screenshotFile = await page
          ?.screenshot({ path: screenshotPath, fullPage: true })
          .then(() => filename)
          .catch((err: Error) => {
            debugLog('Screenshot failed, continuing without it:', err);
            return undefined;
          });
      }

      // Save HTML to file
      const htmlFile = safeFilename(`${stateHash}_${timestamp}`, '.html');
      const htmlPath = join(statesDir, htmlFile);
      fs.writeFileSync(htmlPath, html, 'utf8');

      debugLog('Captured page state');
      // Save logs to file
      const logFile = safeFilename(`${stateHash}_${timestamp}`, '.log');
      const logPath = join(statesDir, logFile);
      const formattedLogs = browserLogs.map((log: any) => {
        const logTimestamp = new Date().toISOString();
        const level = (log.type || log.level || 'LOG').toUpperCase();
        const message = log.text || log.message || String(log);
        return `[${logTimestamp}] ${level}: ${message}`;
      });
      fs.writeFileSync(logPath, `${formattedLogs.join('\n')}\n`, 'utf8');

      debugLog('Page:', { url, title, size: html.length, html: html.substring(0, 100) });

      // Capture iframe HTML snapshots
      const iframeSnapshots = await this.captureIframeSnapshots(html);

      let ariaSnapshot: string | null = null;
      let ariaSnapshotFile: string | undefined = undefined;

      try {
        const page = this.playwrightHelper.page;
        ariaSnapshot = await page.locator('body').ariaSnapshot();
      } catch (err) {
        debugLog('ARIA snapshot failed:', err instanceof Error ? `${err.message}\n${err.stack}` : err);
      }

      if (ariaSnapshot) {
        const ariaFileName = safeFilename(`${stateHash}_${timestamp}`, '.aria.yaml');
        const ariaPath = join(statesDir, ariaFileName);
        fs.writeFileSync(ariaPath, ariaSnapshot, 'utf8');
        ariaSnapshotFile = ariaFileName;
      }

      const result = new ActionResult({
        html,
        title,
        httpStatus: await this.captureMainDocumentStatus(),
        url,
        browserLogs,
        htmlFile,
        logFile,
        screenshotFile,
        iframeSnapshots,
        ariaSnapshot,
        ariaSnapshotFile,
        iframeURL: frame ? frame.url?.() || 'iframe' : undefined,
      });
      this.stateManager.updateState(result, codeBlock);
      return result;
    } catch (err) {
      const msg = browserErrorMessage(err);
      if (isFatalBrowserError(err)) throw err;
      debugLog('capturePageState failed with non-fatal error:', msg);
      const url = this.playwrightHelper.page?.url?.() || '';
      return new ActionResult({ url, error: msg });
    }
  }

  private async captureMainDocumentStatus(): Promise<number | undefined> {
    if (this.mainDocumentStatus) return this.mainDocumentStatus;

    try {
      const page = this.playwrightHelper.page;
      const status = await page.evaluate(() => {
        const navigation = performance.getEntriesByType('navigation').at(-1) as PerformanceNavigationTiming & { responseStatus?: number };
        if (!navigation) return undefined;
        if (new URL(navigation.name).href !== window.location.href) return undefined;
        return navigation.responseStatus;
      });
      if (typeof status !== 'number') return undefined;
      if (status <= 0) return undefined;
      return status;
    } catch {
      return undefined;
    }
  }

  private captureMainDocumentResponse(): () => void {
    const page = this.playwrightHelper.page;
    if (!page?.on || !page?.off) return () => {};

    this.mainDocumentStatus = undefined;

    const handler = (response: any) => {
      const request = response.request();
      if (request.resourceType() !== 'document') return;
      if (response.frame() !== page.mainFrame()) return;
      const status = response.status();
      if (typeof status !== 'number') return;
      if (status <= 0) return;
      this.mainDocumentStatus = status;
    };

    page.on('response', handler);
    return () => page.off('response', handler);
  }

  /**
   * Capture HTML snapshots of all iframes on the page
   */
  private async captureIframeSnapshots(mainHtml: string): Promise<Array<{ src: string; html: string; id?: string }>> {
    const iframeSnapshots: Array<{ src: string; html: string }> = [];

    if (!/<iframe/i.test(mainHtml)) {
      return iframeSnapshots;
    }

    const page = this.playwrightHelper.page;
    const frames = page.frames();

    for (const frame of frames) {
      if (frame === page.mainFrame()) {
        continue;
      }

      const url = frame.url();
      if (url === 'about:blank') {
        continue;
      }

      try {
        const iframeHtml = await frame.evaluate(() => document.documentElement.outerHTML);
        const compactedIframeHtml = await minifyHtml(htmlCombinedSnapshot(iframeHtml));

        iframeSnapshots.push({
          src: url,
          html: compactedIframeHtml,
        });

        debugLog(`Captured iframe ${url}: ${compactedIframeHtml.length} characters (compacted)`);
      } catch (error) {
        debugLog(`Failed to capture iframe ${url}:`, error instanceof Error ? `${error.message}\n${error.stack}` : error);
      }
    }

    return iframeSnapshots;
  }

  private async captureBrowserLogs(): Promise<any[]> {
    try {
      const logs = await (this.actor as any).grabBrowserLogs();

      // Filter for important logs (info, error, warning)
      const importantLogs = logs.filter((log: any) => {
        const level = log.type || log.level;
        return ['info', 'error', 'warning', 'warn'].includes(level);
      });

      return importantLogs;
    } catch (error) {
      debugLog('Failed to capture browser logs:', error);
      return [];
    }
  }

  async execute(code: string): Promise<Action> {
    let error: Error | null = null;

    setActivity('🔎 Browsing...', 'action');

    let codeString = code.replace(/^\(I\) => /, '').trim();

    const executedSteps: string[] = [];
    const assertionSteps: Array<{ name: string; args: any[] }> = [];
    const stepListener = attachStepLogger(executedSteps, assertionSteps);
    const groupId = this.recorder ? await this.recorder.beginAction(codeString) : null;
    this.playwrightGroupId = groupId;
    const detachMainDocumentResponse = this.captureMainDocumentResponse();
    const activeSpan = Observability.getSpan();
    const tracer = trace.getTracer('ai');
    const stepSpan = activeSpan ? tracer.startSpan('codeceptjs.step', undefined, trace.setSpan(context.active(), activeSpan)) : null;
    setStepSpanParent(stepSpan);
    const sanitizedCode = sanitizeCodeBlock(codeString);
    const isPlaywright = hasPlaywrightCommands(sanitizedCode);

    try {
      debugLog('Executing action:', codeString);

      if (!sanitizedCode) {
        throw new Error('No valid I.* or page.* commands found in code block');
      }

      if (isPlaywright) {
        const page = this.playwrightHelper.page;
        await playwrightSandbox(page, sanitizedCode);
        await sleep(this.config.action?.delay || 500);
      } else {
        codeceptJSSandbox(this.actor, sanitizedCode);
        await recorder.add(() => sleep(this.config.action?.delay || 500));
        await recorder.promise();
      }

      if (executedSteps.length > 0) {
        codeString = executedSteps.join('\n');
      }

      const pageState = await this.capturePageState({ codeBlock: codeString });

      this.actionResult = pageState;
      this.assertionSteps = assertionSteps;
    } catch (err) {
      debugLog('Action error', errorToString(err));
      error = err as Error;
      if (!isPlaywright) {
        await recorder.reset();
        await recorder.start();
      }
      this.assertionSteps = [];
      throw err;
    } finally {
      detachMainDocumentResponse();
      if (groupId) await this.recorder!.endAction();
      detachStepLogger(stepListener);
      if (stepSpan) {
        stepSpan.end();
      }
      setStepSpanParent(null);
      clearActivity();
    }

    return this;
  }

  public async attempt(codeBlock: string, originalMessage?: string): Promise<boolean> {
    try {
      debugLog('Resolution attempt...');
      setActivity('🦾 Acting in browser...', 'action');

      if (!this.actionResult) {
        this.actionResult = ActionResult.fromState(this.stateManager.getCurrentState()!);
      }
      this.lastError = null;
      await this.execute(codeBlock);

      return true;
    } catch (error) {
      this.lastError = error as Error;
      if (isFatalBrowserError(error)) throw error;
      debugLog(`Attempt failed: ${codeBlock}: ${errorToString(error) || this.lastError?.toString()}`);
      return false;
    }
  }

  getActor(): CodeceptJS.I {
    return this.actor;
  }

  getActionResult(): ActionResult | null {
    return this.actionResult;
  }

  private async waitForPageReadiness(page: any): Promise<void> {
    await waitForPageReadiness(page, {
      timeout: this.config.playwright.waitForTimeout,
      spinnerSelectors: this.config.playwright.spinnerSelectors,
    });
  }
}

export default Action;

function errorToString(error: any): string {
  if (error.cliMessage) {
    return error.cliMessage();
  }
  return error.message || error.toString();
}

async function captureHtml(page: any, frame: any, actor: any): Promise<string> {
  for (const scope of [frame, page]) {
    if (!scope?.evaluate) continue;
    const html = await scope.evaluate(captureHtmlForSnapshot).catch(() => null);
    if (typeof html === 'string') return html;
  }
  if (frame?.content) return frame.content();
  if (page?.content) return page.content();
  if (actor?.grabSource) return actor.grabSource();
  throw new Error('Playwright page is unavailable for HTML capture');
}

async function captureTitle(page: any, actor: any): Promise<string> {
  if (page?.title) return page.title();
  if (actor?.grabTitle) return actor.grabTitle();
  return '';
}

const ASSERTION_STEP_NAMES = new Set(['see', 'dontSee', 'seeElement', 'dontSeeElement', 'seeInField', 'dontSeeInField', 'seeInCurrentUrl', 'dontSeeInCurrentUrl']);

type StepListener = (step: any, error?: any) => void;

const attachStepLogger = (target: string[], assertionsTarget?: Array<{ name: string; args: any[] }>): StepListener => {
  const listener: StepListener = (step, error) => {
    if (!step?.toCode) return;
    if (step.name?.startsWith('grab')) return;
    target.push(step.toCode());
    if (assertionsTarget && ASSERTION_STEP_NAMES.has(step.name)) {
      assertionsTarget.push({ name: step.name, args: step.args || [] });
    }
    if (error) {
      tag('step').log(step, error);
      return;
    }
    tag('step').log(step);
  };
  codeceptjs.event.dispatcher.on(codeceptjs.event.step.passed, listener);
  codeceptjs.event.dispatcher.on(codeceptjs.event.step.failed, listener);
  return listener;
};

const detachStepLogger = (listener: StepListener) => {
  codeceptjs.event.dispatcher.off(codeceptjs.event.step.passed, listener);
  codeceptjs.event.dispatcher.off(codeceptjs.event.step.failed, listener);
};
