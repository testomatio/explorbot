import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { syntheticDragDrop } from '../../src/ai/tools.ts';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

async function boardPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(`file://${join(process.cwd(), 'test-data', 'drag-board.html')}`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function manualDrag(page: Page, source: string, target: string) {
  await page.locator(source).hover();
  await page.mouse.down();
  await page.locator(target).hover();
  await page.mouse.up();
}

async function listTexts(page: Page): Promise<string[]> {
  return page.locator('#mouse-list li').allTextContents();
}

describe('mouse-event drag and drop', () => {
  it('reorders the list through the simulated mouse sequence', async () => {
    const page = await boardPage();

    await manualDrag(page, '#mouse-list li:nth-child(2)', '#mouse-list li:nth-child(1)');

    expect(await listTexts(page)).toEqual(['Item 2', 'Item 1', 'Item 3']);
    await page.close();
  });

  it('duplicates the item when Control is held during the drag', async () => {
    const page = await boardPage();

    await page.locator('#mouse-list li:nth-child(2)').hover();
    await page.keyboard.down('Control');
    await page.mouse.down();
    await page.locator('#mouse-list li:nth-child(1)').hover();
    await page.mouse.up();
    await page.keyboard.up('Control');

    expect(await listTexts(page)).toEqual(['Item 2 (copy)', 'Item 1', 'Item 2', 'Item 3']);
    await page.close();
  });
});

describe('HTML5 drag and drop', () => {
  it('responds to the native drag', async () => {
    const page = await boardPage();

    await page.dragAndDrop('#html5-chip', '#drop-zone');

    expect(await page.locator('#drop-zone #html5-chip').count()).toBe(1);
    await page.close();
  });

  it('needs synthetic drag events when the source cancels the mouse press', async () => {
    const page = await boardPage();

    await manualDrag(page, '#guarded-chip', '#guarded-zone');
    expect(await page.locator('#guarded-zone #guarded-chip').count()).toBe(0);

    await page.dragAndDrop('#guarded-chip', '#guarded-zone');
    expect(await page.locator('#guarded-zone #guarded-chip').count()).toBe(0);

    const explorer: any = { withPage: (fn: (page: Page) => Promise<boolean>) => fn(page) };
    expect(await syntheticDragDrop(explorer, 'I.dragAndDrop("#guarded-chip", "#guarded-zone")')).toBe(true);
    expect(await page.locator('#guarded-zone #guarded-chip').count()).toBe(1);
    await page.close();
  });
});
