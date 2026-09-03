import { detectFocusArea } from './aria.js';
import { HTML_SELECTORS } from './html.js';
import { createDebug } from './logger.js';
import { Region, type RegionData, type RegionDiff, addedSubtrees } from './region.js';

const debugLog = createDebug('explorbot:overlay');

export class Overlay extends Region {
  constructor(data: RegionData = {}) {
    super({ ...data, type: 'overlay' });
  }

  get isModal(): boolean {
    return true;
  }

  withGeometry(geometry: Region): Overlay {
    return new Overlay({
      name: this.name || geometry.name,
      root: geometry.root,
      html: geometry.html,
      xpath: geometry.xpath,
    });
  }

  static fromAria(snapshot: string | null): Region {
    const focus = detectFocusArea(snapshot);
    if (!focus.type) return new Region();
    return new Overlay({ name: focus.name });
  }

  static resolve(data: { overlay?: RegionData | null; ariaSnapshot?: string | null }): Region {
    if (data.overlay?.type === 'overlay') return new Overlay(data.overlay);
    if (data.overlay) return new Region(data.overlay);
    return Overlay.fromAria(data.ariaSnapshot ?? null);
  }
}

export class OverlayPage {
  constructor(private page: { evaluate(fn: any, arg: any): Promise<any> } | null) {}

  async detectRegion(diff: RegionDiff): Promise<Region | null> {
    if (!diff.sameUrl && diff.similarity < SOFT_NAVIGATION_SIMILARITY) return null;
    for (const added of addedSubtrees(diff)) {
      const layout = await this.measure(added.xpath);
      if (layout?.rendered && layout.inViewport && !layout.centerBelongs) {
        debugLog('Added content is hidden or covered, trying the next candidate');
        continue;
      }
      const overlaying = !!layout?.rendered && layout.outOfFlow && layout.inViewport;
      if (overlaying && modalScore(layout) < MIN_MODAL_SCORE) {
        debugLog('Out-of-flow content is a popover, not an overlay; ignoring it');
        continue;
      }
      if (!overlaying && !added.sizable) {
        debugLog('In-flow content is under the region floor, ignoring it');
        continue;
      }
      const data = { name: added.name, root: added.root, html: added.html, xpath: added.xpath };
      let region: Region = new Region({ ...data, type: 'region' });
      if (overlaying) region = new Overlay(data);
      debugLog(`Region detected: ${region.describe()}`);
      return region;
    }
    return null;
  }

  async isStillOpen(region: Region): Promise<boolean> {
    if (!region.xpath) return true;
    const probe = await this.measure(region.xpath);
    if (!probe) return true;
    if (!probe.rendered) return false;
    if (probe.inViewport && !probe.centerBelongs && !probe.coveredOutOfFlow) return false;
    return true;
  }

  private async measure(xpath: string): Promise<RegionLayout | null> {
    if (!this.page) return null;
    return this.page.evaluate(measureLayout, { config: { xpath, controlsSelector: HTML_SELECTORS.interactiveControl } }).catch((err: Error) => {
      debugLog('Layout measurement failed:', err.message);
      return null;
    });
  }
}

const SOFT_NAVIGATION_SIMILARITY = 50;
const TYPICAL_DIALOG_CONTROLS = 3;
const MIN_MODAL_SCORE = 0.25;

const modalScore = (layout: RegionLayout | null): number => {
  if (!layout) return 0;
  let blocked = layout.viewportCoverage;
  if (layout.holdsViewportCenter) blocked = 1;
  return blocked * Math.min(1, layout.controls / TYPICAL_DIALOG_CONTROLS);
};

// Passed to page.evaluate as a function — must stay self-contained with no outer-scope references.
function measureLayout({ config }: { config: { xpath: string; controlsSelector: string } }): RegionLayout {
  const layout: RegionLayout = { rendered: false, inViewport: false, outOfFlow: false, centerBelongs: false, coveredOutOfFlow: false, holdsViewportCenter: false, viewportCoverage: 0, controls: 0 };

  const isOutOfFlow = (start: HTMLElement | null): boolean => {
    let node = start;
    while (node && node !== document.body) {
      const position = window.getComputedStyle(node).position;
      if (position === 'fixed' || position === 'absolute') return true;
      node = node.parentElement;
    }
    return false;
  };

  const clip = (rect: DOMRect) => {
    const left = Math.max(rect.left, 0);
    const top = Math.max(rect.top, 0);
    const right = Math.min(rect.right, window.innerWidth);
    const bottom = Math.min(rect.bottom, window.innerHeight);
    return { left, top, right, bottom, area: Math.max(0, right - left) * Math.max(0, bottom - top) };
  };

  const result = document.evaluate(config.xpath, document, null, 9, null);
  const node = result.singleNodeValue;
  if (!node || node.nodeType !== 1) return layout;
  const element = node as HTMLElement;
  const belongs = (hit: Element | null): boolean => !!hit && (hit === element || element.contains(hit));

  let box: HTMLElement = element;
  let outOfFlow = isOutOfFlow(element);
  let boxArea = 0;
  if (outOfFlow) boxArea = clip(element.getBoundingClientRect()).area;
  const MAX_DESCENDANTS_SCANNED = 200;
  const descendants = Array.from(element.querySelectorAll('*')).slice(0, MAX_DESCENDANTS_SCANNED) as HTMLElement[];
  for (const descendant of descendants) {
    if (!isOutOfFlow(descendant)) continue;
    const area = clip(descendant.getBoundingClientRect()).area;
    if (area <= boxArea) continue;
    box = descendant;
    boxArea = area;
    outOfFlow = true;
  }

  const rect = box.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return layout;
  layout.rendered = true;
  layout.outOfFlow = outOfFlow;
  layout.controls = Array.from(element.querySelectorAll(config.controlsSelector)).filter((control) => control.getClientRects().length > 0).length;

  const { left, top, right, bottom, area } = clip(rect);
  if (right <= left || bottom <= top) return layout;
  layout.inViewport = true;
  layout.viewportCoverage = area / (window.innerWidth * window.innerHeight);

  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  layout.centerBelongs = belongs(hit);
  if (hit && !layout.centerBelongs) layout.coveredOutOfFlow = isOutOfFlow(hit as HTMLElement);
  layout.holdsViewportCenter = belongs(document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2));
  return layout;
}

interface RegionLayout {
  rendered: boolean;
  inViewport: boolean;
  outOfFlow: boolean;
  centerBelongs: boolean;
  coveredOutOfFlow: boolean;
  holdsViewportCenter: boolean;
  viewportCoverage: number;
  controls: number;
}
