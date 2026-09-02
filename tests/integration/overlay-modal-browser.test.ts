import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { htmlDiff } from '../../src/utils/html-diff.ts';
import { captureHtmlForSnapshot } from '../../src/utils/html.ts';
import { Overlay, OverlayPage, type RegionDiff } from '../../src/utils/overlay.ts';

const FIXTURE_URL = `file://${join(process.cwd(), 'test-data', 'testomat_modal.html')}`;

describe('modal without dialog semantics, detected from layout', () => {
  let browser: Browser;
  let page: Page;
  let before: string;
  let aria: string;
  let diff: RegionDiff;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
    await page.goto(FIXTURE_URL, { waitUntil: 'domcontentloaded' });
    before = await page.evaluate(captureHtmlForSnapshot);
    await page.getByRole('button', { name: 'Select suite', exact: true }).click();
    await page.waitForSelector('.ember-modal-dialog');
    const after = await page.evaluate(captureHtmlForSnapshot);
    aria = await page.locator('body').ariaSnapshot();
    const result = await htmlDiff(before, after);
    diff = { parts: result.parts, pageSize: result.pageSize, similarity: result.similarity, sameUrl: true, previousHtml: before };
  });

  afterAll(async () => {
    await page?.close();
    await browser?.close();
  });

  it('exposes the open modal in aria as a plain heading, never as a dialog', () => {
    expect(aria).toContain('heading "Select suite for test"');
    expect(aria).not.toMatch(/dialog/);
    expect(Overlay.fromAria(aria).type).toBeNull();
  });

  it('diffs the opened modal as one added subtree under the overlay host', () => {
    expect(diff.parts).toHaveLength(1);
    expect(diff.parts[0].container).toBe('#modal-overlays');
    expect(diff.parts[0].added[0]).toMatch(/^ELEMENT:/);
  });

  it('detects the modal as an overlay from its layout alone', async () => {
    const region = await new OverlayPage(page).detectRegion(diff);
    expect(region).not.toBeNull();
    expect(region!.type).toBe('overlay');
    expect(region!.name).toBe('Select suite for test');
    expect(region!.root).toBe('#modal-overlays');
  });

  it('keeps the overlay open until its close button removes it', async () => {
    const overlayPage = new OverlayPage(page);
    const region = await overlayPage.detectRegion(diff);
    expect(await overlayPage.isStillOpen(region!)).toBe(true);
    await page.locator('#modal-overlays .modal-header button').click();
    expect(await overlayPage.isStillOpen(region!)).toBe(false);
    expect(await page.evaluate(captureHtmlForSnapshot)).toBe(before);
  });
});
