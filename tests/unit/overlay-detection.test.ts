import 'parse5';
import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../src/action-result.ts';
import { htmlDiff } from '../../src/utils/html-diff.ts';
import { Overlay, OverlayPage } from '../../src/utils/overlay.ts';

describe('ActionResult overlay', () => {
  it('falls back to the aria snapshot when no overlay was stored', () => {
    const result = new ActionResult({ url: '/', ariaSnapshot: '- dialog "Delete confirmation"' });
    expect(result.overlay.detected).toBe(true);
    expect(result.overlay.type).toBe('dialog');
    expect(result.overlay.name).toBe('Delete confirmation');
  });

  it('prefers the stored descriptor of a restored state', () => {
    const result = new ActionResult({ url: '/', overlay: new Overlay({ type: 'dialog', name: 'Saved filter' }) });
    expect(result.overlay.type).toBe('dialog');
    expect(result.overlay.name).toBe('Saved filter');
  });
});

describe('Overlay', () => {
  it('resolve prefers stored overlay data over aria', () => {
    const aria = '- dialog "From aria"';
    const overlay = Overlay.resolve({ overlay: { type: 'modal', name: 'Stored' }, ariaSnapshot: aria });
    expect(overlay.name).toBe('Stored');
  });

  it('resolve falls back to aria detection', () => {
    expect(Overlay.resolve({ ariaSnapshot: '- dialog "From aria"' }).detected).toBe(true);
  });

  it('rehydrates from a plain persisted descriptor', () => {
    expect(new Overlay({ type: 'modal', name: 'Copy report' }).detected).toBe(true);
    expect(new Overlay().detected).toBe(false);
  });

  it('describes an open region with its scope', () => {
    const overlay = new Overlay({ type: 'drawer', name: 'Edit User', root: 'aside.panel' });
    expect(overlay.describe()).toBe('drawer "Edit User" opened, scope: aside.panel');
    expect(new Overlay().describe()).toBe('');
  });
});

const bigForm = Array.from({ length: 200 }, (_, i) => `<div><label>Field ${i}</label><input name="field-${i}" placeholder="value ${i}"></div>`).join('');
const basePage = '<html><body><div id="app"><h1>Users</h1><ul><li><a href="/users/1">First User</a></li></ul></div></body></html>';
const pageWithDrawer = `<html><body><div id="app"><h1>Users</h1><ul><li><a href="/users/1">First User</a></li></ul></div><div class="drawer"><h2>Edit User</h2><form>${bigForm}</form></div></body></html>`;

const overlaySamples = (overrides: Record<string, unknown> = {}) => ({
  found: true,
  rect: { x: 0, y: 0, width: 1280, height: 720 },
  viewport: { width: 1280, height: 720 },
  position: 'fixed',
  zIndex: 100,
  outsideHits: [],
  siblingsInert: false,
  bodyScrollLocked: false,
  ...overrides,
});

const pageProbing = (samples: unknown) => ({ evaluate: async () => samples });

describe('OverlayPage.detectRegion', () => {
  it('classifies a large appeared element covering the viewport as a modal', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(pageProbing(overlaySamples())).detectRegion(diff.parts);
    expect(overlay).not.toBeNull();
    expect(overlay!.type).toBe('modal');
    expect(overlay!.name).toBe('Edit User');
    expect(overlay!.root).toBe('//body/div[2]');
    expect(overlay!.html).toContain('Edit User');
    expect(overlay!.detected).toBe(true);
    expect(overlay!.present).toBe(true);
  });

  it('keeps a stable container selector as root when the region appears inside one', async () => {
    const before = '<html><body><div id="app"><h1>Users</h1></div><aside id="record-editor"></aside></body></html>';
    const after = `<html><body><div id="app"><h1>Users</h1></div><aside id="record-editor"><div class="holder"><h2>Edit User</h2><form>${bigForm}</form></div></aside></body></html>`;
    const diff = await htmlDiff(before, after);
    const overlay = await new OverlayPage(pageProbing(overlaySamples())).detectRegion(diff.parts);
    expect(overlay).not.toBeNull();
    expect(overlay!.root).toBe('#record-editor');
  });

  it('classifies a partial floating region with all outside points blocked as a drawer', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const samples = overlaySamples({
      rect: { x: 880, y: 0, width: 400, height: 720 },
      outsideHits: ['blocked', 'blocked', 'blocked', 'blocked'],
    });
    const overlay = await new OverlayPage(pageProbing(samples)).detectRegion(diff.parts);
    expect(overlay!.type).toBe('drawer');
    expect(overlay!.detected).toBe(true);
  });

  it('treats inert siblings as overlaying regardless of geometry', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const samples = overlaySamples({ rect: { x: 0, y: 0, width: 400, height: 400 }, siblingsInert: true });
    const overlay = await new OverlayPage(pageProbing(samples)).detectRegion(diff.parts);
    expect(overlay!.detected).toBe(true);
  });

  it('classifies a static in-flow region with page hits outside as inline', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const samples = overlaySamples({
      rect: { x: 200, y: 100, width: 800, height: 500 },
      position: 'static',
      zIndex: 0,
      outsideHits: ['page', 'page', 'page'],
    });
    const overlay = await new OverlayPage(pageProbing(samples)).detectRegion(diff.parts);
    expect(overlay!.type).toBe('region');
    expect(overlay!.detected).toBe(false);
    expect(overlay!.present).toBe(true);
  });

  it('degrades to an inline region when no page is available', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(null).detectRegion(diff.parts);
    expect(overlay!.type).toBe('region');
  });

  it('degrades to an inline region when the probe fails', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const failing = { evaluate: async () => Promise.reject(new Error('page crashed')) };
    const overlay = await new OverlayPage(failing).detectRegion(diff.parts);
    expect(overlay!.type).toBe('region');
  });

  it('ships a self-contained probe to the page', async () => {
    let captured: unknown = null;
    const executing = {
      evaluate: async (fn: any, arg: any) => {
        try {
          return fn(arg);
        } catch (err) {
          captured = err;
          throw err;
        }
      },
    };
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(executing).detectRegion(diff.parts);
    expect(String(captured)).toContain('window');
    expect(overlay!.type).toBe('region');
  });

  it('returns null when the appeared content is below the threshold', async () => {
    const before = '<html><body><div id="app"><h1>Users</h1></div></body></html>';
    const after = '<html><body><div id="app"><h1>Users</h1></div><div class="toast">Saved successfully</div></body></html>';
    const diff = await htmlDiff(before, after);
    expect(await new OverlayPage(null).detectRegion(diff.parts)).toBeNull();
  });

  it('returns null when nothing appeared', async () => {
    const diff = await htmlDiff(basePage, basePage);
    expect(await new OverlayPage(null).detectRegion(diff.parts)).toBeNull();
  });
});
