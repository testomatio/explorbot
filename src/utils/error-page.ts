import dedent from 'dedent';
import { ActionResult } from '../action-result.js';
import type { WebPageState } from '../state-manager.js';
import { isBodyEmpty, sanitizeHtmlString } from './html.js';
import { extractStatePath } from './url-matcher.js';

const HTTP_ERRORS = ['400 Bad Request', '401 Unauthorized', '403 Forbidden', '404 Not Found', '405 Method Not Allowed', '408 Request Timeout', '500 Internal Server Error', '502 Bad Gateway', '503 Service Unavailable', '504 Gateway Timeout'];

const SMALL_PAGE_THRESHOLD = 500;
const LOADING_WORD = /\bloading\b/i;
const PASSWORD_INPUT = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const AUTH_PATH = /\b(log[-_]?in|sign[-_]?in|auth)\b/i;

export type PageCondition = 'ok' | 'loading' | 'error';

export function detectPageCondition(actionResult: ActionResult): PageCondition {
  if (actionResult.httpStatus && actionResult.httpStatus >= 400) return 'error';

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

  const bodyMatch = sanitizeHtmlString(actionResult.html).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1].trim().length < SMALL_PAGE_THRESHOLD) return 'loading';

  return 'ok';
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

export class BlockedError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly blocker: string,
    public readonly request: string
  ) {
    super(message);
    this.name = 'BlockedError';
  }
}

export class PlanningBlockedError extends BlockedError {
  constructor(
    url: string,
    prerequisite: string,
    public readonly feature?: string,
    public readonly style?: string
  ) {
    let focus = '';
    if (feature) focus = ` focused on "${feature}"`;
    let styleNote = '';
    if (style) styleNote = ` in ${style} style`;
    super(
      `Planner could not plan ${url}: ${prerequisite}`,
      url,
      prerequisite,
      dedent`
        Planner was asked to plan tests for ${url}${focus}${styleNote} but stopped: ${prerequisite}.
        Look at the current page to find out what blocks planning, resolve it, then call plan() to re-plan this page. If it cannot be resolved, finish without planning.
      `
    );
    this.name = 'PlanningBlockedError';
  }
}

export class NavigationBlockedError extends BlockedError {
  constructor(url: string, currentUrl: string, reason: string, cause: string, tried: string[]) {
    const lines = [`Navigator was asked to open ${url} but stopped on ${currentUrl}: ${cause}.`];
    if (tried.length) lines.push(`Already tried: ${tried.join('; ')}.`);
    lines.push(`Look at the current page to find out what keeps it from ${url}, resolve it, then open ${url}. If it cannot be resolved, finish without opening it.`);
    super(`Navigation to ${url} failed: ${reason}`, url, cause, lines.join('\n'));
    this.name = 'NavigationBlockedError';
  }
}

export class TestStartBlockedError extends BlockedError {
  constructor(scenario: string, url: string, currentUrl: string) {
    super(
      `Test "${scenario}" could not start: ${currentUrl} is not the page it starts on`,
      url,
      'not the start page of this test',
      dedent`
        Tester was asked to start the test "${scenario}" at ${url}, but the page open at ${currentUrl} is not where this test can start.
        Look at the current page to find out what keeps the test from starting, resolve it, then open ${url}. When you finish, the test runs again from ${url}. If it cannot be resolved, finish and the test is skipped.
      `
    );
    this.name = 'TestStartBlockedError';
  }
}
