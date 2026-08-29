import 'parse5';
import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../src/action-result.ts';
import { htmlDiff } from '../../src/utils/html-diff.ts';
import { Overlay, type RegionCoverageSamples, classifyRegionCoverage, findAppearedSubRoot, getRegionCoverageProbeSource } from '../../src/utils/overlay.ts';

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
});

describe('findAppearedSubRoot', () => {
  const bigForm = Array.from({ length: 200 }, (_, i) => `<div><label>Field ${i}</label><input name="field-${i}" placeholder="value ${i}"></div>`).join('');
  const basePage = '<html><body><div id="app"><h1>Users</h1><ul><li><a href="/users/1">First User</a></li></ul></div></body></html>';
  const pageWithDrawer = `<html><body><div id="app"><h1>Users</h1><ul><li><a href="/users/1">First User</a></li></ul></div><div class="drawer"><h2>Edit User</h2><form>${bigForm}</form></div></body></html>`;

  it('finds a large appeared element with container and element xpath', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const subRoot = findAppearedSubRoot(diff.parts);
    expect(subRoot).not.toBeNull();
    expect(subRoot!.size).toBeGreaterThanOrEqual(10_000);
    expect(subRoot!.container).toBe('body');
    expect(subRoot!.elementXPath).toBe('//body/div[2]');
    expect(subRoot!.subtree).toContain('Edit User');
  });

  it('returns null when the appeared content is below the threshold', async () => {
    const before = '<html><body><div id="app"><h1>Users</h1></div></body></html>';
    const after = '<html><body><div id="app"><h1>Users</h1></div><div class="toast">Saved successfully</div></body></html>';
    const diff = await htmlDiff(before, after);
    expect(findAppearedSubRoot(diff.parts)).toBeNull();
  });

  it('returns null when nothing appeared', async () => {
    const diff = await htmlDiff(basePage, basePage);
    expect(findAppearedSubRoot(diff.parts)).toBeNull();
  });
});

describe('Overlay.fromSubRoot', () => {
  const subRoot = {
    container: 'aside.detail-panel',
    elementXPath: '//body/div[2]',
    subtree: '<aside class="detail-panel"><h2>Edit User</h2><form><input name="name"></form></aside>',
    size: 12000,
  };

  it('overlaying with full coverage becomes a modal named by headings', () => {
    const overlay = Overlay.fromSubRoot(subRoot, { overlays: true, coverage: 0.95 });
    expect(overlay.type).toBe('modal');
    expect(overlay.name).toBe('Edit User');
    expect(overlay.root).toBe('aside.detail-panel');
    expect(overlay.detected).toBe(true);
    expect(overlay.present).toBe(true);
  });

  it('overlaying with partial coverage becomes a drawer', () => {
    expect(Overlay.fromSubRoot(subRoot, { overlays: true, coverage: 0.3 }).type).toBe('drawer');
  });

  it('inline verdict becomes a region: present but not detected', () => {
    const overlay = Overlay.fromSubRoot(subRoot, { overlays: false, coverage: 0.3 });
    expect(overlay.type).toBe('region');
    expect(overlay.detected).toBe(false);
    expect(overlay.present).toBe(true);
  });

  it('body container falls back to the element xpath as root', () => {
    const overlay = Overlay.fromSubRoot({ ...subRoot, container: 'body' }, { overlays: true, coverage: 1 });
    expect(overlay.root).toBe('//body/div[2]');
  });
});

const samplesBase = (): RegionCoverageSamples => ({
  found: true,
  rect: { x: 0, y: 0, width: 1280, height: 720 },
  viewport: { width: 1280, height: 720 },
  position: 'fixed',
  zIndex: 100,
  outsideHits: [],
  siblingsInert: false,
  bodyScrollLocked: false,
});

describe('classifyRegionCoverage', () => {
  it('full viewport coverage is overlaying', () => {
    const verdict = classifyRegionCoverage(samplesBase());
    expect(verdict.overlays).toBe(true);
    expect(verdict.coverage).toBeCloseTo(1);
  });

  it('partial floating region with all outside points blocked is overlaying', () => {
    const samples = samplesBase();
    samples.rect = { x: 880, y: 0, width: 400, height: 720 };
    samples.outsideHits = ['blocked', 'blocked', 'blocked', 'blocked'];
    const verdict = classifyRegionCoverage(samples);
    expect(verdict.overlays).toBe(true);
    expect(verdict.coverage).toBeLessThan(0.8);
  });

  it('inert siblings mean overlaying regardless of geometry', () => {
    const samples = samplesBase();
    samples.rect = { x: 0, y: 0, width: 400, height: 400 };
    samples.siblingsInert = true;
    expect(classifyRegionCoverage(samples).overlays).toBe(true);
  });

  it('static in-flow region with page hits outside is inline', () => {
    const samples = samplesBase();
    samples.rect = { x: 200, y: 100, width: 800, height: 500 };
    samples.position = 'static';
    samples.zIndex = 0;
    samples.outsideHits = ['page', 'page', 'page'];
    expect(classifyRegionCoverage(samples).overlays).toBe(false);
  });

  it('missing element or null samples is inline with zero coverage', () => {
    expect(classifyRegionCoverage(null)).toEqual({ overlays: false, coverage: 0 });
    const samples = samplesBase();
    samples.found = false;
    expect(classifyRegionCoverage(samples)).toEqual({ overlays: false, coverage: 0 });
  });
});

describe('getRegionCoverageProbeSource', () => {
  it('serializes to a reconstructible function', () => {
    const source = getRegionCoverageProbeSource();
    const fn = new Function(`return ${source}`)();
    expect(typeof fn).toBe('function');
  });
});
