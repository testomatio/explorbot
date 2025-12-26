import { EventEmitter } from 'node:events';
import { tag } from './utils/logger.ts';

export type InterruptCallback = () => Promise<string | null>;

export class ExecutionController extends EventEmitter {
  private static instance: ExecutionController;
  private interrupted = false;
  private interruptCallback: InterruptCallback | null = null;
  private pendingInterruptResolve: ((input: string | null) => void) | null = null;

  private constructor() {
    super();
  }

  static getInstance(): ExecutionController {
    if (!ExecutionController.instance) {
      ExecutionController.instance = new ExecutionController();
    }
    return ExecutionController.instance;
  }

  setInterruptCallback(callback: InterruptCallback): void {
    this.interruptCallback = callback;
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

    tag('warning').log('Execution interrupted. What should we do instead?');

    if (!this.interruptCallback) {
      this.interrupted = false;
      return null;
    }

    const userInput = await this.interruptCallback();
    this.interrupted = false;
    return userInput;
  }

  resume(input: string | null): void {
    if (this.pendingInterruptResolve) {
      this.pendingInterruptResolve(input);
      this.pendingInterruptResolve = null;
    }
    this.interrupted = false;
  }

  reset(): void {
    this.interrupted = false;
    this.pendingInterruptResolve = null;
  }
}

export const executionController = ExecutionController.getInstance();
