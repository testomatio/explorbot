import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:code-extractor');

export function extractCodeBlocks(aiResponse: string): string[] {
  const codeBlockRegex = /```(?:js|javascript)?\s*\n([\s\S]*?)\n```/g;
  const codeBlocks: string[] = [];
  let match: RegExpExecArray | null = null;

  while ((match = codeBlockRegex.exec(aiResponse))) {
    const code = match[1].trim();
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
