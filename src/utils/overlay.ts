import { detectFocusArea } from './aria.js';
import type { HtmlDiffPart } from './html-diff.js';
import { pathToXPath } from './html-diff.js';
import { extractHeadings } from './html.js';
import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:overlay');

export type OverlayType = 'dialog' | 'modal' | 'drawer' | 'region';
export type OverlayData = {
  type?: OverlayType | null;
  name?: string | null;
  root?: string | null;
  html?: string | null;
  xpath?: string | null;
  parent?: OverlayData | null;
};

export class Overlay {
  readonly type: OverlayType | null;
  readonly name: string | null;
  readonly root: string | null;
  readonly html: string | null;
  readonly xpath: string | null;
  readonly parent: OverlayData | null;

  constructor(data: OverlayData = {}) {
    this.type = data.type ?? null;
    this.name = data.name ?? null;
    this.root = data.root ?? null;
    this.html = data.html ?? null;
    this.xpath = data.xpath ?? null;
    this.parent = data.parent ?? null;
  }

  get detected(): boolean {
    return this.type !== null && this.type !== 'region';
  }

  get present(): boolean {
    return this.type !== null;
  }

  describe(): string {
    if (!this.present) return '';
    let text = `${this.type} "${this.name || 'unnamed'}" opened`;
    if (this.root) text += `, scope: ${this.root}`;
    return text;
  }

  withGeometry(geometry: Overlay): Overlay {
    return new Overlay({
      type: this.type,
      name: this.name || geometry.name,
      root: geometry.root,
      html: geometry.html,
      xpath: geometry.xpath,
    });
  }

  withParent(parent: Overlay): Overlay {
    return new Overlay({
      type: this.type,
      name: this.name,
      root: this.root,
      html: this.html,
      xpath: this.xpath,
      parent: { type: parent.type, name: parent.name, root: parent.root, xpath: parent.xpath },
    });
  }

  static fromAria(snapshot: string | null): Overlay {
    return new Overlay(detectFocusArea(snapshot));
  }

  static resolve(data: { overlay?: OverlayData | null; ariaSnapshot?: string | null }): Overlay {
    if (data.overlay) return new Overlay(data.overlay);
    return Overlay.fromAria(data.ariaSnapshot ?? null);
  }
}

export class OverlayPage {
  constructor(private page: { evaluate(fn: any, arg: any): Promise<any> } | null) {}

  async detectRegion(diff: RegionDiff): Promise<Overlay | null> {
    if (!diff.sameUrl && diff.similarity < SOFT_NAVIGATION_SIMILARITY) return null;
    for (const subRoot of this.appearedSubRoots(diff)) {
      const probe = await this.probe(subRoot.elementXPath);
      if (probe?.found && probe.onScreen && !probe.centerBelongs) {
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

  async isStillOpen(overlay: Overlay): Promise<boolean> {
    if (!overlay.xpath) return true;
    const probe = await this.probe(overlay.xpath);
    if (!probe) return true;
    if (!probe.found) return false;
    if (probe.onScreen && !probe.centerBelongs) return false;
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

  private async probe(xpath: string): Promise<RegionProbe | null> {
    if (!this.page) return null;
    return this.page
      .evaluate(
        ({ probeSource, config }: { probeSource: string; config: any }) => {
          const probe = new Function(`return ${probeSource}`)() as (config: any) => any;
          return probe(config);
        },
        { probeSource: inspectRegion.toString(), config: { xpath } }
      )
      .catch((err: Error) => {
        debugLog('Region probe failed:', err.message);
        return null;
      });
  }

  private toOverlay(subRoot: AppearedSubRoot, probe: RegionProbe | null, previousHtml: string): Overlay {
    let type: OverlayType = 'region';
    if (probe?.centerBelongs && probe.floating) {
      type = 'drawer';
      if (probe.coverage >= FULL_COVERAGE_RATIO) type = 'modal';
    }
    let root: string | null = null;
    if (subRoot.container !== 'body' && !subRoot.container.startsWith('//')) root = subRoot.container;
    if (!root && subRoot.appearedSelector) root = subRoot.appearedSelector;
    return new Overlay({ type, name: this.nameFrom(subRoot.subtree, previousHtml), root, html: subRoot.subtree, xpath: subRoot.elementXPath });
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
const FULL_COVERAGE_RATIO = 0.8;
const SOFT_NAVIGATION_SIMILARITY = 50;
const REGION_MAX_RATIO = 0.6;
const REGION_DOMINANCE = 0.7;

// Serialized via toString() into page.evaluate — must stay a plain function with no outer-scope references.
function inspectRegion(config: { xpath: string }): RegionProbe {
  const probe: RegionProbe = { found: false, onScreen: false, floating: false, coverage: 0, centerBelongs: false };

  const result = document.evaluate(config.xpath, document, null, 9, null);
  const node = result.singleNodeValue;
  if (!node || node.nodeType !== 1) return probe;
  const element = node as HTMLElement;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return probe;
  probe.found = true;

  let node2: HTMLElement | null = element;
  while (node2 && node2 !== document.body && !probe.floating) {
    const style = window.getComputedStyle(node2);
    if (style.position === 'fixed' || style.position === 'absolute' || (Number.parseInt(style.zIndex || '0', 10) || 0) > 0) probe.floating = true;
    node2 = node2.parentElement;
  }

  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  if (right <= left || bottom <= top) return probe;
  probe.onScreen = true;
  probe.coverage = ((right - left) * (bottom - top)) / (window.innerWidth * window.innerHeight);

  const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
  probe.centerBelongs = !!hit && (hit === element || element.contains(hit));
  return probe;
}

export interface RegionDiff {
  parts: HtmlDiffPart[];
  pageSize: number;
  similarity: number;
  sameUrl: boolean;
  previousHtml: string;
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

interface RegionProbe {
  found: boolean;
  onScreen: boolean;
  floating: boolean;
  coverage: number;
  centerBelongs: boolean;
}
