import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { type VisibilityReport, collectVisibilityReport } from '../../src/utils/visibility.ts';

let browser: Browser;
let page: Page;
let report: VisibilityReport | null;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(`file://${join(process.cwd(), 'test-data', 'visibility-probe.html')}`, { waitUntil: 'domcontentloaded' });
  report = await collectVisibilityReport(page);
});

afterAll(async () => {
  await browser?.close();
});

describe('what a full-page screenshot cannot show', () => {
  it('names the regions that scroll inside themselves and how much they hide', () => {
    const inventory = report?.regions.find((region) => region.label.includes('Inventory list'));
    expect(inventory).toBeTruthy();
    expect(inventory?.axis).toBe('vertical');
    expect(inventory?.hiddenPercent).toBeGreaterThan(40);
  });

  it('catches a region that scrolls sideways', () => {
    const tags = report?.regions.find((region) => region.label.includes('Tag strip'));
    expect(tags?.axis).toBe('horizontal');
  });
});

describe('elements the DOM calls visible that nobody can see', () => {
  const reasonFor = (text: string): string => report?.unseen.find((element) => element.label.includes(text))?.reason || '';

  it('reports text drawn in the colour of its own background', () => {
    expect(reasonFor('Saved successfully')).toContain('same colour');
  });

  it('reports an element parked outside the page', () => {
    expect(reasonFor('Archived record')).toContain('outside the page');
  });

  it('reports a control covered by something else, and names the cover', () => {
    expect(reasonFor('Confirm order')).toContain('covered by');
    expect(reasonFor('Confirm order')).toContain('Notification');
  });

  it('leaves ordinary visible content alone', () => {
    expect(reasonFor('A perfectly ordinary paragraph')).toBe('');
  });

  it('does not report elements the page never rendered', () => {
    expect(reasonFor('Never rendered')).toBe('');
  });

  it('does not report screen-reader-only text as a defect', () => {
    expect(reasonFor('Skip to content')).toBe('');
  });
});
