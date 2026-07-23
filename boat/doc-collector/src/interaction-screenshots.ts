import { writeFileSync } from 'node:fs';
import pixelmatch from 'pixelmatch';
import type { Page } from 'playwright';
import { PNG } from 'pngjs';

const REGION_PADDING = 30;
const SCREENSHOT_OPTIONS = { animations: 'disabled', caret: 'hide' } as const;

export async function captureInteractionBefore(page: Page): Promise<Buffer | null> {
  await removeVisualAnnotations(page);
  try {
    return await page.screenshot(SCREENSHOT_OPTIONS);
  } catch {
    return null;
  }
}

export async function captureInteractionAfter(page: Page, beforeScreenshot: Buffer | null, filePath: string, detectUnmarkedOverlay = false): Promise<InteractionCaptureResult> {
  if (!beforeScreenshot) return 'failed';

  await removeVisualAnnotations(page);
  try {
    const afterScreenshot = await page.screenshot(SCREENSHOT_OPTIONS);
    const before = PNG.sync.read(beforeScreenshot);
    const after = PNG.sync.read(afterScreenshot);
    if (before.width !== after.width || before.height !== after.height) return 'failed';
    const changedPixels = findChangedPixelBounds(before, after);
    if (!changedPixels) return 'unchanged';
    const fullViewportChanged = changedPixels.x === 0 && changedPixels.y === 0 && changedPixels.width === after.width && changedPixels.height === after.height;
    const changedRegion = addPadding(changedPixels, after.width, after.height);
    const overlayRegion = fullViewportChanged ? await findOverlayRegion(page, after, detectUnmarkedOverlay) : null;
    saveRegion(after, overlayRegion || changedRegion, filePath);
    return 'captured';
  } catch {
    return 'failed';
  }
}

export function findChangedRegion(beforeScreenshot: Buffer, afterScreenshot: Buffer, padding = REGION_PADDING): ScreenshotRegion | null {
  const before = PNG.sync.read(beforeScreenshot);
  const after = PNG.sync.read(afterScreenshot);
  if (before.width !== after.width || before.height !== after.height) return null;
  const changedPixels = findChangedPixelBounds(before, after);
  return changedPixels ? addPadding(changedPixels, before.width, before.height, padding) : null;
}

function saveRegion(after: PNG, region: ScreenshotRegion, filePath: string): void {
  const cropped = new PNG({ width: region.width, height: region.height });
  PNG.bitblt(after, cropped, region.x, region.y, region.width, region.height, 0, 0);
  writeFileSync(filePath, PNG.sync.write(cropped));
}

function findChangedPixelBounds(before: PNG, after: PNG): ScreenshotRegion | null {
  const diff = Buffer.alloc(before.width * before.height * 4);
  const changedPixels = pixelmatch(before.data, after.data, diff, before.width, before.height, { diffMask: true });
  if (changedPixels === 0) return null;

  let left = before.width;
  let top = before.height;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < before.height; y++) {
    for (let x = 0; x < before.width; x++) {
      if (diff[(y * before.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function addPadding(region: ScreenshotRegion, imageWidth: number, imageHeight: number, padding = REGION_PADDING): ScreenshotRegion {
  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const maxX = Math.min(imageWidth, region.x + region.width + padding);
  const maxY = Math.min(imageHeight, region.y + region.height + padding);
  return { x, y, width: maxX - x, height: maxY - y };
}

async function removeVisualAnnotations(page: Page): Promise<void> {
  try {
    await page.locator('[data-explorbot-annotation]').evaluateAll((elements) => {
      for (const element of elements) element.remove();
    });
  } catch {}
}

async function findOverlayRegion(page: Page, image: PNG, detectUnmarkedOverlay: boolean): Promise<ScreenshotRegion | null> {
  let box: { x: number; y: number; width: number; height: number } | null = null;
  try {
    const dialogs = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible, [aria-modal="true"]:visible');
    if ((await dialogs.count()) > 0) box = await dialogs.last().boundingBox();
  } catch {}

  if (!box && detectUnmarkedOverlay) {
    try {
      box = await findUnmarkedOverlay(page);
    } catch {}
  }

  try {
    const viewport = page.viewportSize();
    if (!box || !viewport) return null;

    const scaleX = image.width / viewport.width;
    const scaleY = image.height / viewport.height;
    const x = Math.max(0, Math.floor(box.x * scaleX) - REGION_PADDING);
    const y = Math.max(0, Math.floor(box.y * scaleY) - REGION_PADDING);
    const maxX = Math.min(image.width, Math.ceil((box.x + box.width) * scaleX) + REGION_PADDING);
    const maxY = Math.min(image.height, Math.ceil((box.y + box.height) * scaleY) + REGION_PADDING);
    if (maxX <= x || maxY <= y) return null;
    return { x, y, width: maxX - x, height: maxY - y };
  } catch {
    return null;
  }
}

async function findUnmarkedOverlay(page: Page): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const elements = [...document.body.querySelectorAll('*')].map((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const zIndex = Number.parseInt(style.zIndex, 10);
      return { element, style, box, zIndex, area: box.width * box.height };
    });
    const isVisibleLayer = ({ style, box, zIndex }: (typeof elements)[number]) => {
      if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
      if (box.width <= 0 || box.height <= 0) return false;
      if (style.position !== 'fixed' && style.position !== 'absolute') return false;
      return Number.isFinite(zIndex);
    };
    const backdropZIndex = elements.filter((item) => isVisibleLayer(item) && item.box.width >= window.innerWidth && item.box.height >= window.innerHeight).reduce((highest, item) => Math.max(highest, item.zIndex), Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(backdropZIndex)) return null;

    const candidates = elements
      .filter((item) => {
        if (!isVisibleLayer(item)) return false;
        if (item.box.width >= window.innerWidth && item.box.height >= window.innerHeight) return false;
        if (item.zIndex < backdropZIndex) return false;
        return item.element.matches('button, input, select, textarea, a[href]') || !!item.element.querySelector('button, input, select, textarea, a[href]');
      })
      .sort((left, right) => right.zIndex - left.zIndex || left.area - right.area);
    const box = candidates[0]?.box;
    if (!box) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
}

export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type InteractionCaptureResult = 'captured' | 'unchanged' | 'failed';
