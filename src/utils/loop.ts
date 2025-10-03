import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:loop');

export class StopError extends Error {
  constructor(message = 'Loop stopped') {
    super(message);
    this.name = 'StopError';
  }
}

export interface LoopContext {
  stop: () => void;
  iteration: number;
}

export interface CatchContext {
  error: Error;
  stop: () => void;
  iteration: number;
}

export interface LoopOptions {
  maxAttempts?: number;
  catch?: (context: CatchContext) => Promise<void> | void;
}

export async function loop<T>(handler: (context: LoopContext) => Promise<T>, options?: LoopOptions): Promise<any> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const catchHandler = options?.catch;

  let result: any;
  let shouldStop = false;

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
      };

      result = await handler(context);
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
}
