import 'parse5';
import { beforeEach, describe, expect, it } from 'vitest';
import Action from '../../src/action.ts';
import { ActionResult } from '../../src/action-result.ts';
import { ConfigParser } from '../../src/config.ts';
import { htmlDiff } from '../../src/utils/html-diff.ts';
import { Overlay, OverlayPage } from '../../src/utils/overlay.ts';
import { Region, type RegionData, type RegionDiff } from '../../src/utils/region.ts';

describe('ActionResult overlay', () => {
  it('falls back to the aria snapshot when no overlay was stored', () => {
    const result = new ActionResult({ url: '/', ariaSnapshot: '- dialog "Delete confirmation"' });
    expect(result.overlay.isModal).toBe(true);
    expect(result.overlay.type).toBe('overlay');
    expect(result.overlay.name).toBe('Delete confirmation');
  });

  it('takes the topmost dialog when two are stacked side by side', () => {
    const result = new ActionResult({ url: '/', ariaSnapshot: '- dialog "Edit User":\n  - heading "Edit User"\n- dialog "Pick a date":\n  - heading "Pick a date"' });
    expect(result.overlay.name).toBe('Pick a date');
  });

  it('takes the innermost dialog when one is nested in the other', () => {
    const result = new ActionResult({ url: '/', ariaSnapshot: '- dialog "Edit User":\n  - heading "Edit User"\n  - dialog "Pick a date":\n    - heading "Pick a date"' });
    expect(result.overlay.name).toBe('Pick a date');
  });

  it('prefers the stored descriptor of a restored state', () => {
    const result = new ActionResult({ url: '/', overlay: new Overlay({ type: 'overlay', name: 'Saved filter' }) });
    expect(result.overlay.type).toBe('overlay');
    expect(result.overlay.name).toBe('Saved filter');
  });

  it('keeps xpath and parent through fromState round-trips', () => {
    const result = new ActionResult({
      url: '/',
      html: '<html><body><h1>Users</h1></body></html>',
      overlay: { type: 'overlay', name: 'Edit User', root: 'div.editor', xpath: '//body/div[2]', parent: { type: 'overlay', name: 'Outer', xpath: '//body/div[1]' } },
    });
    const restored = ActionResult.fromState(result);
    expect(restored.overlay.xpath).toBe('//body/div[2]');
    expect(restored.overlay.parent?.name).toBe('Outer');
    const again = ActionResult.fromState(restored);
    expect(again.overlay.xpath).toBe('//body/div[2]');
    expect(again.overlay.parent?.xpath).toBe('//body/div[1]');
  });
});

describe('Overlay', () => {
  it('resolve prefers stored overlay data over aria', () => {
    const aria = '- dialog "From aria"';
    const overlay = Overlay.resolve({ overlay: { type: 'overlay', name: 'Stored' }, ariaSnapshot: aria });
    expect(overlay.name).toBe('Stored');
  });

  it('resolve falls back to aria detection', () => {
    expect(Overlay.resolve({ ariaSnapshot: '- dialog "From aria"' }).isModal).toBe(true);
  });

  it('rehydrates from a plain persisted descriptor', () => {
    expect(new Overlay({ type: 'overlay', name: 'Copy report' }).isModal).toBe(true);
    expect(new Region().isModal).toBe(false);
  });

  it('describes an open region with its scope', () => {
    const overlay = new Overlay({ type: 'overlay', name: 'Edit User', root: 'aside.panel' });
    expect(overlay.describe()).toBe('overlay "Edit User" opened, scope: aside.panel');
    expect(new Region().describe()).toBe('');
  });

  it('withGeometry keeps aria identity and adopts probe geometry', () => {
    const aria = new Overlay({ type: 'overlay', name: 'Select suite for test' });
    const geometry = new Region({ type: 'region', name: 'Fallback', root: 'div.picker', xpath: '//body/div[3]', html: '<div class="picker"></div>' });
    const merged = aria.withGeometry(geometry);
    expect(merged.type).toBe('overlay');
    expect(merged.name).toBe('Select suite for test');
    expect(merged.root).toBe('div.picker');
    expect(merged.xpath).toBe('//body/div[3]');
  });

  it('withParent stores the replaced overlay without its html', () => {
    const outer = new Overlay({ type: 'overlay', name: 'New Plan', root: 'div.plan', xpath: '//body/div[1]', html: '<div>big</div>' });
    const nested = new Region({ type: 'region', name: 'Select tests', xpath: '//body/div[2]' });
    const stacked = nested.withParent(outer);
    expect(stacked.parent?.name).toBe('New Plan');
    expect(stacked.parent?.xpath).toBe('//body/div[1]');
    expect((stacked.parent as any).html).toBeUndefined();
  });
});

const bigForm = Array.from({ length: 200 }, (_, i) => `<div><label>Field ${i}</label><input name="field-${i}" placeholder="value ${i}"></div>`).join('');
const bigList = Array.from({ length: 400 }, (_, i) => `<li><a href="/users/${i}">User Number ${i} of the directory</a></li>`).join('');
const basePage = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div></body></html>`;
const pageWithDrawer = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div class="drawer"><h2>Edit User</h2><form>${bigForm}</form></div></body></html>`;

const regionDiff = async (before: string, after: string, overrides: Partial<RegionDiff> = {}): Promise<RegionDiff> => {
  const diff = await htmlDiff(before, after);
  return { parts: diff.parts, pageSize: diff.pageSize, similarity: diff.similarity, sameUrl: true, previousHtml: before, ...overrides };
};

const regionProbe = (overrides: Record<string, unknown> = {}) => ({
  found: true,
  onScreen: true,
  floating: true,
  centerBelongs: true,
  coveredByFloating: false,
  ...overrides,
});

const pageProbing = (probe: unknown) => ({ evaluate: async () => probe });

describe('OverlayPage.detectRegion', () => {
  it('classifies an open floating region as a modal with a semantic root', async () => {
    const diff = await regionDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.type).toBe('overlay');
    expect(overlay!.name).toBe('Edit User');
    expect(overlay!.root).toBe('div.drawer');
    expect(overlay!.xpath).toBe('//body/div[2]');
    expect(overlay!.html).toContain('Edit User');
    expect(overlay!.isModal).toBe(true);
  });

  it('keeps a stable container selector as root when the region appears inside one', async () => {
    const before = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><aside id="record-editor"></aside></body></html>`;
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><aside id="record-editor"><div><h2>Edit User</h2><form>${bigForm}</form></div></aside></body></html>`;
    const diff = await regionDiff(before, after);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.root).toBe('#record-editor');
  });

  it('descends through anonymous and utility-class wrappers to a semantic root', async () => {
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div><div class="bg-overlay"><div><div class="editor-modal"><h2>Edit User</h2><form>${bigForm}</form></div></div></div></div></body></html>`;
    const diff = await regionDiff(basePage, after);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.root).toBe('div.editor-modal');
  });

  it('yields a rootless overlay instead of a positional xpath when nothing is semantic', async () => {
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div><div><div><h2>Edit User</h2>${bigForm}</div></div></div></body></html>`;
    const diff = await regionDiff(basePage, after);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.root).toBeNull();
    expect(overlay!.xpath).toBe('//body/div[2]');
    expect(overlay!.describe()).not.toContain('//body');
  });

  it('names the region from the heading that was not on the page before', async () => {
    const before = `<html><body><div id="app"><h2>New Plan</h2><ul>${bigList}</ul></div></body></html>`;
    const after = `<html><body><div id="app"><h2>New Plan</h2><ul>${bigList}</ul></div><div class="picker"><h2>New Plan</h2><h3>Select tests for plan</h3><form>${bigForm}</form></div></body></html>`;
    const diff = await regionDiff(before, after);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.name).toBe('Select tests for plan');
  });

  it('classifies an open in-flow region as inline', async () => {
    const diff = await regionDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(pageProbing(regionProbe({ floating: false }))).detectRegion(diff);
    expect(overlay!.type).toBe('region');
    expect(overlay!.isModal).toBe(false);
    expect(overlay!.isOpen).toBe(true);
  });

  it('discards a region whose center belongs to another element', async () => {
    const diff = await regionDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(pageProbing(regionProbe({ centerBelongs: false }))).detectRegion(diff);
    expect(overlay).toBeNull();
  });

  it('keeps an off-screen region as inline instead of discarding it', async () => {
    const diff = await regionDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(pageProbing(regionProbe({ onScreen: false, centerBelongs: false }))).detectRegion(diff);
    expect(overlay!.type).toBe('region');
  });

  it('degrades to an inline region when no page is available', async () => {
    const diff = await regionDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(null).detectRegion(diff);
    expect(overlay!.type).toBe('region');
  });

  it('degrades to an inline region when the probe fails', async () => {
    const diff = await regionDiff(basePage, pageWithDrawer);
    const failing = { evaluate: async () => Promise.reject(new Error('page crashed')) };
    const overlay = await new OverlayPage(failing).detectRegion(diff);
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
    const diff = await regionDiff(basePage, pageWithDrawer);
    const overlay = await new OverlayPage(executing).detectRegion(diff);
    expect(String(captured)).toMatch(/window|document/);
    expect(overlay!.type).toBe('region');
  });

  it('detects a mid-size panel between the floor and the old 10K threshold', async () => {
    const midForm = Array.from({ length: 90 }, (_, i) => `<div><label>Field ${i}</label><input name="field-${i}" placeholder="value ${i}"></div>`).join('');
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div class="drawer"><h2>New Plan</h2><form>${midForm}</form></div></body></html>`;
    const diff = await regionDiff(basePage, after);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.name).toBe('New Plan');
    expect(overlay!.root).toBe('div.drawer');
  });

  it('probes the largest appeared element when an empty guard appears alongside the panel', async () => {
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div class="guard"></div><div class="panel"><h2>Edit User</h2><form>${bigForm}</form></div></body></html>`;
    const diff = await regionDiff(basePage, after);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.root).toBe('div.panel');
    expect(overlay!.xpath).toBe('//body/div[3]');
  });

  it('drops a large appearance that has neither a heading nor a semantic root', async () => {
    const anonymousRows = Array.from({ length: 150 }, (_, i) => `<div><span>Row content number ${i} without any identity</span></div>`).join('');
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div><div>${anonymousRows}</div></div></body></html>`;
    const diff = await regionDiff(basePage, after);
    expect(await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff)).toBeNull();
  });

  it('prefers a fresh-heading candidate over a larger reflowed one, skipping an oversized flood', async () => {
    const before = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div id="overlays"></div><div class="shell-pane"></div></body></html>`;
    const flood = Array.from({ length: 2000 }, (_, i) => `<li><a href="/u/${i}">User row filler text ${i}</a></li>`).join('');
    const midForm = Array.from({ length: 120 }, (_, i) => `<div><label>Field ${i}</label><input name="field-${i}"></div>`).join('');
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div>${flood}<div id="overlays"><div class="dialog"><h2>Pick a suite</h2><form>${midForm}</form></div></div><div class="shell-pane"><div><h1>Users</h1><ul>${bigList}</ul></div></div></body></html>`;
    const diff = await regionDiff(before, after);
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.name).toBe('Pick a suite');
    expect(overlay!.root).toBe('#overlays');
  });

  it('moves to the next candidate when the largest one is covered', async () => {
    const before = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><aside id="back-panel"></aside><aside id="front-panel"></aside></body></html>`;
    const midForm = Array.from({ length: 120 }, (_, i) => `<div><label>Field ${i}</label><input name="field-${i}"></div>`).join('');
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><aside id="back-panel"><div class="behind"><h2>Background panel</h2><form>${bigForm}</form></div></aside><aside id="front-panel"><div class="front"><h2>Front dialog</h2><form>${midForm}</form></div></aside></body></html>`;
    const diff = await regionDiff(before, after);
    const probing = {
      evaluate: async (_fn: any, arg: any) => {
        if (arg.config.xpath === '//body/aside[1]/div[1]') return regionProbe({ centerBelongs: false });
        return regionProbe();
      },
    };
    const overlay = await new OverlayPage(probing).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.root).toBe('#front-panel');
  });

  it('treats a change spanning most of the page as a new state, not a region', async () => {
    const smallBase = '<html><body><div id="app"><h1>Users</h1></div></body></html>';
    const takeover = `<html><body><div id="app"><h1>Users</h1></div><div class="drawer"><h2>Edit User</h2><form>${bigForm}</form></div></body></html>`;
    const diff = await regionDiff(smallBase, takeover);
    expect(await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff)).toBeNull();
  });

  it('rejects scattered changes with no dominant region', async () => {
    const moreRows = Array.from({ length: 200 }, (_, i) => `<li><a href="/users/new-${i}">Newly Loaded User ${i} entry</a></li>`).join('');
    const after = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}${moreRows}</ul></div><div class="drawer"><h2>Edit User</h2><form>${bigForm}</form></div></body></html>`;
    const diff = await regionDiff(basePage, after);
    expect(await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff)).toBeNull();
  });

  it('detects a route-synced drawer across a URL change when the page survived', async () => {
    const diff = await regionDiff(basePage, pageWithDrawer, { sameUrl: false });
    const overlay = await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff);
    expect(overlay).not.toBeNull();
    expect(overlay!.type).toBe('overlay');
  });

  it('treats a replaced page across navigation as no region', async () => {
    const otherPage = `<html><body><div class="dashboard"><h1>Dashboard</h1><form>${bigForm}</form></div></body></html>`;
    const diff = await regionDiff(basePage, otherPage, { sameUrl: false });
    expect(await new OverlayPage(pageProbing(regionProbe())).detectRegion(diff)).toBeNull();
  });

  it('returns null when the appeared content is below the threshold', async () => {
    const before = '<html><body><div id="app"><h1>Users</h1></div></body></html>';
    const after = '<html><body><div id="app"><h1>Users</h1></div><div class="toast">Saved successfully</div></body></html>';
    const diff = await regionDiff(before, after);
    expect(await new OverlayPage(null).detectRegion(diff)).toBeNull();
  });

  it('returns null when nothing appeared', async () => {
    const diff = await regionDiff(basePage, basePage);
    expect(await new OverlayPage(null).detectRegion(diff)).toBeNull();
  });
});

describe('OverlayPage.isStillOpen', () => {
  const overlay = new Overlay({ type: 'overlay', name: 'Edit User', xpath: '//body/div[2]' });

  it('stays open while the center belongs to the region', async () => {
    expect(await new OverlayPage(pageProbing(regionProbe())).isStillOpen(overlay)).toBe(true);
  });

  it('closes when the element is gone', async () => {
    expect(await new OverlayPage(pageProbing(regionProbe({ found: false }))).isStillOpen(overlay)).toBe(false);
  });

  it('closes when the center belongs to in-flow content that replaced it', async () => {
    expect(await new OverlayPage(pageProbing(regionProbe({ centerBelongs: false }))).isStillOpen(overlay)).toBe(false);
  });

  it('stays open while another overlay covers its center', async () => {
    expect(await new OverlayPage(pageProbing(regionProbe({ centerBelongs: false, coveredByFloating: true }))).isStillOpen(overlay)).toBe(true);
  });

  it('keeps carrying when the probe cannot run', async () => {
    expect(await new OverlayPage(null).isStillOpen(overlay)).toBe(true);
    const failing = { evaluate: async () => Promise.reject(new Error('gone')) };
    expect(await new OverlayPage(failing).isStillOpen(overlay)).toBe(true);
  });

  it('keeps carrying an overlay that has no xpath', async () => {
    expect(await new OverlayPage(pageProbing(regionProbe({ found: false }))).isStillOpen(new Overlay({ type: 'overlay', name: 'Aria' }))).toBe(true);
  });
});

const pageWithConfirm = `<html><body><div id="app"><h1>Users</h1><ul>${bigList}</ul></div><div class="drawer"><h2>Edit User</h2><form>${bigForm}</form></div><div class="confirm"><h2>Confirm delete</h2><form>${bigForm}</form></div></body></html>`;

const pageProbingXPaths = (probes: Record<string, unknown>) => ({
  evaluate: async (_fn: unknown, arg: any) => probes[arg.config.xpath] ?? regionProbe({ found: false }),
});

describe('Action region replacement', () => {
  const url = 'https://app.example.com/users';

  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  const closedDrawer = (parent?: RegionData) => new ActionResult({ url, html: pageWithDrawer, overlay: { type: 'overlay', name: 'Edit User', root: 'div.drawer', xpath: '//body/div[2]', parent } });

  const detect = async (previous: ActionResult, result: ActionResult, probes: Record<string, unknown>) => {
    const action = new Action({} as any, { getCurrentState: () => previous, updateState: () => {} } as any);
    action.playwrightHelper = { page: pageProbingXPaths({ '//body/div[2]': regionProbe({ found: false }), ...probes }) };
    await (action as any).detectRegion(result);
  };

  it('enriches the replacement that opened as the previous region closed', async () => {
    const result = new ActionResult({ url, html: pageWithConfirm, ariaSnapshot: '- dialog "Confirm delete"' });
    await detect(closedDrawer(), result, { '//body/div[3]': regionProbe() });
    expect(result.overlay.name).toBe('Confirm delete');
    expect(result.overlay.type).toBe('overlay');
    expect(result.overlay.root).toBe('div.confirm');
    expect(result.overlay.xpath).toBe('//body/div[3]');
  });

  it('keeps the replacement instead of restoring the parent of the closed region', async () => {
    const result = new ActionResult({ url, html: pageWithConfirm, ariaSnapshot: '- dialog "Confirm delete"' });
    const previous = closedDrawer({ type: 'overlay', name: 'Outer', root: 'aside.outer', xpath: '//body/aside[1]' });
    await detect(previous, result, { '//body/div[3]': regionProbe(), '//body/aside[1]': regionProbe() });
    expect(result.overlay.name).toBe('Confirm delete');
  });

  it('restores the parent without detecting a region when nothing replaced the closed one', async () => {
    const result = new ActionResult({ url, html: pageWithConfirm });
    const previous = closedDrawer({ type: 'overlay', name: 'Outer', root: 'aside.outer', xpath: '//body/aside[1]' });
    await detect(previous, result, { '//body/div[3]': regionProbe(), '//body/aside[1]': regionProbe() });
    expect(result.overlay.name).toBe('Outer');
    expect(result.overlay.root).toBe('aside.outer');
  });
});
