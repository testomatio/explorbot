import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { type Browser, type Page, chromium } from 'playwright';
import { type DragPoints, syntheticDragDrop } from '../../src/ai/tools.ts';

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

async function centerOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`No bounding box for ${selector}`);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

async function dragByPoints(page: Page, points: DragPoints, modifier?: string) {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(points.from.x, points.from.y);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(points.to.x, points.to.y, { steps: 10 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

async function listTexts(page: Page): Promise<string[]> {
  return page.locator('#mouse-list li').allTextContents();
}

describe('mouse-event drag and drop', () => {
  it('reorders the list through a coordinate mouse drag', async () => {
    const page = await boardPage();

    await dragByPoints(page, { from: await centerOf(page, '#mouse-list li:nth-child(2)'), to: await centerOf(page, '#mouse-list li:nth-child(1)') });

    expect(await listTexts(page)).toEqual(['Item 2', 'Item 1', 'Item 3']);
    await page.close();
  });

  it('duplicates the item when Control is held during the drag', async () => {
    const page = await boardPage();

    await dragByPoints(page, { from: await centerOf(page, '#mouse-list li:nth-child(2)'), to: await centerOf(page, '#mouse-list li:nth-child(1)') }, 'Control');

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

    await dragByPoints(page, { from: await centerOf(page, '#guarded-chip'), to: await centerOf(page, '#guarded-zone') });
    expect(await page.locator('#guarded-zone #guarded-chip').count()).toBe(0);

    await page.dragAndDrop('#guarded-chip', '#guarded-zone');
    expect(await page.locator('#guarded-zone #guarded-chip').count()).toBe(0);

    const explorer: any = { withPage: (fn: (page: Page) => Promise<boolean>) => fn(page) };
    const points = { from: await centerOf(page, '#guarded-chip'), to: await centerOf(page, '#guarded-zone') };
    expect(await syntheticDragDrop(explorer, points)).toBe(true);
    expect(await page.locator('#guarded-zone #guarded-chip').count()).toBe(1);
    await page.close();
  });
});
