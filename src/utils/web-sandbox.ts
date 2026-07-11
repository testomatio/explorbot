import { faker } from '@faker-js/faker';
import { hopeThat, retryTo, tryTo, within } from 'codeceptjs/lib/effects';
import step from 'codeceptjs/steps';

const SHADOWED_GLOBALS = ['process', 'global', 'globalThis', 'fetch', 'Bun', 'require', 'module', 'exports'];
const ALLOWED_COMMAND_HEADS = ['I.', 'page.', 'await page.', 'await I.'];
const PLAYWRIGHT_COMMAND_HEADS = ['page.', 'await page.'];
const PLAYWRIGHT_ARG_NAMES = ['page'];
const CODECEPT_ARG_NAMES = ['I', 'tryTo', 'retryTo', 'within', 'hopeThat', 'step', 'faker'];

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

export function playwrightSandbox(page: any, code: string): Promise<any> {
  const run = createSandbox(PLAYWRIGHT_ARG_NAMES, `return (async () => { ${code} })()`);
  return run(page);
}

export function codeceptJSSandbox(actor: any, codeOrFn: string | ((...args: any[]) => void)): void {
  if (typeof codeOrFn === 'function') {
    codeOrFn(actor, tryTo, retryTo, within, hopeThat, step, faker);
    return;
  }
  const run = createSandbox(CODECEPT_ARG_NAMES, codeOrFn);
  run(actor, tryTo, retryTo, within, hopeThat, step, faker);
}

function createSandbox(argNames: string[], body: string): (...args: any[]) => any {
  const fn = new Function(...argNames, ...SHADOWED_GLOBALS, `'use strict';\n${body}`);
  return (...args: any[]) => fn(...args);
}
