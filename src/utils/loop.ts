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

export async function loop<T>(
  request: () => Promise<T>,
  handler: (context: LoopContext) => Promise<T | void>,
  maxIterations = 3
): Promise<T> {
  let result: T | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    try {
      debugLog(`Loop iteration ${iteration + 1}/${maxIterations}`);

      const context: LoopContext = {
        stop: () => {
          throw new StopError();
        },
        iteration: iteration + 1,
      };

      // Call request first to get the result
      const requestResult = await request();

      // Then call handler with the result
      let handlerResult: T | void;
      try {
        handlerResult = await handler(context);
      } catch (error) {
        if (error instanceof StopError) {
          // If handler returned a value before stopping, use it, otherwise use request result
          result = handlerResult !== undefined ? handlerResult : requestResult;
          throw error;
        }
        throw error;
      }

      // If handler returns a value, use it as result, otherwise use request result
      result = handlerResult !== undefined ? handlerResult : requestResult;

      // If we reach here, continue to next iteration unless it's the last one
      if (iteration === maxIterations - 1) {
        return result!;
      }
    } catch (error) {
      if (error instanceof StopError) {
        debugLog(`Loop stopped successfully at iteration ${iteration + 1}`);
        if (result !== undefined) {
          return result;
        }
        throw new Error('Loop stopped but no result available');
      }

      debugLog(`Loop error at iteration ${iteration + 1}:`, error);
      throw error;
    }
  }

  if (result !== undefined) {
    return result;
  }

  throw new Error(`Loop completed ${maxIterations} iterations without result`);
}
