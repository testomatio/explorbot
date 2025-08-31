import fs from 'node:fs';
import { join } from 'node:path';
import { highlight } from 'cli-highlight';
import { recorder } from 'codeceptjs';
import { ActionResult } from './action-result.js';
import { ExperienceTracker } from './experience-tracker.js';
import type { StateManager } from './state-manager.js';
import type { Provider } from './ai/provider.js';
import { Navigator } from './ai/navigator.js';
import { ExperienceCompactor } from './ai/experience-compactor.js';
import { ConfigParser } from './config.ts';
import type { ExplorbotConfig } from '../explorbot.config.ts';
import { log, tag, createDebug } from './utils/logger.js';
import { setActivity } from './activity.ts';
import type { UserResolveFunction } from './explorbot.ts';

const debugLog = createDebug('explorbot:action');

class Action {
  private MAX_ATTEMPTS = 5;

  private actor: CodeceptJS.I;
  private stateManager: StateManager;
  private experienceTracker: ExperienceTracker;
  private actionResult: ActionResult | null = null;
  private navigator: Navigator | null = null;
  private config: ExplorbotConfig;
  private userResolveFn: UserResolveFunction | null = null;

  // action info
  private action: string | null = null;
  private expectation: string | null = null;
  private lastError: Error | null = null;

  constructor(
    actor: CodeceptJS.I,
    provider: Provider,
    stateManager: StateManager,
    userResolveFn?: UserResolveFunction
  ) {
    this.actor = actor;
    this.navigator = new Navigator(provider);
    this.experienceTracker = new ExperienceTracker();
    this.stateManager = stateManager;
    this.config = ConfigParser.getInstance().getConfig();
    this.userResolveFn = userResolveFn || null;
  }

  private async capturePageState(): Promise<{
    html: string;
    url: string;
    screenshot: Buffer | null;
    title: string;
    browserLogs: any[];
    htmlFile: string;
    screenshotFile: string;
    logFile: string;
    h1?: string;
    h2?: string;
    h3?: string;
    h4?: string;
  }> {
    const currentState = this.stateManager.getCurrentState();
    const stateHash = currentState?.hash || 'screenshot';
    const timestamp = Date.now();

    const [url, html, screenshot, title, browserLogs] = await Promise.all([
      (this.actor as any).grabCurrentUrl?.(),
      (this.actor as any).grabSource(),
      (this.actor as any).saveScreenshot(`${stateHash}_${timestamp}.png`),
      (this.actor as any).grabTitle(),
      this.captureBrowserLogs(),
    ]);

    // Extract headings from HTML
    const headings = this.extractHeadings(html);

    // Save HTML to file
    const htmlFile = `${stateHash}_${timestamp}.html`;
    const htmlPath = join('output', htmlFile);
    fs.writeFileSync(htmlPath, html, 'utf8');

    // Save screenshot to file
    const screenshotFile = `${stateHash}_${timestamp}.png`;
    const screenshotPath = join('output', screenshotFile);
    if (screenshot) {
      fs.writeFileSync(screenshotPath, screenshot);
    }

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
      screenshot,
      title,
      url,
      browserLogs,
      htmlFile,
      screenshotFile,
      logFile,
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

    ['h1', 'h2', 'h3', 'h4'].forEach(tag => {
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

  async execute(codeString: string): Promise<Action> {
    let error: Error | null = null;

    setActivity(`🔎 Browsing...`, 'action');

    if (!codeString.startsWith('//'))
      tag('step').log(highlight(codeString, { language: 'javascript' }));
    try {
      this.action = codeString;
      debugLog('Executing action:', codeString);
      const codeFunction = new Function('I', codeString);
      codeFunction(this.actor);
      await recorder.promise();

      const pageState = await this.capturePageState();
      const result = new ActionResult({
        url: pageState.url,
        html: pageState.html,
        screenshot: pageState.screenshot
          ? fs.readFileSync(pageState.screenshot)
          : undefined,
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
    }

    return this;
  }

  async expect(codeString: string): Promise<Action> {
    this.expectation = codeString;
    log('Expecting', highlight(codeString, { language: 'javascript' }));
    try {
      debugLog('Executing expectation:', codeString);
      const codeFunction = new Function('I', codeString);
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
    }

    return this;
  }

  private async attempt(
    codeBlock: string,
    attempt: number,
    originalMessage: string
  ): Promise<boolean> {
    try {
      debugLog(`Resolution attempt ${attempt}`);

      const prevActionResult = this.actionResult;
      this.lastError = null;
      await this.execute(codeBlock);

      if (!this.expectation) {
        return true;
      }
      await this.expect(this.expectation!);

      tag('success').log('Resolved', this.expectation);
      await this.experienceTracker.saveSuccessfulResolution(
        prevActionResult!,
        originalMessage,
        codeBlock
      );

      return true;
    } catch (error) {
      tag('error').log(`Attempt ${attempt} failed with error:`, error);

      const executionError = errorToString(error);

      await this.experienceTracker.saveFailedAttempt(
        this.actionResult!,
        originalMessage,
        codeBlock,
        executionError,
        attempt
      );

      return false;
    }
  }

  private extractCodeBlocks(aiResponse: string): string[] {
    const codeBlockRegex = /```(?:js|javascript)?\s*\n([\s\S]*?)\n```/g;
    const codeBlocks: string[] = [];
    let match: RegExpExecArray | null = null;

    while ((match = codeBlockRegex.exec(aiResponse))) {
      const code = match[1].trim();
      if (!code) continue;
      try {
        new Function('I', code);
        codeBlocks.push(code);
      } catch {
        debugLog('Invalid JavaScript code block skipped:', code);
      }
    }

    return codeBlocks;
  }

  private async ask(
    message: string,
    actionResult: ActionResult
  ): Promise<string[]> {
    const aiResponse = await this.navigator?.resolveState(
      message,
      actionResult,
      this.stateManager.getCurrentContext()
    );

    return this.extractCodeBlocks(aiResponse || '');
  }

  async resolve(
    condition?: (result: ActionResult) => boolean,
    message?: string,
    maxAttempts?: number
  ): Promise<Action> {
    if (!this.lastError) return this;

    if (!maxAttempts) {
      maxAttempts = this.config.ai.maxAttempts || this.MAX_ATTEMPTS;
    }

    setActivity(`🤔 Thinking...`, 'action');

    let originalMessage = `
      I tried to do: ${this.action}
      And I expected that ${this.expectation}
      But the expectation failed with error: ${errorToString(this.lastError)}.

      ${message}
    `;

    debugLog('Original message:', originalMessage);

    log('Resolving', errorToString(this.lastError));

    const actionResult =
      this.actionResult ||
      ActionResult.fromState(this.stateManager.getCurrentState()!);

    if (condition && !condition(actionResult)) {
      debugLog('Condition', condition.toString());
      debugLog('Condition is false, skipping resolution');
      return this;
    }

    debugLog('Starting iterative resolution');

    let attempt = 0;
    const failedAttempts: Array<{
      attempt: number;
      code: string;
      error: string;
    }> = [];
    let codeBlocks: string[] = [];

    while (attempt < maxAttempts) {
      attempt++;

      if (codeBlocks.length === 0) {
        codeBlocks = await this.ask(originalMessage, actionResult);
        if (codeBlocks.length === 0) {
          break;
        }
      }

      const codeBlock = codeBlocks.shift()!;
      const success = await this.attempt(codeBlock, attempt, originalMessage);

      if (success) {
        tag('success').log('resolved', this.expectation);
        return this;
      }

      failedAttempts.push({
        attempt,
        code: codeBlock,
        error: this.lastError
          ? errorToString(this.lastError)
          : 'Expectation failed',
      });
    }

    const errorMessage = `Failed to resolve issue after ${maxAttempts} attempts. Original issue: ${originalMessage}. Please check the experience folder for details of failed attempts and resolve manually.`;
    
    debugLog(errorMessage);
    
    if (!this.userResolveFn) {
      throw new Error(errorMessage);
    }

    tag('warning').log(`Can't resolve ${this.expectation}. What should we do?`);
    tag('warning').log(`Provide CodeceptJS command starting with I. or a text to pass to AI`);
    setActivity(`🖐️ Waiting for user input...`, 'action');
    
    try {
      const userInput = await this.userResolveFn(this.lastError!);
      if (!userInput) {
        throw new Error(errorMessage);
      }
      if (userInput?.startsWith('I.')) {
        const success = await this.attempt(userInput, attempt + 1, originalMessage);
        if (success) {
          tag('success').log('resolved with user input', this.expectation);
          return this;
        }
      } else {        
        codeBlocks = await this.ask(userInput, actionResult);
      }
    } catch (error) {
      tag('error').log('Failed to resolve', this.expectation);
    }

    debugLog(errorMessage);
    throw new Error(errorMessage);
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

  getStateManager(): StateManager {
    return this.stateManager;
  }
}

export default Action;

function errorToString(error: any): string {
  if (error.cliMessage) {
    return error.cliMessage();
  }
  return error.message || error.toString();
}
