import { describe, expect, it } from 'bun:test';
import { createSandboxedFunction, sanitizeCodeBlock } from '../../src/action';

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

describe('createSandboxedFunction', () => {
  it('shadows process to undefined', () => {
    expect(createSandboxedFunction([], 'return typeof process')()).toBe('undefined');
  });

  it('shadows Bun to undefined', () => {
    expect(createSandboxedFunction([], 'return typeof Bun')()).toBe('undefined');
  });

  it('shadows fetch to undefined', () => {
    expect(createSandboxedFunction([], 'return typeof fetch')()).toBe('undefined');
  });

  it('shadows globalThis to undefined', () => {
    expect(createSandboxedFunction([], 'return typeof globalThis')()).toBe('undefined');
  });

  it('shadows process inside the async Playwright wrapper', async () => {
    const result = await createSandboxedFunction(['page'], 'return (async () => { return typeof process })()')(null);
    expect(result).toBe('undefined');
  });

  it('throws on implicit global writes under strict mode', () => {
    expect(() => createSandboxedFunction([], 'x = 1')()).toThrow();
  });

  it('passes through named arguments', () => {
    const calls: string[] = [];
    const I = {
      click: (target: string) => {
        calls.push(target);
      },
    };
    createSandboxedFunction(['I'], "I.click('Save')")(I);
    expect(calls).toEqual(['Save']);
  });
});
