import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:code-extractor');

const JS_LANGUAGES = new Set(['', 'js', 'javascript']);
const QUOTES = ["'", '"', '`'];
const OPENING_BRACKETS = ['(', '[', '{'];
const CLOSING_BRACKETS = [')', ']', '}'];

export function extractCodeBlocks(aiResponse: string): string[] {
  const codeBlockRegex = /```([^\n`]*)\n([\s\S]*?)\n```/g;
  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = codeBlockRegex.exec(aiResponse))) {
    const language = match[1].trim().toLowerCase();
    if (!JS_LANGUAGES.has(language)) continue;
    const code = match[2].trim();
    if (!code) continue;
    try {
      new Function('I', code);
      codeBlocks.push(code);
    } catch {
      debugLog('Invalid JavaScript code block skipped:', code);
    }
  }

  return codeBlocks;
}

export function splitTopLevel(code: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let quote = '';

  for (let i = 0; i < code.length; i++) {
    const char = code[i];

    if (quote) {
      current += char;
      if (char === '\\') current += code[++i] || '';
      if (char === quote) quote = '';
      continue;
    }

    if (char === '/' && code[i + 1] === '/') {
      while (i + 1 < code.length && code[i + 1] !== '\n') i++;
      continue;
    }

    if (char === separator && depth <= 0) {
      parts.push(current);
      current = '';
      depth = 0;
      continue;
    }

    current += char;
    if (QUOTES.includes(char)) quote = char;
    if (OPENING_BRACKETS.includes(char)) depth++;
    if (CLOSING_BRACKETS.includes(char)) depth--;
  }

  parts.push(current);
  return parts;
}
