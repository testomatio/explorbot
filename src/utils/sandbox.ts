const SHADOWED_GLOBALS = ['process', 'global', 'globalThis', 'fetch', 'Bun', 'require', 'module', 'exports'];
const ALLOWED_COMMAND_HEADS = ['I.', 'page.', 'await page.', 'await I.'];
const PLAYWRIGHT_COMMAND_HEADS = ['page.', 'await page.'];

export function sanitizeCodeBlock(code: string): string {
  return code
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ALLOWED_COMMAND_HEADS.some((head) => line.startsWith(head)))
    .join('\n');
}

export function hasPlaywrightCommands(code: string): boolean {
  return code.split('\n').some((line) => {
    const trimmed = line.trim();
    return PLAYWRIGHT_COMMAND_HEADS.some((head) => trimmed.startsWith(head));
  });
}

export function createSandboxedFunction(argNames: string[], body: string): (...args: any[]) => any {
  const fn = new Function(...argNames, ...SHADOWED_GLOBALS, `'use strict';\n${body}`);
  return (...args: any[]) => fn(...args);
}
