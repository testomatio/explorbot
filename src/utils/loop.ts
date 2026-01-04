import { executionController } from '../execution-controller.ts';
import { Observability } from '../observability.ts';
import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:loop');

export class StopError extends Error {
  constructor(message = 'Loop stopped') {
    super(message);
    this.name = 'StopError';
  }
}

export class InterruptError extends Error {
  userInput: string | null;
  constructor(userInput: string | null) {
    super('Loop interrupted by user');
    this.name = 'InterruptError';
    this.userInput = userInput;
  }
}

export interface LoopContext {
  stop: () => void;
  iteration: number;
  pause: (prompt?: string) => Promise<string | null>;
  userInput: string | null;
}

export interface CatchContext {
  error: Error;
  stop: () => void;
  iteration: number;
}

export interface LoopOptions {
  maxAttempts?: number;
  interruptible?: boolean;
  interruptPrompt?: string;
  onInterrupt?: (userInput: string | null, context: LoopContext) => Promise<void> | void;
  catch?: (context: CatchContext) => Promise<void> | void;
  observability?: {
    name?: string;
    agent?: string;
    sessionId?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
}

export async function pause(prompt?: string): Promise<string | null> {
  const message = prompt || 'Paused. Enter new instruction or press Enter to continue:';
  return await executionController.requestInput(message);
}

async function raceWithInterrupt<T>(promise: Promise<T>): Promise<{ result: T; interrupted: false } | { interrupted: true }> {
  const interruptPromise = executionController.waitForInterrupt().then(() => ({ interrupted: true as const }));
  const resultPromise = promise.then((result) => ({ result, interrupted: false as const }));

  return Promise.race([resultPromise, interruptPromise]);
}

export async function loop<T>(handler: (context: LoopContext) => Promise<T>, options?: LoopOptions): Promise<any> {
  const run = async () => {
    const maxAttempts = options?.maxAttempts ?? 5;
    const catchHandler = options?.catch;
    const interruptible = options?.interruptible ?? true;
    const interruptPrompt = options?.interruptPrompt;
    const onInterrupt = options?.onInterrupt;

    let result: any;
    let shouldStop = false;
    let pendingUserInput: string | null = null;

    const createStopFunction = () => () => {
      shouldStop = true;
      throw new StopError();
    };

    for (let iteration = 0; iteration < maxAttempts; iteration++) {
      try {
        if (iteration > 0) debugLog(`Loop iteration ${iteration + 1}/${maxAttempts}`);

        const context: LoopContext = {
          stop: createStopFunction(),
          iteration: iteration + 1,
          pause: (prompt?: string) => pause(prompt),
          userInput: pendingUserInput,
        };
        pendingUserInput = null;

        if (!interruptible) {
          result = await handler(context);
          continue;
        }

        const raceResult = await raceWithInterrupt(handler(context));

        if (raceResult.interrupted) {
          debugLog(`Loop interrupted at iteration ${iteration + 1}`);
          const userInput = await executionController.handleInterrupt(interruptPrompt);

          if (userInput === null || userInput.toLowerCase() === 'stop' || userInput.toLowerCase() === 'exit') {
            debugLog('User requested stop');
            shouldStop = true;
            return result;
          }

          pendingUserInput = userInput;

          if (onInterrupt) {
            await onInterrupt(userInput, context);
          }

          continue;
        }

        result = raceResult.result;
      } catch (error) {
        if (error instanceof StopError && shouldStop) {
          debugLog(`Loop stopped successfully at iteration ${iteration + 1}`);
          return result;
        }

        if (catchHandler) {
          try {
            const catchContext: CatchContext = {
              error: error as Error,
              stop: createStopFunction(),
              iteration: iteration + 1,
            };

            await catchHandler(catchContext);

            if (shouldStop) {
              debugLog(`Loop stopped via catch handler at iteration ${iteration + 1}`);
              return result;
            }
            continue;
          } catch (catchError) {
            if (catchError instanceof StopError && shouldStop) {
              debugLog(`Loop stopped via catch handler at iteration ${iteration + 1}`);
              return result;
            }
            throw catchError;
          }
        }

        debugLog(`Loop error at iteration ${iteration + 1}:`, error);
        throw error;
      }
    }

    return result;
  };

  const observability = options?.observability;
  if (!observability) {
    return run();
  }

  const name = observability.name || (observability.agent ? `${observability.agent}.loop` : 'loop');
  const tags = observability.tags ?? (observability.agent ? [observability.agent] : undefined);
  const baseMetadata = observability.metadata || {};
  const metadata = {
    ...baseMetadata,
    ...(observability.sessionId ? { sessionId: observability.sessionId } : {}),
    ...(tags ? { tags } : {}),
  };

  return Observability.run(name, metadata, run);
}
