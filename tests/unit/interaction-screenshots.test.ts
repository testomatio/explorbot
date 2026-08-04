import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { captureInteractionAfter, findChangedRegion } from '../../boat/doc-collector/src/interaction-screenshots.ts';

describe('DocBot interaction screenshot diff', () => {
  it('returns the changed pixel bounds with 30px padding', () => {
    const before = createImage(200, 120);
    const after = createImage(200, 120, { x: 80, y: 50, width: 20, height: 10 });

    expect(findChangedRegion(before, after)).toEqual({ x: 50, y: 20, width: 80, height: 70 });
  });

  it('clamps padding to the image edges', () => {
    const before = createImage(100, 80);
    const after = createImage(100, 80, { x: 5, y: 3, width: 10, height: 8 });

    expect(findChangedRegion(before, after)).toEqual({ x: 0, y: 0, width: 45, height: 41 });
  });

  it('returns null when no pixels changed', () => {
    const image = createImage(50, 40);
    expect(findChangedRegion(image, image)).toBeNull();
  });

  it('returns null for screenshots with different dimensions', () => {
    expect(findChangedRegion(createImage(50, 40), createImage(60, 40))).toBeNull();
  });

  it('writes the cropped changed region from the after screenshot', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'docbot-pixel-diff-'));
    const filePath = path.join(directory, 'change.png');
    const before = createImage(200, 120);
    const after = createImage(200, 120, { x: 80, y: 50, width: 20, height: 10 });
    const page = {
      locator: () => ({ evaluateAll: async () => {} }),
      screenshot: async () => after,
    } as any;

    try {
      expect(await captureInteractionAfter(page, before, filePath)).toBe('captured');
      const cropped = PNG.sync.read(readFileSync(filePath));
      expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 80, height: 70 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not save a viewport when the screenshots are visually unchanged', async () => {
    const image = createImage(100, 80);
    const page = {
      locator: () => ({ evaluateAll: async () => {} }),
      screenshot: async () => image,
    } as any;

    expect(await captureInteractionAfter(page, image, 'unused.png')).toBe('unchanged');
  });

  it('does not invoke overlay detection for a local change', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'docbot-local-diff-'));
    const filePath = path.join(directory, 'local.png');
    const before = createImage(200, 120);
    const after = createImage(200, 120, { x: 80, y: 50, width: 20, height: 10 });
    let overlayDetectionCalled = false;
    const page = {
      locator(selector: string) {
        if (selector === '[data-explorbot-annotation]') return { evaluateAll: async () => {} };
        overlayDetectionCalled = true;
        throw new Error(`Unexpected overlay locator: ${selector}`);
      },
      screenshot: async () => after,
    } as any;

    try {
      expect(await captureInteractionAfter(page, before, filePath, true)).toBe('captured');
      expect(overlayDetectionCalled).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('crops a modal with 30px padding instead of including its backdrop', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'docbot-modal-diff-'));
    const filePath = path.join(directory, 'modal.png');
    const before = createImage(1000, 800);
    const after = createImage(1000, 800, { x: 0, y: 0, width: 1000, height: 800 });
    const page = {
      locator(selector: string) {
        if (selector === '[data-explorbot-annotation]') return { evaluateAll: async () => {} };
        return { count: async () => 1, last: () => ({ boundingBox: async () => ({ x: 350, y: 200, width: 300, height: 400 }) }) };
      },
      viewportSize: () => ({ width: 1000, height: 800 }),
      screenshot: async () => after,
    } as any;

    try {
      expect(await captureInteractionAfter(page, before, filePath)).toBe('captured');
      const cropped = PNG.sync.read(readFileSync(filePath));
      expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 360, height: 460 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('uses a compact unmarked overlay for same-page interactions', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'docbot-unmarked-overlay-'));
    const filePath = path.join(directory, 'overlay.png');
    const before = createImage(1000, 800);
    const after = createImage(1000, 800, { x: 0, y: 0, width: 1000, height: 800 });
    const page = {
      locator(selector: string) {
        if (selector === '[data-explorbot-annotation]') return { evaluateAll: async () => {} };
        return { count: async () => 0, last: () => ({ boundingBox: async () => null }) };
      },
      viewportSize: () => ({ width: 1000, height: 800 }),
      screenshot: async () => after,
      evaluate: async () => ({ x: 350, y: 200, width: 300, height: 400 }),
    } as any;

    try {
      expect(await captureInteractionAfter(page, before, filePath, true)).toBe('captured');
      const cropped = PNG.sync.read(readFileSync(filePath));
      expect({ width: cropped.width, height: cropped.height }).toEqual({ width: 360, height: 460 });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function createImage(width: number, height: number, region?: { x: number; y: number; width: number; height: number }): Buffer {
  const image = new PNG({ width, height, colorType: 6 });
  image.data.fill(255);
  if (region) {
    for (let y = region.y; y < region.y + region.height; y++) {
      for (let x = region.x; x < region.x + region.width; x++) {
        const offset = (y * width + x) * 4;
        image.data[offset] = 0;
        image.data[offset + 1] = 0;
        image.data[offset + 2] = 0;
      }
    }
  }
  return PNG.sync.write(image);
}
