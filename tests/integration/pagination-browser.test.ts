import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright';
import { measureScroll, restoreScroll } from '../../src/utils/pagination.ts';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

const rows = (count: number) => Array.from({ length: count }, (_, i) => `<div class="row" style="height:40px">row ${i}</div>`).join('');

const pageWith = async (body: string) => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0">${body}</body></html>`);
  return page;
};

describe('measureScroll', () => {
  it('reports a container that scrolls inside itself', async () => {
    const page = await pageWith(`<div id="box" style="height:200px;overflow-y:auto">${rows(60)}</div>`);

    const measure = await page.evaluate(measureScroll, '#box');

    expect(measure?.ownScroller).toBe(true);
    expect(measure?.rowCount).toBe(60);
    await page.close();
  });

  it('reports a list that continues below the fold', async () => {
    const page = await pageWith(`<div id="box">${rows(400)}</div>`);

    const measure = await page.evaluate(measureScroll, '#box');

    expect(measure?.ownScroller).toBe(false);
    expect(measure?.belowFold).toBe(true);
    await page.close();
  });

  it('reports neither for a short list', async () => {
    const page = await pageWith('<div id="box"><div class="row">only</div></div>');

    const measure = await page.evaluate(measureScroll, '#box');

    expect(measure?.ownScroller).toBe(false);
    expect(measure?.belowFold).toBe(false);
    await page.close();
  });

  it('counts direct children, not every descendant', async () => {
    const page = await pageWith('<div id="box"><div class="row"><span>a</span><span>b</span></div><div class="row">two</div></div>');

    const measure = await page.evaluate(measureScroll, '#box');

    expect(measure?.rowCount).toBe(2);
    await page.close();
  });

  it('returns null for a selector that matches nothing', async () => {
    const page = await pageWith('<div id="box"></div>');

    expect(await page.evaluate(measureScroll, '#missing')).toBeNull();
    await page.close();
  });
});

describe('restoreScroll', () => {
  it('puts a container scroller back where it was', async () => {
    const page = await pageWith(`<div id="box" style="height:200px;overflow-y:auto">${rows(60)}</div>`);

    await page.evaluate(() => {
      document.getElementById('box')!.scrollTop = 900;
    });
    await page.evaluate(restoreScroll, { css: '#box', scrollTop: 0, windowScrollY: 0 });

    expect((await page.evaluate(measureScroll, '#box'))?.scrollTop).toBe(0);
    await page.close();
  });

  it('puts the window back too, since scrollIntoViewIfNeeded moves both', async () => {
    const page = await pageWith(`<div style="height:2000px">filler</div><div id="box" style="height:200px;overflow-y:auto">${rows(60)}</div><div style="height:2000px">filler</div>`);
    const before = await page.evaluate(measureScroll, '#box');

    await page.locator('#box > *:last-child').scrollIntoViewIfNeeded();
    const moved = await page.evaluate(measureScroll, '#box');
    await page.evaluate(restoreScroll, { css: '#box', scrollTop: before!.scrollTop, windowScrollY: before!.windowScrollY });
    const restored = await page.evaluate(measureScroll, '#box');

    expect(moved!.windowScrollY).toBeGreaterThan(0);
    expect(moved!.scrollTop).toBeGreaterThan(0);
    expect(restored!.windowScrollY).toBe(before!.windowScrollY);
    expect(restored!.scrollTop).toBe(before!.scrollTop);
    await page.close();
  });
});

describe('scrolling a container that appends', () => {
  it('adds rows and can be put back', async () => {
    const page = await browser.newPage();
    await page.goto(`file://${join(process.cwd(), 'test-data', 'infinite-list.html')}`, { waitUntil: 'domcontentloaded' });

    const before = await page.evaluate(measureScroll, '#feed');
    await page.locator('#feed > *:last-child').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const after = await page.evaluate(measureScroll, '#feed');
    await page.evaluate(restoreScroll, { css: '#feed', scrollTop: before!.scrollTop, windowScrollY: before!.windowScrollY });
    const restored = await page.evaluate(measureScroll, '#feed');

    expect(before?.ownScroller).toBe(true);
    expect(after!.rowCount).toBeGreaterThan(before!.rowCount);
    expect(restored?.scrollTop).toBe(before!.scrollTop);
    expect(restored?.windowScrollY).toBe(before!.windowScrollY);
    await page.close();
  });
});
