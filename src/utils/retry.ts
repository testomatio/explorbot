import { createDebug, tag } from './logger.js';

const debugLog = createDebug('explorbot:retry');

const RATE_LIMIT_DELAYS = [10_000, 20_000, 30_000, 60_000, 90_000];
const RATE_LIMIT_MAX_ATTEMPTS = RATE_LIMIT_DELAYS.length + 1;

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
    return error.constructor.name === 'AI_APICallError' || error.message.includes('schema') || error.message.includes('timeout') || error.message.includes('network') || error.message.includes('rate limit') || error.message.includes('Failed to generate JSON');
  },
};

function isRateLimitError(error: Error): boolean {
  return error.message.toLowerCase().includes('rate limit');
}

export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const config = { ...defaultOptions, ...options };
  let lastError: Error;
  let rateLimitAttempt = 0;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      if (attempt > 1) debugLog(`Attempt ${attempt}/${config.maxAttempts}`);
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.name === 'AbortError') {
        throw lastError;
      }

      if (isRateLimitError(lastError) && rateLimitAttempt < RATE_LIMIT_DELAYS.length) {
        const delay = RATE_LIMIT_DELAYS[rateLimitAttempt];
        tag('warning').log(`Rate limit hit, waiting ${delay / 1000}s before retry (${rateLimitAttempt + 1}/${RATE_LIMIT_MAX_ATTEMPTS})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        rateLimitAttempt++;
        attempt--;
        continue;
      }

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
