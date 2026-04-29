import type { ActionResult } from '../action-result.js';
import { isBodyEmpty } from './html.js';

const HTTP_ERRORS = ['400 Bad Request', '401 Unauthorized', '403 Forbidden', '404 Not Found', '405 Method Not Allowed', '408 Request Timeout', '500 Internal Server Error', '502 Bad Gateway', '503 Service Unavailable', '504 Gateway Timeout'];

const SMALL_PAGE_THRESHOLD = 500;
const LOADING_WORD = /\bloading\b/i;

export type PageCondition = 'ok' | 'loading' | 'error';

export function detectPageCondition(actionResult: ActionResult): PageCondition {
  const headingFields = [actionResult.title, actionResult.h1, actionResult.h2].filter(Boolean) as string[];

  for (const field of headingFields) {
    for (const error of HTTP_ERRORS) {
      if (field.toLowerCase().includes(error.toLowerCase())) return 'error';
    }
  }

  const aria = actionResult.ariaSnapshot || '';
  if (/\bprogressbar\b/i.test(aria)) return 'loading';
  if (/\[busy\]/.test(aria)) return 'loading';

  for (const field of headingFields) {
    if (LOADING_WORD.test(field)) return 'loading';
  }

  if (!actionResult.html || isBodyEmpty(actionResult.html)) return 'loading';

  const bodyMatch = actionResult.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1].trim().length < SMALL_PAGE_THRESHOLD) return 'loading';

  return 'ok';
}

export function isErrorPage(actionResult: ActionResult): boolean {
  return detectPageCondition(actionResult) === 'error';
}

export class ErrorPageError extends Error {
  constructor(
    public readonly url: string,
    public readonly title?: string
  ) {
    super(`Error page detected at ${url}${title ? ` (${title})` : ''}`);
    this.name = 'ErrorPageError';
  }
}
