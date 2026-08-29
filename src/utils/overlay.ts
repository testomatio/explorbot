import { detectFocusArea } from './aria.js';
import { type HtmlDiffPart, pathToXPath } from './html-diff.js';
import { extractHeadings } from './html.js';

export type OverlayType = 'dialog' | 'modal' | 'drawer' | 'region';
export type OverlayData = { type?: OverlayType | null; name?: string | null; root?: string | null };

export class Overlay {
  readonly type: OverlayType | null;
  readonly name: string | null;
  readonly root: string | null;

  constructor(data: OverlayData = {}) {
    this.type = data.type ?? null;
    this.name = data.name ?? null;
    this.root = data.root ?? null;
  }

  get detected(): boolean {
    return this.type !== null && this.type !== 'region';
  }

  get present(): boolean {
    return this.type !== null;
  }

  static fromSubRoot(subRoot: AppearedSubRoot, verdict: RegionVerdict): Overlay {
    let type: OverlayType = 'region';
    if (verdict.overlays) {
      type = 'drawer';
      if (verdict.coverage >= FULL_COVERAGE_RATIO) type = 'modal';
    }
    let root = subRoot.container;
    if (root === 'body') root = subRoot.elementXPath;
    return new Overlay({ type, name: Overlay.nameFromHtml(subRoot.subtree), root });
  }

  static fromAria(snapshot: string | null): Overlay {
    return new Overlay(detectFocusArea(snapshot));
  }

  static resolve(data: { overlay?: OverlayData | null; ariaSnapshot?: string | null }): Overlay {
    if (data.overlay) return new Overlay(data.overlay);
    return Overlay.fromAria(data.ariaSnapshot ?? null);
  }

  private static nameFromHtml(html: string): string | null {
    const headings = extractHeadings(html);
    return [headings.h1, headings.h2, headings.h3, headings.h4].filter(Boolean).join(' ') || null;
  }
}

const SUBROOT_MIN_HTML = 10_000;
const FULL_COVERAGE_RATIO = 0.8;

export function findAppearedSubRoot(parts: HtmlDiffPart[]): AppearedSubRoot | null {
  let best: AppearedSubRoot | null = null;
  for (const part of parts) {
    const appeared = part.added.find((line) => line.startsWith('ELEMENT:'));
    if (!appeared) continue;
    if (part.subtree.length < SUBROOT_MIN_HTML) continue;
    if (best && part.subtree.length <= best.size) continue;
    best = {
      container: part.container,
      elementXPath: pathToXPath(appeared.slice('ELEMENT:'.length)),
      subtree: part.subtree,
      size: part.subtree.length,
    };
  }
  return best;
}

export function classifyRegionCoverage(samples: RegionCoverageSamples | null): RegionVerdict {
  if (!samples?.found) return { overlays: false, coverage: 0 };
  const viewportArea = samples.viewport.width * samples.viewport.height;
  if (!viewportArea) return { overlays: false, coverage: 0 };

  const rect = samples.rect;
  const visibleWidth = Math.min(rect.x + rect.width, samples.viewport.width) - Math.max(rect.x, 0);
  const visibleHeight = Math.min(rect.y + rect.height, samples.viewport.height) - Math.max(rect.y, 0);
  const coverage = (Math.max(0, visibleWidth) * Math.max(0, visibleHeight)) / viewportArea;

  if (coverage >= FULL_COVERAGE_RATIO) return { overlays: true, coverage };
  if (samples.siblingsInert) return { overlays: true, coverage };

  const floating = samples.position === 'fixed' || samples.position === 'absolute' || samples.zIndex > 0;
  if (!floating) return { overlays: false, coverage };

  const outside = samples.outsideHits;
  if (outside.length > 0 && outside.every((hit) => hit !== 'page')) return { overlays: true, coverage };
  if (samples.bodyScrollLocked && outside.length > 0 && outside.filter((hit) => hit !== 'page').length * 2 >= outside.length) return { overlays: true, coverage };

  return { overlays: false, coverage };
}

export function probeRegionCoverage(config: { xpath: string }): RegionCoverageSamples {
  const samples: RegionCoverageSamples = {
    found: false,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    position: 'static',
    zIndex: 0,
    outsideHits: [],
    siblingsInert: false,
    bodyScrollLocked: false,
  };

  const result = document.evaluate(config.xpath, document, null, 9, null);
  const node = result.singleNodeValue;
  if (!node || node.nodeType !== 1) return samples;
  const element = node as HTMLElement;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return samples;

  const style = window.getComputedStyle(element);
  samples.found = true;
  samples.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  samples.position = style.position;
  samples.zIndex = Number.parseInt(style.zIndex || '0', 10) || 0;

  const bodyStyle = window.getComputedStyle(document.body);
  samples.bodyScrollLocked = bodyStyle.overflow === 'hidden' || bodyStyle.overflowY === 'hidden';

  for (const sibling of Array.from(element.parentElement?.children || [])) {
    if (sibling === element) continue;
    if (!sibling.hasAttribute('inert') && sibling.getAttribute('aria-hidden') !== 'true') continue;
    samples.siblingsInert = true;
    break;
  }

  function classifyHit(hit: Element | null): 'inside' | 'blocked' | 'page' {
    if (!hit) return 'page';
    if (element.contains(hit)) return 'inside';
    let current: Element | null = hit;
    for (let depth = 0; current && depth < 4; depth++) {
      const hitStyle = window.getComputedStyle(current as HTMLElement);
      const hitZ = Number.parseInt(hitStyle.zIndex || '0', 10) || 0;
      if ((hitStyle.position === 'fixed' || hitStyle.position === 'absolute') && hitZ > 0) return 'blocked';
      current = current.parentElement;
    }
    return 'page';
  }

  const inset = 10;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const points: Array<[number, number]> = [
    [inset, inset],
    [width - inset, inset],
    [inset, height - inset],
    [width - inset, height - inset],
    [width / 2, inset],
    [width / 2, height - inset],
    [inset, height / 2],
    [width - inset, height / 2],
  ];
  for (const [x, y] of points) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) continue;
    samples.outsideHits.push(classifyHit(document.elementFromPoint(x, y)));
  }

  return samples;
}

export function getRegionCoverageProbeSource(): string {
  return probeRegionCoverage.toString();
}

export interface AppearedSubRoot {
  container: string;
  elementXPath: string;
  subtree: string;
  size: number;
}

export interface RegionVerdict {
  overlays: boolean;
  coverage: number;
}

export interface RegionCoverageSamples {
  found: boolean;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  position: string;
  zIndex: number;
  outsideHits: Array<'inside' | 'blocked' | 'page'>;
  siblingsInert: boolean;
  bodyScrollLocked: boolean;
}
