import { EventEmitter } from 'node:events';
import * as readline from 'node:readline';
import { clearActivity } from './activity.ts';

export type InputCallback = (prompt: string) => Promise<string | null>;

export class ExecutionController extends EventEmitter {
  private static instance: ExecutionController;
  private interrupted = false;
  private inputCallback: InputCallback | null = null;
  private interruptResolvers: Array<() => void> = [];
  private abortController: AbortController | null = null;

  private constructor() {
    super();
  }

  static getInstance(): ExecutionController {
    if (!ExecutionController.instance) {
      ExecutionController.instance = new ExecutionController();
    }
    return ExecutionController.instance;
  }

  setInputCallback(callback: InputCallback): void {
    this.inputCallback = callback;
  }

  startExecution(): void {
    this.interrupted = false;
    this.abortController = new AbortController();
  }

  getAbortSignal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }

  interrupt(): void {
    clearActivity();
    if (this.interrupted) return;
    this.interrupted = true;
    this.abortController?.abort();
    this.emit('interrupt');
    for (const resolve of this.interruptResolvers) {
      resolve();
    }
    this.interruptResolvers = [];
    this.emit('idle');
  }

  isInterrupted(): boolean {
    return this.interrupted;
  }

  waitForInterrupt(): Promise<void> {
    if (this.interrupted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.interruptResolvers.push(resolve);
    });
  }

  async checkInterrupt(): Promise<string | null> {
    if (!this.interrupted) return null;

    const userInput = await this.requestInput('Execution interrupted. What should we do instead?');
    this.interrupted = false;
    return userInput;
  }

  async handleInterrupt(prompt?: string): Promise<string | null> {
    const message = prompt || 'Execution interrupted. Enter new instruction (or "stop"/"exit" to cancel):';
    const userInput = await this.requestInput(message);
    this.interrupted = false;
    return userInput;
  }

  async requestInput(prompt: string): Promise<string | null> {
    if (this.inputCallback) {
      return await this.inputCallback(prompt);
    }

    return await this.readlineInput(prompt);
  }

  private async readlineInput(prompt: string): Promise<string | null> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<string | null>((resolve) => {
      rl.question(`${prompt}\n> `, (answer) => {
        rl.close();
        const trimmed = answer.trim();
        resolve(trimmed || null);
      });
    });
  }

  reset(): void {
    this.interrupted = false;
    this.interruptResolvers = [];
    this.abortController = null;
  }
}

export const executionController = ExecutionController.getInstance();
