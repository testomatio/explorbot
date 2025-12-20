import { Observability } from '../observability.ts';
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
  pause: (context?: Record<string, unknown>) => Promise<void>;
}

export interface CatchContext {
  error: Error;
  stop: () => void;
  iteration: number;
}

export interface LoopOptions {
  maxAttempts?: number;
  catch?: (context: CatchContext) => Promise<void> | void;
  observability?: {
    name?: string;
    agent?: string;
    sessionId?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
  };
}

export async function pause(context: Record<string, unknown> = {}): Promise<void> {
  const iteration = context.iteration;
  if (typeof iteration === 'number') {
    console.log(`<PAUSED ${iteration}: Press Enter to continue>`);
  } else {
    console.log('<PAUSED: Press Enter to continue>');
  }
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.pause();
      resolve();
    });
  });
}

export async function loop<T>(handler: (context: LoopContext) => Promise<T>, options?: LoopOptions): Promise<any> {
  const run = async () => {
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
          pause: (context?: Record<string, unknown>) => pause({ iteration: iteration + 1, ...(context || {}) }),
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
