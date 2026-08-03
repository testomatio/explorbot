import { describe, expect, test } from 'bun:test';
import { isFunctionExpression, toCodeceptWrapper } from '../src/pw-parser.ts';

describe('isFunctionExpression', () => {
  test.each([
    "({ page }) => page.click('text=Login')",
    "async ({ page }) => { await page.fill('#email', 'user@example.com'); await page.keyboard.press('Enter'); }",
    '({ browserContext }) => browserContext.clearCookies()',
    '({ page, browser }) => browser.version()',
    'function ({ page }) { return page.title() }',
  ])('accepts %s', (expr) => {
    expect(isFunctionExpression(expr).valid).toBe(true);
  });

  test.each(["page.click('text=Login')", "({ page }) => page.click('a'", 'just some text', ''])('rejects %s', (expr) => {
    const result = isFunctionExpression(expr);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('toCodeceptWrapper', () => {
  test('interpolates the function verbatim into usePlaywrightTo', () => {
    const code = toCodeceptWrapper("({ page }) => page.click('text=Login')");
    expect(code).toBe("I.usePlaywrightTo('pw', ({ page }) => page.click('text=Login'))");
  });
});
