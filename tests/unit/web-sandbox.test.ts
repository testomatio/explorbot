import { describe, expect, it } from 'bun:test';
import { codeceptJSSandbox, playwrightSandbox, sanitizeCodeBlock } from '../../src/utils/web-sandbox';

describe('sanitizeCodeBlock', () => {
  it('keeps allowed command heads', () => {
    const code = ["I.click('Save')", "page.click('#x')", "await page.waitForLoadState('load')", "await I.click('x')"].join('\n');
    expect(sanitizeCodeBlock(code)).toBe(code);
  });

  it('drops arbitrary host expressions and non-command lines', () => {
    const code = ["await fetch('http://evil')", "await import('node:fs')", 'const x = 1', "require('fs')", '', "I.click('Save')"].join('\n');
    expect(sanitizeCodeBlock(code)).toBe("I.click('Save')");
  });

  it('keeps only allowed lines preserving order', () => {
    const code = ["I.amOnPage('/login')", 'const x = 1', "page.fill('#user', 'admin')", "await fetch('http://evil')", "await page.click('#submit')"].join('\n');
    expect(sanitizeCodeBlock(code)).toBe(["I.amOnPage('/login')", "page.fill('#user', 'admin')", "await page.click('#submit')"].join('\n'));
  });
});

describe('playwrightSandbox', () => {
  it('shadows host globals to undefined', async () => {
    expect(await playwrightSandbox(null, 'return typeof process')).toBe('undefined');
    expect(await playwrightSandbox(null, 'return typeof Bun')).toBe('undefined');
    expect(await playwrightSandbox(null, 'return typeof fetch')).toBe('undefined');
    expect(await playwrightSandbox(null, 'return typeof globalThis')).toBe('undefined');
  });

  it('throws on implicit global writes under strict mode', async () => {
    await expect(playwrightSandbox(null, 'x = 1')).rejects.toThrow();
  });
});

describe('codeceptJSSandbox', () => {
  it('runs I.* commands against the actor', () => {
    const calls: string[] = [];
    const actor = {
      click: (target: string) => {
        calls.push(target);
      },
    };
    codeceptJSSandbox(actor, "I.click('Save')");
    expect(calls).toEqual(['Save']);
  });

  it('shadows host globals so code cannot reach process', () => {
    expect(() => codeceptJSSandbox({}, 'process.exit(1)')).toThrow();
  });

  it('runs a passed function with the actor', () => {
    const calls: string[] = [];
    codeceptJSSandbox({ click: (t: string) => calls.push(t) }, (I: any) => I.click('Cancel'));
    expect(calls).toEqual(['Cancel']);
  });
});
