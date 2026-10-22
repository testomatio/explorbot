import { ActionResult } from '../action-result.js';
import type { WebPageState } from '../state-manager.js';
import { isBodyEmpty } from './html.js';
import { extractStatePath } from './url-matcher.js';

const HTTP_ERRORS = ['400 Bad Request', '401 Unauthorized', '403 Forbidden', '404 Not Found', '405 Method Not Allowed', '408 Request Timeout', '500 Internal Server Error', '502 Bad Gateway', '503 Service Unavailable', '504 Gateway Timeout'];

const SMALL_PAGE_THRESHOLD = 500;
const LOADING_WORD = /\bloading\b/i;
const PASSWORD_INPUT = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const AUTH_PATH = /\b(log[-_]?in|sign[-_]?in|auth)\b/i;

export type PageCondition = 'ok' | 'loading' | 'error';

export function detectPageCondition(actionResult: ActionResult): PageCondition {
  return diagnosePage(actionResult).condition;
}

export function diagnosePage(actionResult: ActionResult): PageDiagnosis {
  if (actionResult.httpStatus && actionResult.httpStatus >= 400) return { condition: 'error', reason: `server responded with HTTP ${actionResult.httpStatus}` };

  const headingFields = [actionResult.title, actionResult.h1, actionResult.h2].filter(Boolean) as string[];

  for (const field of headingFields) {
    for (const error of HTTP_ERRORS) {
      if (field.toLowerCase().includes(error.toLowerCase())) return { condition: 'error', reason: `page heading says "${field}"` };
    }
  }

  const aria = actionResult.ariaSnapshot || '';
  if (/\bprogressbar\b/i.test(aria)) return { condition: 'loading', reason: 'a progress bar is still shown' };
  if (/\[busy\]/.test(aria)) return { condition: 'loading', reason: 'an element is still marked busy' };

  for (const field of headingFields) {
    if (LOADING_WORD.test(field)) return { condition: 'loading', reason: `page heading says "${field}"` };
  }

  if (!actionResult.html || isBodyEmpty(actionResult.html)) return { condition: 'loading', reason: 'page body is empty' };

  const bodyMatch = actionResult.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1].trim().length < SMALL_PAGE_THRESHOLD) return { condition: 'loading', reason: `page body has under ${SMALL_PAGE_THRESHOLD} characters of content` };

  return { condition: 'ok', reason: '' };
}

export function isErrorPage(actionResult: ActionResult): boolean {
  return detectPageCondition(actionResult) === 'error';
}

export function isLoginPage(actionResult: ActionResult): boolean {
  if (PASSWORD_INPUT.test(actionResult.html || '')) return true;
  return AUTH_PATH.test(extractStatePath(actionResult.url || '').split('?')[0]);
}

export function getStateErrorPageError(state: WebPageState | null | undefined): ErrorPageError | null {
  if (!state) return null;
  const actionResult = ActionResult.fromState(state);
  if (!isErrorPage(actionResult)) return null;
  return new ErrorPageError(actionResult.url, actionResult.title, actionResult.httpStatus);
}

export class ErrorPageError extends Error {
  constructor(
    public readonly url: string,
    public readonly title?: string,
    public readonly httpStatus?: number
  ) {
    const status = httpStatus ? `HTTP ${httpStatus}` : '';
    const details = [status, title].filter(Boolean).join(', ');
    super(`Error page detected at ${url}${details ? ` (${details})` : ''}`);
    this.name = 'ErrorPageError';
  }
}

interface PageDiagnosis {
  condition: PageCondition;
  reason: string;
}
