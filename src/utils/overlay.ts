import { detectFocusArea } from './aria.js';
import { HTML_EXTRACTION_LIMITS, HTML_SELECTORS, HTML_VISIBILITY_LIMITS, type VisibleOverlayExtractionConfig, extractHeadings } from './html.js';

export const OVERLAY_SELECTORS = {
  semanticOverlays: ['[role="dialog"]', '[role="listbox"]', '[role="menu"]', '[role="tooltip"]:not([style*="display: none"]):not([style*="visibility: hidden"])', '[class*="modal"]', '[class*="dialog"]', '[class*="overlay"]', '[class*="popup"]', '[class*="drawer"]', '[class*="lightbox"]'],
  modalOverlays: ['[role="dialog"]', '[role="alertdialog"]', '[aria-modal="true"]', '[class*="modal"]', '[class*="dialog"]', '[class*="overlay"]', '[class*="popup"]', '[class*="drawer"]', '[class*="lightbox"]'],
  overlaySemanticSelector: '[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="listbox"], [role="menu"], [role="tooltip"]',
} as const;

export type OverlayData = { type?: 'dialog' | 'modal' | null; name?: string | null };

export class Overlay {
  readonly type: 'dialog' | 'modal' | null;
  readonly name: string | null;

  constructor(data: OverlayData = {}) {
    this.type = data.type ?? null;
    this.name = data.name ?? null;
  }

  get detected(): boolean {
    return this.type !== null;
  }

  static fromHtml(html: string): Overlay {
    const headings = extractHeadings(html);
    const name = [headings.h1, headings.h2, headings.h3, headings.h4].filter(Boolean).join(' ');
    return new Overlay({ type: 'modal', name: name || null });
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
}
