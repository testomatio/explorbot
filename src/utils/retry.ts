import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:retry');

export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryCondition?: (error: Error) => boolean;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryCondition: (error: Error) => {
    return error.name === 'AI_APICallError' || error.message.includes('schema') || error.message.includes('timeout') || error.message.includes('network') || error.message.includes('rate limit');
  },
};

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const config = { ...defaultOptions, ...options };
  let lastError: Error;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      if (attempt > 1) debugLog(`Attempt ${attempt}/${config.maxAttempts}`);
      return await operation();
    } catch (error) {
      lastError = error as Error;

      if (attempt === config.maxAttempts) {
        debugLog(`All ${config.maxAttempts} attempts failed`);
        throw lastError;
      }

      if (!config.retryCondition(lastError)) {
        debugLog('Error does not meet retry condition, not retrying');
        throw lastError;
      }

      const delay = Math.min(config.baseDelay * config.backoffMultiplier ** (attempt - 1), config.maxDelay);

      debugLog(`Retrying in ${delay}ms. Error: ${lastError.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
