import { detectFocusArea } from './aria.js';
import { pathToXPath } from './html-diff.js';
import { HTML_SELECTORS, extractHeadings } from './html.js';
import { createDebug } from './logger.js';
import { Region, type RegionData, type RegionDiff } from './region.js';

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
    for (const subRoot of this.appearedSubRoots(diff)) {
      const probe = await this.measure(subRoot.elementXPath);
      if (probe?.rendered && probe.inViewport && !probe.centerBelongs) {
        debugLog('Appeared region is hidden or covered, trying the next candidate');
        continue;
      }
      const overlay = this.toOverlay(subRoot, probe, diff.previousHtml);
      if (!overlay.name && !overlay.root) {
        debugLog('Appeared region has no name and no semantic root, ignoring it');
        continue;
      }
      debugLog(`Region detected: ${overlay.describe()}`);
      return overlay;
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

  private appearedSubRoots(diff: RegionDiff): AppearedSubRoot[] {
    const candidates: AppearedSubRoot[] = [];
    for (const part of diff.parts) {
      const appeared = part.added.find((line) => line.startsWith('ELEMENT:'));
      if (!appeared) continue;
      if (part.subtree.length < SUBROOT_MIN_HTML) continue;
      if (diff.pageSize > 0 && part.rawSize > REGION_MAX_RATIO * diff.pageSize) {
        debugLog(`Appeared subtree spans ${Math.round((part.rawSize / diff.pageSize) * 100)}% of the page — a new state, not a region`);
        continue;
      }
      candidates.push({
        container: part.container,
        elementXPath: pathToXPath(appeared.slice('ELEMENT:'.length)),
        subtree: part.subtree,
        size: part.subtree.length,
        rawSize: part.rawSize,
        appearedSelector: part.appearedSelector,
        fresh: !!this.freshHeading(part.subtree, diff.previousHtml),
      });
    }
    if (candidates.length === 0) return [];
    const totalRawSize = candidates.reduce((sum, c) => sum + c.rawSize, 0);
    const largest = Math.max(...candidates.map((c) => c.rawSize));
    if (largest < REGION_DOMINANCE * totalRawSize) {
      debugLog('Changes are scattered across the page, no dominant region');
      return [];
    }
    candidates.sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.size - a.size);
    return candidates;
  }

  private async measure(xpath: string): Promise<RegionLayout | null> {
    if (!this.page) return null;
    return this.page.evaluate(measureLayout, { config: { xpath, controlsSelector: HTML_SELECTORS.interactiveControl } }).catch((err: Error) => {
      debugLog('Layout measurement failed:', err.message);
      return null;
    });
  }

  private toOverlay(subRoot: AppearedSubRoot, probe: RegionLayout | null, previousHtml: string): Region {
    let root: string | null = null;
    if (subRoot.container !== 'body' && !subRoot.container.startsWith('//')) root = subRoot.container;
    if (!root && subRoot.appearedSelector) root = subRoot.appearedSelector;
    const data = { name: this.nameFrom(subRoot.subtree, previousHtml), root, html: subRoot.subtree, xpath: subRoot.elementXPath };
    if (probe?.centerBelongs && probe.outOfFlow) return new Overlay(data);
    return new Region({ ...data, type: 'region' });
  }

  private nameFrom(html: string, previousHtml: string): string | null {
    const fresh = this.freshHeading(html, previousHtml);
    if (fresh) return fresh;
    const candidates = this.headingsOf(html);
    if (candidates.length === 0) return null;
    return candidates.join(' ');
  }

  private freshHeading(html: string, previousHtml: string): string | null {
    const fresh = this.headingsOf(html).filter((heading) => !previousHtml.includes(heading));
    return fresh[0] ?? null;
  }

  private headingsOf(html: string): string[] {
    const headings = extractHeadings(html);
    return [headings.h1, headings.h2, headings.h3, headings.h4].filter(Boolean) as string[];
  }
}

const SUBROOT_MIN_HTML = 5_000;
const SOFT_NAVIGATION_SIMILARITY = 50;
const REGION_MAX_RATIO = 0.6;
const REGION_DOMINANCE = 0.7;

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
  const descendants = Array.from(element.querySelectorAll('*')).slice(0, 200) as HTMLElement[];
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

interface AppearedSubRoot {
  container: string;
  elementXPath: string;
  subtree: string;
  size: number;
  rawSize: number;
  appearedSelector?: string;
  fresh: boolean;
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
