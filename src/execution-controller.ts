import { EventEmitter } from 'node:events';
import * as readline from 'node:readline';

export type InputCallback = (prompt: string) => Promise<string | null>;

export class ExecutionController extends EventEmitter {
  private static instance: ExecutionController;
  private interrupted = false;
  private inputCallback: InputCallback | null = null;

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

  interrupt(): void {
    if (this.interrupted) return;
    this.interrupted = true;
    this.emit('interrupt');
  }

  isInterrupted(): boolean {
    return this.interrupted;
  }

  async checkInterrupt(): Promise<string | null> {
    if (!this.interrupted) return null;

    const userInput = await this.requestInput('Execution interrupted. What should we do instead?');
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
  }
}

export const executionController = ExecutionController.getInstance();
