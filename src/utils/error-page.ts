import type { ActionResult } from '../action-result.js';
import { isBodyEmpty } from './html.js';

const HTTP_ERRORS = ['400 Bad Request', '401 Unauthorized', '403 Forbidden', '404 Not Found', '405 Method Not Allowed', '408 Request Timeout', '500 Internal Server Error', '502 Bad Gateway', '503 Service Unavailable', '504 Gateway Timeout'];

const SMALL_PAGE_THRESHOLD = 500;

export function isErrorPage(actionResult: ActionResult): boolean {
  const checkFields = [actionResult.title, actionResult.h1, actionResult.h2].filter(Boolean) as string[];

  for (const field of checkFields) {
    for (const error of HTTP_ERRORS) {
      if (field.toLowerCase().includes(error.toLowerCase())) return true;
    }
  }

  if (!actionResult.html || isBodyEmpty(actionResult.html)) return true;

  const bodyMatch = actionResult.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1].trim().length < SMALL_PAGE_THRESHOLD) return true;

  return false;
}
