import 'parse5';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ActionResult } from '../../src/action-result.ts';
import { HTML_EXTRACTION_LIMITS, HTML_SELECTORS, HTML_VISIBILITY_LIMITS, type VisibleOverlayExtractionConfig, extractVisibleOverlayHtml } from '../../src/utils/html.ts';
import { OVERLAY_SELECTORS, Overlay } from '../../src/utils/overlay.ts';

function overlayConfig(overrides: Partial<VisibleOverlayExtractionConfig> = {}): VisibleOverlayExtractionConfig {
  return {
    interactiveContentSelector: HTML_SELECTORS.interactiveContent,
    limits: HTML_EXTRACTION_LIMITS,
    overlaySelectors: OVERLAY_SELECTORS.modalOverlays,
    overlaySemanticSelector: OVERLAY_SELECTORS.overlaySemanticSelector,
    visibilityLimits: HTML_VISIBILITY_LIMITS,
    ...overrides,
  };
}

function withDom(html: string, run: () => void) {
  const dom = new JSDOM(html);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (dom.window.Element.prototype as any).getBoundingClientRect = () => ({ width: 480, height: 320, top: 40, left: 40, bottom: 360, right: 520, x: 40, y: 40, toJSON: () => ({}) });
  try {
    run();
  } finally {
    (globalThis as any).window = previousWindow;
    (globalThis as any).document = previousDocument;
  }
}

describe('extractVisibleOverlayHtml', () => {
  it('keeps only the innermost overlay when wrapper and dialog are both floating', () => {
    withDom(
      `
      <html><body>
        <div class="nebula-modal-root" style="position: absolute; z-index: 40">
          <div class="nebula-modal-dialog" style="position: absolute">
            <h3>Copy report</h3>
            <button>Copy</button>
          </div>
        </div>
      </body></html>
      `,
      () => {
        const html = extractVisibleOverlayHtml(overlayConfig());
        expect(html).toContain('nebula-modal-dialog');
        expect(html).not.toContain('nebula-modal-root');
      }
    );
  });

  it('collects the floating wrapper when nested elements only carry the class token', () => {
    withDom(
      `
      <html><body>
        <div class="nebula-modal-root" style="position: fixed; z-index: 40">
          <div class="nebula-modal-backdrop">
            <div class="nebula-modal-dialog">
              <h3>Copy report</h3>
              <button>Copy</button>
            </div>
          </div>
        </div>
      </body></html>
      `,
      () => {
        const html = extractVisibleOverlayHtml(overlayConfig());
        expect(html).toContain('Copy report');
        expect(html.split('--- overlay ---')).toHaveLength(1);
      }
    );
  });

  it('ignores a class token on a sticky header', () => {
    withDom(
      `
      <html><body>
        <header class="site-overlay-bar" style="position: sticky">
          <button>Menu</button>
          <h2>Reports</h2>
        </header>
      </body></html>
      `,
      () => {
        expect(extractVisibleOverlayHtml(overlayConfig({ geometryFallback: false }))).toBe('');
      }
    );
  });

  it('trusts semantic markup without requiring floating geometry', () => {
    withDom(
      `
      <html><body>
        <section role="dialog">
          <h2>Confirm launch</h2>
          <button>Go</button>
        </section>
      </body></html>
      `,
      () => {
        const html = extractVisibleOverlayHtml(overlayConfig({ geometryFallback: false }));
        expect(html).toContain('Confirm launch');
      }
    );
  });

  it('skips the geometry fallback at capture and keeps it for driller', () => {
    const markup = `
      <html><body>
        <div class="toast-panel" style="position: fixed; z-index: 30">Saved</div>
      </body></html>
      `;
    withDom(markup, () => {
      expect(extractVisibleOverlayHtml(overlayConfig({ geometryFallback: false }))).toBe('');
    });
    withDom(markup, () => {
      expect(extractVisibleOverlayHtml(overlayConfig())).toContain('toast-panel');
    });
  });
});

describe('ActionResult overlay', () => {
  it('derives the modal descriptor from captured overlay html', () => {
    const result = new ActionResult({
      url: '/',
      overlayHtml: '<div><h3>Copy report</h3><h4>to Nebula space</h4></div>',
    });
    expect(result.overlay.detected).toBe(true);
    expect(result.overlay.type).toBe('modal');
    expect(result.overlay.name).toBe('Copy report to Nebula space');
  });

  it('falls back to the aria snapshot when no overlay html was captured', () => {
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
  it('resolves captured html first, stored descriptor second, aria last', () => {
    const aria = '- dialog "From aria"';
    expect(Overlay.resolve({ overlayHtml: '<h3>From html</h3>', overlay: { type: 'modal', name: 'Stored' }, ariaSnapshot: aria }).name).toBe('From html');
    expect(Overlay.resolve({ overlay: { type: 'modal', name: 'Stored' }, ariaSnapshot: aria }).name).toBe('Stored');
    expect(Overlay.resolve({ ariaSnapshot: aria }).name).toBe('From aria');
  });

  it('rehydrates from a plain persisted descriptor', () => {
    expect(new Overlay({ type: 'modal', name: 'Copy report' }).detected).toBe(true);
    expect(new Overlay().detected).toBe(false);
  });
});
