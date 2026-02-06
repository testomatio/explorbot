import type { ActionResult } from '../action-result.js';
import { isBodyEmpty } from './html.js';

const ERROR_CODE_PATTERNS: RegExp[] = [
  /\b404\b.*?(error|not\s*found)/i,
  /(error|not\s*found).*?\b404\b/i,
  /^404$/i,

  /\b500\b.*?(error|server|internal)/i,
  /(error|server|internal).*?\b500\b/i,
  /^500$/i,

  /\b502\b.*?(error|gateway|bad)/i,
  /(error|gateway|bad).*?\b502\b/i,
  /^502$/i,

  /\b503\b.*?(error|service|unavailable)/i,
  /(error|service|unavailable).*?\b503\b/i,
  /^503$/i,

  /\b403\b.*?(error|forbidden|denied|access)/i,
  /(error|forbidden|denied|access).*?\b403\b/i,
  /^403$/i,
];

const ERROR_TEXT_PATTERNS: RegExp[] = [
  /\bpage\s*not\s*found\b/i,
  /\bnot\s*found\b/i,
  /\binternal\s*server\s*error\b/i,
  /\bserver\s*error\b/i,
  /\bservice\s*unavailable\b/i,
  /\bbad\s*gateway\b/i,
  /\baccess\s*denied\b/i,
  /\bforbidden\b/i,
  /\bsomething\s*went\s*wrong\b/i,
  /\boops\b/i,
  /\ban?\s*error\s*(has\s*)?(occurred|happened)\b/i,
  /^error$/i,
];

const SMALL_PAGE_THRESHOLD = 500;

export function isErrorPage(actionResult: ActionResult): boolean {
  const checkFields = [actionResult.title, actionResult.h1, actionResult.h2].filter(Boolean) as string[];

  for (const field of checkFields) {
    for (const pattern of ERROR_CODE_PATTERNS) {
      if (pattern.test(field)) return true;
    }
  }

  for (const field of checkFields) {
    for (const pattern of ERROR_TEXT_PATTERNS) {
      if (pattern.test(field)) return true;
    }
  }

  if (!actionResult.html || isBodyEmpty(actionResult.html)) return true;

  const bodyMatch = actionResult.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1].trim().length < SMALL_PAGE_THRESHOLD) return true;

  return false;
}
