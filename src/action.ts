import fs from 'node:fs';
import { join } from 'node:path';
import * as codeceptjs from 'codeceptjs';
import { recorder } from 'codeceptjs';
import debug from 'debug';
import { ActionResult } from './action-result';
import type { PromptVocabulary } from './ai/prompt';
import type { ExperienceTracker } from './experience-tracker.js';
import { Path } from './path';
import { Transition } from './transition';
import { TransitionType } from './types/transition-type';

const debugLog = debug('explorbot:action');

class Action {
  private actor: CodeceptJS.I;
  private path: Path = new Path();
  private expectation: string | null = null;
  private promptVocabulary: PromptVocabulary | null = null;
  private actionError: Error | null = null;
  private lastError: ActionResult | null = null;
  private experienceTracker: ExperienceTracker | null = null;

  constructor(
    actor: CodeceptJS.I,
    promptVocabulary?: PromptVocabulary,
    experienceTracker?: ExperienceTracker
  ) {
    this.actor = actor;
    this.promptVocabulary = promptVocabulary || null;
    this.experienceTracker = experienceTracker || null;
  }

  private async capturePageState(): Promise<{
    html: string;
    url: string;
    screenshot: Buffer | null;
    title: string;
  }> {
    const [url, html, screenshot, title] = await Promise.all([
      (this.actor as any).grabCurrentUrl?.(),
      (this.actor as any).grabSource(),
      (this.actor as any).saveScreenshot(
        `${this.path.getCurrentState()?.getStateHash() || 'screenshot'}_${Date.now()}.png`
      ),
      (this.actor as any).grabTitle(),
    ]);

    debugLog('Page:', { url, title, html: html.substring(0, 100) });

    return { html, screenshot, title, url };
  }

  async execute(codeString: string): Promise<Action> {
    this.expectation = null;
    let error: Error | null = null;

    try {
      debugLog('Executing action:', codeString);
      const codeFunction = new Function('I', codeString);
      codeFunction(this.actor);
      await recorder.promise();
    } catch (err) {
      debugLog('Action error', errorToString(err));
      error = err as Error;
      await recorder.reset();
      await recorder.start();
    }

    const state = await this.capturePageState();
    const result = new ActionResult({
      url: state.url,
      html: state.html,
      screenshot: state.screenshot
        ? fs.readFileSync(state.screenshot)
        : undefined,
      title: state.title,
      error: error ? errorToString(error) : null,
    });
    
    // Save HTML output to output folder using state hash as filename
    this.saveHtmlOutput(result);
    
    const transition = new Transition(
      TransitionType.ACTION,
      codeString,
      error ? errorToString(error) : null
    );
    if (error) this.actionError = error;
    this.path.addStep(this.path.getCurrentState(), transition, result);

    return this;
  }

  async expect(codeString: string): Promise<Action> {
    this.expectation = codeString;
    try {
      debugLog('Executing expectation:', codeString);
      const codeFunction = new Function('I', codeString);
      codeFunction(this.actor);
      await recorder.promise();
      debugLog('Expectation executed successfully');
    } catch (err) {
      await recorder.reset();
      await recorder.start();
      debugLog('Expectation failed:', errorToString(err));
      this.lastError = err;
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

      await this.execute(codeBlock);

      const previousExpectation = this.expectation;
      if (previousExpectation) {
        await this.expect(previousExpectation);

        if (!this.lastError) {
          debugLog(`Resolution succeeded on attempt ${attempt}`);

          if (this.experienceTracker) {
            await this.experienceTracker.saveSuccessfulResolution(
              this.path.getCurrentState()!,
              originalMessage,
              codeBlock,
              attempt
            );
          }

          return true;
        }
      }

      if (this.experienceTracker) {
        await this.experienceTracker.saveFailedAttempt(
          this.path.getCurrentState()!,
          originalMessage,
          codeBlock,
          this.actionError ? errorToString(this.actionError) : null,
          this.lastError ? errorToString(this.lastError) : null,
          attempt
        );
      }

      return false;
    } catch (error) {
      debugLog(`Attempt ${attempt} failed with error:`, error);

      const executionError = errorToString(error);

      if (this.experienceTracker) {
        await this.experienceTracker.saveFailedAttempt(
          this.path.getCurrentState()!,
          originalMessage,
          codeBlock,
          executionError,
          this.lastError ? errorToString(this.lastError) : null,
          attempt
        );
      }

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
    originalMessage: string,
    failedAttempts: Array<{ attempt: number; code: string; error: string }>
  ): Promise<string[]> {
    if (!this.promptVocabulary) {
      return [];
    }

    let contextMessage = originalMessage;

    // Add experience context from similar pages
    if (this.experienceTracker) {
      const currentState = this.path.getCurrentState();
      if (currentState?.url) {
        const experience = await this.experienceTracker.getExperienceByUrl(
          currentState.url
        );
        if (experience) {
          contextMessage = `${originalMessage}

<experience>
Here is previous experience from this page that might help:

${experience}
</experience>`;
        }
      }
    }

    if (failedAttempts.length > 0) {
      const failureContext = failedAttempts
        .map((fa) => `Attempt ${fa.attempt}: \`${fa.code}\` → ${fa.error}`)
        .join('\n');

      contextMessage = `${contextMessage}

Previous failed attempts in current session:
${failureContext}

Please analyze the previous failures and provide a different approach.`;
    }

    const aiResponse = await this.promptVocabulary.resolveState(
      this.path.getCurrentState()!,
      contextMessage
    );

    return this.extractCodeBlocks(aiResponse);
  }

  async resolve(
    condition: (result: ActionResult) => boolean,
    message: string,
    maxAttempts = process.env.MAX_ATTEMPTS || 5
  ): Promise<Action> {
    if (!this.lastError) return this;

    const originalMessage = `I expected ${this.expectation} but got ${errorToString(this.lastError)}. To resolve the error: ${errorToString(this.lastError)} follow the instructions: ${message}`;

    debugLog('Resolving error', errorToString(this.lastError));
    debugLog('Current state', this.path.getCurrentState()?.toAiContext());
    debugLog('Condition', condition.toString());

    if (!this.promptVocabulary) {
      debugLog('No prompt vocabulary provided');
      return this;
    }

    if (!condition(this.path.getCurrentState()!)) {
      debugLog('Condition is false, skipping resolution');
      return this;
    }

    debugLog('Condition is true, starting iterative resolution');

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
        codeBlocks = await this.ask(originalMessage, failedAttempts);
        if (codeBlocks.length === 0) {
          break;
        }
      }

      const codeBlock = codeBlocks.shift()!;
      const success = await this.attempt(codeBlock, attempt, originalMessage);

      if (success) {
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
    throw new Error(errorMessage);
  }

  private saveHtmlOutput(result: ActionResult): void {
    try {
      const outputDir = 'output';
      const stateHash = result.getStateHash();
      const filename = `${stateHash}.html`;
      const filePath = join(outputDir, filename);

      // Ensure output directory exists
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Save HTML content to file
      fs.writeFileSync(filePath, result.html, 'utf8');
      debugLog(`HTML saved to: ${filePath}`);
    } catch (error) {
      debugLog('Failed to save HTML output:', error);
    }
  }

  getPath(): Path {
    return this.path;
  }

  getActor(): CodeceptJS.I {
    return this.actor;
  }

  setActor(actor: CodeceptJS.I): void {
    this.actor = actor;
  }

  setExperienceTracker(tracker: ExperienceTracker): void {
    this.experienceTracker = tracker;
  }
}

export default Action;

function errorToString(error: any): string {
  if (error.inspect) {
    return error.inspect();
  }
  return error.message || error.toString();
}
