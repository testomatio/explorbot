import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { annotatePageElements } from '../../src/explorer.ts';
import type { WebElement } from '../../src/utils/web-element.ts';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

describe('annotateElements ARIA+HTML consistency', () => {
  describe('checkout.html', () => {
    let page: Page;
    let ariaSnapshot: string;
    let elements: WebElement[];
    let domEidxValues: string[];

    beforeAll(async () => {
      page = await browser.newPage();
      await page.goto(`file://${join(process.cwd(), 'test-data', 'checkout.html')}`, { waitUntil: 'domcontentloaded' });
      const result = await annotatePageElements(page);
      ariaSnapshot = result.ariaSnapshot;
      elements = result.elements;
      domEidxValues = await page.evaluate(() => Array.from(document.querySelectorAll('[data-explorbot-eidx]')).map((el) => el.getAttribute('data-explorbot-eidx')!));
    });

    afterAll(async () => {
      await page?.close();
    });

    it('annotates interactive elements', () => {
      expect(elements.length).toBeGreaterThan(0);
    });

    it('every element has a role', () => {
      const noRole = elements.filter((e) => !e.role);
      expect(noRole).toEqual([]);
    });

    it('no duplicate eidx values', () => {
      expect(new Set(domEidxValues).size).toBe(domEidxValues.length);
    });

    it('Redeem button: eidx and role match ARIA', async () => {
      const eidx = await page.locator('button.btn-secondary').getAttribute('data-explorbot-eidx');
      expect(eidx).toBeTruthy();
      expect(ariaSnapshot).toContain(`button "Redeem" [ref=${eidx}]`);
      const el = elements.find((e) => e.eidx === eidx);
      expect(el?.role).toBe('button');
    });

    it('First name textbox: eidx and role match ARIA', async () => {
      const eidx = await page.locator('#firstName').getAttribute('data-explorbot-eidx');
      expect(eidx).toBeTruthy();
      expect(ariaSnapshot).toContain(`textbox "First name" [ref=${eidx}]`);
      const el = elements.find((e) => e.eidx === eidx);
      expect(el?.role).toBe('textbox');
    });

    it('Country combobox: eidx and role match ARIA', async () => {
      const eidx = await page.locator('#country').getAttribute('data-explorbot-eidx');
      expect(eidx).toBeTruthy();
      expect(ariaSnapshot).toContain(`combobox "Country" [ref=${eidx}]`);
      const el = elements.find((e) => e.eidx === eidx);
      expect(el?.role).toBe('combobox');
    });

    it('Credit card radio: eidx and role match ARIA', async () => {
      const eidx = await page.locator('#credit').getAttribute('data-explorbot-eidx');
      expect(eidx).toBeTruthy();
      expect(ariaSnapshot).toContain(`radio "Credit card" [checked] [ref=${eidx}]`);
      const el = elements.find((e) => e.eidx === eidx);
      expect(el?.role).toBe('radio');
    });
  });

  describe('github.html', () => {
    let page: Page;
    let ariaSnapshot: string;
    let elements: WebElement[];
    let domEidxValues: string[];

    beforeAll(async () => {
      page = await browser.newPage();
      await page.goto(`file://${join(process.cwd(), 'test-data', 'github.html')}`, { waitUntil: 'domcontentloaded' });
      const result = await annotatePageElements(page);
      ariaSnapshot = result.ariaSnapshot;
      elements = result.elements;
      domEidxValues = await page.evaluate(() => Array.from(document.querySelectorAll('[data-explorbot-eidx]')).map((el) => el.getAttribute('data-explorbot-eidx')!));
    });

    afterAll(async () => {
      await page?.close();
    });

    it('annotates interactive elements', () => {
      expect(elements.length).toBeGreaterThan(0);
    });

    it('every element has a role', () => {
      const noRole = elements.filter((e) => !e.role);
      expect(noRole).toEqual([]);
    });

    it('no duplicate eidx values', () => {
      expect(new Set(domEidxValues).size).toBe(domEidxValues.length);
    });

    it('Skip to content link: eidx and role match ARIA', async () => {
      const eidx = await page.locator('a[href="#start-of-content"]').getAttribute('data-explorbot-eidx');
      expect(eidx).toBeTruthy();
      expect(ariaSnapshot).toContain(`link "Skip to content" [ref=${eidx}]`);
      const el = elements.find((e) => e.eidx === eidx);
      expect(el?.role).toBe('link');
    });

    it('Product button: eidx and role match ARIA', async () => {
      const buttons = page.getByRole('button', { name: 'Product', exact: true });
      const eidx = await buttons.first().getAttribute('data-explorbot-eidx');
      expect(eidx).toBeTruthy();
      expect(ariaSnapshot).toContain(`button "Product" [ref=${eidx}]`);
      const el = elements.find((e) => e.eidx === eidx);
      expect(el?.role).toBe('button');
    });

    it('Sign up link: eidx and role match ARIA', async () => {
      const links = page.getByRole('link', { name: 'Sign up', exact: true });
      const eidx = await links.first().getAttribute('data-explorbot-eidx');
      expect(eidx).toBeTruthy();
      expect(ariaSnapshot).toContain(`link "Sign up" [ref=${eidx}]`);
      const el = elements.find((e) => e.eidx === eidx);
      expect(el?.role).toBe('link');
    });
  });
});
