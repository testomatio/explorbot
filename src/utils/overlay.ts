import { detectFocusArea } from './aria.js';
import { type HtmlDiffPart, pathToXPath } from './html-diff.js';
import { HTML_EXTRACTION_LIMITS, HTML_SELECTORS, HTML_VISIBILITY_LIMITS, type VisibleOverlayExtractionConfig, extractHeadings } from './html.js';

export const OVERLAY_SELECTORS = {
  semanticOverlays: ['[role="dialog"]', '[role="listbox"]', '[role="menu"]', '[role="tooltip"]:not([style*="display: none"]):not([style*="visibility: hidden"])', '[class*="modal"]', '[class*="dialog"]', '[class*="overlay"]', '[class*="popup"]', '[class*="drawer"]', '[class*="lightbox"]'],
  modalOverlays: ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', '[class*="modal"]', '[class*="dialog"]', '[class*="overlay"]', '[class*="popup"]', '[class*="drawer"]', '[class*="lightbox"]'],
  overlaySemanticSelector: '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="listbox"], [role="menu"], [role="tooltip"]',
} as const;

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

  static fromHtml(html: string): Overlay {
    return new Overlay({ type: 'modal', name: Overlay.nameFromHtml(html) });
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

  static resolve(data: { overlayHtml?: string; overlay?: OverlayData | null; ariaSnapshot?: string | null }): Overlay {
    if (data.overlayHtml) return Overlay.fromHtml(data.overlayHtml);
    if (data.overlay) return new Overlay(data.overlay);
    return Overlay.fromAria(data.ariaSnapshot ?? null);
  }

  static captureConfig(): VisibleOverlayExtractionConfig {
    return {
      interactiveContentSelector: HTML_SELECTORS.interactiveContent,
      limits: HTML_EXTRACTION_LIMITS,
      overlaySelectors: OVERLAY_SELECTORS.modalOverlays,
      overlaySemanticSelector: OVERLAY_SELECTORS.overlaySemanticSelector,
      visibilityLimits: HTML_VISIBILITY_LIMITS,
      geometryFallback: false,
    };
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
