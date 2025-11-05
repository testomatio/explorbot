import fs from 'node:fs';
import { join } from 'node:path';
import { highlight } from 'cli-highlight';
import { container, recorder } from 'codeceptjs';
import dedent from 'dedent';
import { ActionResult } from './action-result.js';
import { clearActivity, setActivity } from './activity.ts';
import { ExperienceCompactor } from './ai/experience-compactor.js';
import { Navigator } from './ai/navigator.js';
import type { Provider } from './ai/provider.js';
import { ConfigParser } from './config.js';
import type { ExplorbotConfig } from './config.js';
import { ExperienceTracker } from './experience-tracker.js';
import type { UserResolveFunction } from './explorbot.ts';
import type { StateManager } from './state-manager.js';
import { extractCodeBlocks } from './utils/code-extractor.js';
import { createDebug, log, tag } from './utils/logger.js';
import { throttle } from './utils/throttle.ts';
import { htmlCombinedSnapshot, minifyHtml } from './utils/html.js';
import { collectInteractiveNodes } from './utils/aria.ts';

const debugLog = createDebug('explorbot:action');

class Action {
  private actor: CodeceptJS.I;
  public stateManager: StateManager;
  private experienceTracker: ExperienceTracker;
  public actionResult: ActionResult | null = null;
  private config: ExplorbotConfig;

  // action info
  private action: string | null = null;
  private expectation: string | null = null;
  public lastError: Error | null = null;
  public playwrightHelper: any;

  constructor(actor: CodeceptJS.I, stateManager: StateManager) {
    this.actor = actor;
    this.stateManager = stateManager;
    this.experienceTracker = stateManager.getExperienceTracker();
    this.config = ConfigParser.getInstance().getConfig();
    this.playwrightHelper = container.helpers('Playwright');
  }

  async caputrePageWithScreenshot(): Promise<ActionResult> {
    return this.capturePageState({ includeScreenshot: true });
  }

  async capturePageState({ includeScreenshot = false }: { includeScreenshot?: boolean } = {}): Promise<ActionResult> {
    const currentState = this.stateManager.getCurrentState();
    const stateHash = currentState?.hash || 'screenshot';
    const timestamp = Date.now();

    const [url, html, title, browserLogs] = await Promise.all([(this.actor as any).grabCurrentUrl?.(), (this.actor as any).grabSource(), (this.actor as any).grabTitle(), this.captureBrowserLogs()]);

    let screenshotFile: string | undefined = undefined;

    const makeScreenshot = async () => {
      await (this.actor as any).saveScreenshot(`${stateHash}_${timestamp}.png`);
      screenshotFile = `${stateHash}_${timestamp}.png`;
    };

    if (includeScreenshot) {
      await makeScreenshot();
    }

    // Save HTML to file
    const htmlFile = `${stateHash}_${timestamp}.html`;
    const htmlPath = join('output', htmlFile);
    fs.writeFileSync(htmlPath, html, 'utf8');

    debugLog('Captured page state');
    // Save logs to file
    const logFile = `${stateHash}_${timestamp}.log`;
    const logPath = join('output', logFile);
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

    const page = this.playwrightHelper.page;
    const serializedSnapshot = await page.locator('body').ariaSnapshot();
    const ariaFileName = `${stateHash}_${timestamp}.aria.yaml`;
    const ariaPath = join('output', ariaFileName);
    fs.writeFileSync(ariaPath, serializedSnapshot, 'utf8');
    ariaSnapshot = serializedSnapshot;
    ariaSnapshotFile = ariaFileName;

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
    });
    this.stateManager.updateState(result);
    return result;
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

      const iframeHtml = await frame.evaluate(() => document.documentElement.outerHTML);
      const compactedIframeHtml = await minifyHtml(htmlCombinedSnapshot(iframeHtml));

      iframeSnapshots.push({
        src: url,
        html: compactedIframeHtml,
      });

      debugLog(`Captured iframe ${url}: ${compactedIframeHtml.length} characters (compacted)`);
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

  async execute(codeOrFunction: string | ((I: CodeceptJS.I) => void)): Promise<Action> {
    let error: Error | null = null;

    setActivity('🔎 Browsing...', 'action');

    let codeString = typeof codeOrFunction === 'string' ? codeOrFunction : codeOrFunction.toString();
    codeString = codeString.replace(/^\(I\) => /, '').trim();
    // tag('step').log(highlight(codeString, { language: 'javascript' }));
    try {
      debugLog('Executing action:', codeString);

      let codeFunction: any;
      if (typeof codeOrFunction === 'function') {
        codeFunction = codeOrFunction;
      } else {
        codeFunction = new Function('I', codeString);
      }
      codeFunction(this.actor);

      await recorder.add(() => sleep(this.config.action?.delay || 500)); // wait for the action to be executed
      await recorder.promise();

      const pageState = await this.capturePageState();

      this.stateManager.updateState(pageState, codeString);

      this.actionResult = pageState;
    } catch (err) {
      debugLog('Action error', errorToString(err));
      error = err as Error;
      await recorder.reset();
      await recorder.start();
      throw err;
    } finally {
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
        codeFunction = new Function('I', codeString);
      }
      codeFunction(this.actor);
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

  public async attempt(codeBlock: string | ((I: CodeceptJS.I) => void), originalMessage?: string): Promise<boolean> {
    try {
      debugLog('Resolution attempt...');
      setActivity('🦾 Acting in browser...', 'action');

      if (!this.actionResult) {
        this.actionResult = ActionResult.fromState(this.stateManager.getCurrentState()!);
      }
      const prevActionResult = this.actionResult;
      this.lastError = null;
      await this.execute(codeBlock);

      if (!this.expectation) {
        return true;
      }
      await this.expect(this.expectation!);

      tag('success').log('Resolved', this.expectation);
      if (originalMessage) {
        await this.experienceTracker.saveSuccessfulResolution(prevActionResult!, originalMessage, codeBlock.toString());
      }

      return true;
    } catch (error) {
      const executionError = errorToString(error);
      tag('error').log(`Attempt failed with error: ${executionError || this.lastError?.toString()}`);

      await this.experienceTracker.saveFailedAttempt(this.actionResult!, originalMessage ?? '', codeBlock.toString(), executionError);

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
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
