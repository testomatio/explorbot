import fs from 'node:fs';
import { join } from 'node:path';
import { context, trace } from '@opentelemetry/api';
import { highlight } from 'cli-highlight';
import { container, recorder } from 'codeceptjs';
import * as codeceptjs from 'codeceptjs';
import { hopeThat, retryTo, tryTo, within } from 'codeceptjs/lib/effects';
import step from 'codeceptjs/steps';
import dedent from 'dedent';
import { ActionResult } from './action-result.js';
import { clearActivity, setActivity } from './activity.ts';
import { ExperienceCompactor } from './ai/experience-compactor.js';
import { Navigator } from './ai/navigator.js';
import type { Provider } from './ai/provider.js';
import { ConfigParser, outputPath } from './config.js';
import type { ExplorbotConfig } from './config.js';
import type { UserResolveFunction } from './explorbot.ts';
import { Observability } from './observability.ts';
import type { PlaywrightRecorder } from './playwright-recorder.ts';
import type { StateManager } from './state-manager.js';
import { extractCodeBlocks } from './utils/code-extractor.js';
import { htmlCombinedSnapshot, minifyHtml } from './utils/html.js';
import { createDebug, log, setStepSpanParent, tag } from './utils/logger.js';
import { throttle } from './utils/throttle.ts';

const debugLog = createDebug('explorbot:action');
const FATAL_BROWSER_ERRORS = /Frame was detached|Target closed|Execution context was destroyed|Protocol error|Session closed/i;

class Action {
  private actor: CodeceptJS.I;
  public stateManager: StateManager;
  public actionResult: ActionResult | null = null;
  private config: ExplorbotConfig;

  // action info
  private action: string | null = null;
  private expectation: string | null = null;
  public lastError: Error | null = null;
  public playwrightHelper: any;
  public playwrightGroupId: string | null = null;
  public assertionSteps: Array<{ name: string; args: any[] }> = [];
  private recorder?: PlaywrightRecorder;

  constructor(actor: CodeceptJS.I, stateManager: StateManager, recorder?: PlaywrightRecorder) {
    this.actor = actor;
    this.stateManager = stateManager;
    this.config = ConfigParser.getInstance().getConfig();
    this.playwrightHelper = container.helpers('Playwright');
    this.recorder = recorder;
  }

  async caputrePageWithScreenshot(): Promise<ActionResult> {
    return this.capturePageState({ includeScreenshot: true });
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

  async capturePageState({ includeScreenshot = false }: { includeScreenshot?: boolean } = {}): Promise<ActionResult> {
    try {
      const currentState = this.stateManager.getCurrentState();
      const stateHash = currentState?.hash || 'screenshot';
      const timestamp = Date.now();
      const page = this.playwrightHelper.page;
      const frame = this.playwrightHelper.frame;
      const [html, title, browserLogs] = await Promise.all([(this.actor as any).grabSource(), (this.actor as any).grabTitle(), this.captureBrowserLogs()]);
      const url = page?.url() || (await (this.actor as any).grabCurrentUrl?.());

      let screenshotFile: string | undefined = undefined;

      if (includeScreenshot) {
        const filename = `${stateHash}_${timestamp}.png`;
        screenshotFile = await (this.actor as any)
          .saveScreenshot(filename)
          .then(() => filename)
          .catch((err: Error) => {
            debugLog('Screenshot failed, continuing without it:', err);
            return undefined;
          });
      }

      // Save HTML to file
      const statesDir = outputPath('states');
      fs.mkdirSync(statesDir, { recursive: true });
      const htmlFile = `${stateHash}_${timestamp}.html`;
      const htmlPath = join(statesDir, htmlFile);
      fs.writeFileSync(htmlPath, html, 'utf8');

      debugLog('Captured page state');
      // Save logs to file
      const logFile = `${stateHash}_${timestamp}.log`;
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
        const ariaFileName = `${stateHash}_${timestamp}.aria.yaml`;
        const ariaPath = join(statesDir, ariaFileName);
        fs.writeFileSync(ariaPath, ariaSnapshot, 'utf8');
        ariaSnapshotFile = ariaFileName;
      }

      const result = new ActionResult({
        html,
        title,
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
      this.stateManager.updateState(result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (FATAL_BROWSER_ERRORS.test(msg)) throw err;
      debugLog('capturePageState failed with non-fatal error:', msg);
      const url = this.playwrightHelper.page?.url?.() || '';
      return new ActionResult({ url, error: msg });
    }
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
    registerStepLogger(executedSteps, assertionSteps);
    const groupId = this.recorder ? await this.recorder.beginAction(codeString) : null;
    this.playwrightGroupId = groupId;
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
        const asyncFn = new Function('page', `return (async () => { ${sanitizedCode} })()`);
        await asyncFn(page);
        await sleep(this.config.action?.delay || 500);
      } else {
        const codeFunction = new Function('I', 'tryTo', 'retryTo', 'within', 'hopeThat', 'step', sanitizedCode);
        codeFunction(this.actor, tryTo, retryTo, within, hopeThat, step);
        await recorder.add(() => sleep(this.config.action?.delay || 500));
        await recorder.promise();
      }

      const pageState = await this.capturePageState();
      if (executedSteps.length > 0) {
        codeString = executedSteps.join('\n');
      }

      this.stateManager.updateState(pageState, codeString);

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
      if (groupId) await this.recorder!.endAction();
      unregisterStepLogger();
      if (stepSpan) {
        stepSpan.end();
      }
      setStepSpanParent(null);
      clearActivity();
    }

    return this;
  }

  async expect(codeOrFunction: string | ((I: CodeceptJS.I) => void)): Promise<Action> {
    const codeString = typeof codeOrFunction === 'string' ? codeOrFunction : codeOrFunction.toString();
    this.expectation = codeString.toString();
    log('Expecting', highlight(codeString, { language: 'javascript' }));
    try {
      debugLog('Executing expectation:', codeString);

      let codeFunction: any;
      if (typeof codeOrFunction === 'function') {
        codeFunction = codeOrFunction;
      } else {
        const sanitizedCode = sanitizeCodeBlock(codeString);
        if (!sanitizedCode) {
          throw new Error('No valid I.* commands found in code block');
        }
        codeFunction = new Function('I', 'tryTo', 'retryTo', 'within', 'hopeThat', 'step', sanitizedCode);
      }
      codeFunction(this.actor, tryTo, retryTo, within, hopeThat, step);
      await recorder.promise();
      debugLog('Expectation executed successfully');

      // Get current state from state manager
      const currentState = this.stateManager.getCurrentState();
      if (currentState) {
        // Create ActionResult from current state for compatibility
        this.actionResult = new ActionResult({
          url: currentState.fullUrl || '',
          title: currentState.title,
          timestamp: currentState.timestamp,
          html: '', // Empty HTML for expectation state
        });
      }

      return this;
    } catch (err) {
      tag('error').log('Expectation failed:', errorToString(err));
      this.lastError = err as Error;
      await recorder.reset();
      await recorder.start();
      debugLog('Expectation failed:', errorToString(err));
    } finally {
      clearActivity();
    }

    return this;
  }

  public async waitForInteraction(): Promise<Action> {
    // start with basic approach
    await this.actor.wait(0.5);
    return this;
  }

  public async attempt(codeBlock: string, originalMessage?: string, experience = true): Promise<boolean> {
    try {
      debugLog('Resolution attempt...');
      setActivity('🦾 Acting in browser...', 'action');

      if (!this.actionResult) {
        this.actionResult = ActionResult.fromState(this.stateManager.getCurrentState()!);
      }
      const prevActionResult = this.actionResult;
      this.lastError = null;
      await this.execute(codeBlock);

      if (!this.expectation && originalMessage) {
        this.expectation = originalMessage;
      }

      if (!this.expectation) {
        return true;
      }

      debugLog('Resolved Expectation:', this.expectation);
      return true;
    } catch (error) {
      this.lastError = error as Error;

      if (error && typeof error === 'object') {
        const errorObj = error as { fetchDetails?: () => Promise<void> };
        if (typeof errorObj.fetchDetails === 'function') {
          await errorObj.fetchDetails();
        }
      }

      debugLog(`Attempt failed: ${codeBlock}: ${errorToString(error) || this.lastError?.toString()}`);
      return false;
    }
  }

  getActor(): CodeceptJS.I {
    return this.actor;
  }

  setActor(actor: CodeceptJS.I): void {
    this.actor = actor;
  }

  getCurrentState(): ActionResult | null {
    return this.actionResult;
  }

  getActionResult(): ActionResult | null {
    return this.actionResult;
  }
}

export default Action;

function errorToString(error: any): string {
  if (error.cliMessage) {
    return error.cliMessage();
  }
  return error.message || error.toString();
}

function sanitizeCodeBlock(code: string): string {
  return code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('I.') || line.startsWith('page.') || line.startsWith('await '))
    .join('\n');
}

function hasPlaywrightCommands(code: string): boolean {
  return code.split('\n').some((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith('page.') || trimmed.startsWith('await page.');
  });
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ASSERTION_STEP_NAMES = new Set(['see', 'dontSee', 'seeElement', 'dontSeeElement', 'seeInField', 'dontSeeInField', 'seeInCurrentUrl', 'dontSeeInCurrentUrl']);

let stepLoggerRegistered = false;
let stepLoggerTarget: string[] | null = null;
let assertionStepsTarget: Array<{ name: string; args: any[] }> | null = null;

const stepLogger = (step: any, error?: any) => {
  if (!step?.toCode) {
    return;
  }
  if (step.name?.startsWith('grab')) return;
  const stepCode = step.toCode();
  if (stepLoggerTarget) {
    stepLoggerTarget.push(stepCode);
  }
  if (assertionStepsTarget && ASSERTION_STEP_NAMES.has(step.name)) {
    assertionStepsTarget.push({ name: step.name, args: step.args || [] });
  }
  if (error) {
    tag('step').log(step, error);
    return;
  }
  tag('step').log(step);
};

const registerStepLogger = (target: string[], assertionsTarget?: Array<{ name: string; args: any[] }>) => {
  stepLoggerTarget = target;
  assertionStepsTarget = assertionsTarget || null;
  if (stepLoggerRegistered) {
    return;
  }
  stepLoggerRegistered = true;
  codeceptjs.event.dispatcher.on(codeceptjs.event.step.passed, stepLogger);
  codeceptjs.event.dispatcher.on(codeceptjs.event.step.failed, stepLogger);
};

const unregisterStepLogger = () => {
  stepLoggerTarget = null;
  assertionStepsTarget = null;
  if (!stepLoggerRegistered) {
    return;
  }
  stepLoggerRegistered = false;
  codeceptjs.event.dispatcher.off(codeceptjs.event.step.passed, stepLogger);
  codeceptjs.event.dispatcher.off(codeceptjs.event.step.failed, stepLogger);
};
