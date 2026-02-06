import type { ActionResult } from '../action-result.js';
import { isBodyEmpty } from './html.js';

export type ErrorPageResult = {
  isError: boolean;
  type?: '404' | '500' | '503' | '502' | '403' | 'empty';
};

const ERROR_PATTERNS: { pattern: RegExp; type: '404' | '500' | '503' | '502' | '403' }[] = [
  { pattern: /\b404\b/, type: '404' },
  { pattern: /\b500\b/, type: '500' },
  { pattern: /\b503\b/, type: '503' },
  { pattern: /\b502\b/, type: '502' },
  { pattern: /\b403\b/, type: '403' },
];

const SMALL_PAGE_THRESHOLD = 500;

export function isErrorPage(actionResult: ActionResult): ErrorPageResult {
  const checkFields = [actionResult.title, actionResult.h1, actionResult.h2].filter(Boolean);

  for (const field of checkFields) {
    for (const { pattern, type } of ERROR_PATTERNS) {
      if (pattern.test(field!)) {
        return { isError: true, type };
      }
    }
  }

  if (!actionResult.html || isBodyEmpty(actionResult.html)) {
    return { isError: true, type: 'empty' };
  }

  const bodyMatch = actionResult.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1].trim().length < SMALL_PAGE_THRESHOLD) {
    return { isError: true, type: 'empty' };
  }

  return { isError: false };
}
