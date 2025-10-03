import fs from 'node:fs';
import { join } from 'node:path';
import { highlight } from 'cli-highlight';
import { recorder } from 'codeceptjs';
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

  constructor(actor: CodeceptJS.I, stateManager: StateManager) {
    this.actor = actor;
    this.experienceTracker = new ExperienceTracker();
    this.stateManager = stateManager;
    this.config = ConfigParser.getInstance().getConfig();
  }

  private async capturePageState(): Promise<{
    html: string;
    url: string;
    screenshot?: Buffer;
    screenshotFile?: string;
    title: string;
    browserLogs: any[];
    htmlFile: string;
    logFile: string;
    h1?: string;
    h2?: string;
    h3?: string;
    h4?: string;
  }> {
    const currentState = this.stateManager.getCurrentState();
    const stateHash = currentState?.hash || 'screenshot';
    const timestamp = Date.now();

    const [url, html, title, browserLogs] = await Promise.all([(this.actor as any).grabCurrentUrl?.(), (this.actor as any).grabSource(), (this.actor as any).grabTitle(), this.captureBrowserLogs()]);

    const screenshotResult: { screenshot?: Buffer; screenshotFile?: string } = {};
    await throttle(async () => {
      screenshotResult.screenshot = await (this.actor as any).saveScreenshot(`${stateHash}_${timestamp}.png`);
      screenshotResult.screenshotFile = `${stateHash}_${timestamp}.png`;
      const screenshotPath = join('output', screenshotResult.screenshotFile);
      if (screenshotResult.screenshot) {
        fs.writeFileSync(screenshotPath, screenshotResult.screenshot);
      }
    });

    // Extract headings from HTML
    const headings = this.extractHeadings(html);

    // Save HTML to file
    const htmlFile = `${stateHash}_${timestamp}.html`;
    const htmlPath = join('output', htmlFile);
    fs.writeFileSync(htmlPath, html, 'utf8');

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

    debugLog('Page:', { url, title, html: html.substring(0, 100), headings });

    return {
      html,
      title,
      url,
      browserLogs,
      htmlFile,
      logFile,
      ...screenshotResult,
      ...headings,
    };
  }

  /**
   * Extract headings from HTML content
   */
  private extractHeadings(html: string): {
    h1?: string;
    h2?: string;
    h3?: string;
    h4?: string;
  } {
    const headings: { h1?: string; h2?: string; h3?: string; h4?: string } = {};

    ['h1', 'h2', 'h3', 'h4'].forEach((tag) => {
      const match = html.match(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, 'i'));
      if (match) {
        headings[tag as keyof typeof headings] = match[1].replace(/<[^>]*>/g, '').trim();
      }
    });

    return headings;
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
      const result = new ActionResult({
        url: pageState.url,
        html: pageState.html,
        screenshot: pageState.screenshot ? fs.readFileSync(pageState.screenshot) : undefined,
        title: pageState.title,
        error: error ? errorToString(error) : null,
        browserLogs: pageState.browserLogs,
        h1: pageState.h1,
        h2: pageState.h2,
        h3: pageState.h3,
        h4: pageState.h4,
      });

      // Update state manager with new state and code that led to it
      // updateState will only create a new state if the hash has changed
      this.stateManager.updateState(
        result,
        codeString,
        {
          htmlFile: pageState.htmlFile,
          screenshotFile: pageState.screenshotFile,
          logFile: pageState.logFile,
        },
        'manual'
      );

      this.actionResult = result;
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

  public async attempt(codeBlock: string, attempt: number, originalMessage: string): Promise<boolean> {
    try {
      debugLog(`Resolution attempt ${attempt}`);
      setActivity('🦾 Acting in browser...', 'action');

      const prevActionResult = this.actionResult;
      this.lastError = null;
      await this.execute(codeBlock);

      if (!this.expectation) {
        return true;
      }
      await this.expect(this.expectation!);

      tag('success').log('Resolved', this.expectation);
      await this.experienceTracker.saveSuccessfulResolution(prevActionResult!, originalMessage, codeBlock);

      return true;
    } catch (error) {
      tag('error').log(`Attempt ${attempt} failed with error:`, error);

      const executionError = errorToString(error);

      await this.experienceTracker.saveFailedAttempt(this.actionResult!, originalMessage, codeBlock, executionError, attempt);

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
