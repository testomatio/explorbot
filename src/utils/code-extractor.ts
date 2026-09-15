import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:code-extractor');

const JS_LANGUAGES = new Set(['', 'js', 'javascript']);

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
