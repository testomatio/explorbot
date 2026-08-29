import { detectFocusArea } from './aria.js';
import { type HtmlDiffPart, pathToXPath } from './html-diff.js';
import { extractHeadings } from './html.js';
import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:overlay');

export type OverlayType = 'dialog' | 'modal' | 'drawer' | 'region';
export type OverlayData = { type?: OverlayType | null; name?: string | null; root?: string | null; html?: string | null };

export class Overlay {
  readonly type: OverlayType | null;
  readonly name: string | null;
  readonly root: string | null;
  readonly html: string | null;

  constructor(data: OverlayData = {}) {
    this.type = data.type ?? null;
    this.name = data.name ?? null;
    this.root = data.root ?? null;
    this.html = data.html ?? null;
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

  async detectRegion(parts: HtmlDiffPart[]): Promise<Overlay | null> {
    const subRoot = this.appearedSubRoot(parts);
    if (!subRoot) return null;
    const probe = await this.probe(subRoot.elementXPath);
    if (probe?.found && probe.onScreen && !probe.centerBelongs) {
      debugLog('Appeared region is hidden or covered, ignoring it');
      return null;
    }
    const overlay = this.toOverlay(subRoot, probe);
    debugLog(`Region detected: ${overlay.describe()}`);
    return overlay;
  }

  private appearedSubRoot(parts: HtmlDiffPart[]): AppearedSubRoot | null {
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

  private toOverlay(subRoot: AppearedSubRoot, probe: RegionProbe | null): Overlay {
    let type: OverlayType = 'region';
    if (probe?.centerBelongs && probe.floating) {
      type = 'drawer';
      if (probe.coverage >= FULL_COVERAGE_RATIO) type = 'modal';
    }
    let root = subRoot.container;
    if (root === 'body') root = subRoot.elementXPath;
    return new Overlay({ type, name: this.nameFrom(subRoot.subtree), root, html: subRoot.subtree });
  }

  private nameFrom(html: string): string | null {
    const headings = extractHeadings(html);
    return [headings.h1, headings.h2, headings.h3, headings.h4].filter(Boolean).join(' ') || null;
  }
}

const SUBROOT_MIN_HTML = 10_000;
const FULL_COVERAGE_RATIO = 0.8;

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

  const style = window.getComputedStyle(element);
  probe.floating = style.position === 'fixed' || style.position === 'absolute' || (Number.parseInt(style.zIndex || '0', 10) || 0) > 0;

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

interface AppearedSubRoot {
  container: string;
  elementXPath: string;
  subtree: string;
  size: number;
}

interface RegionProbe {
  found: boolean;
  onScreen: boolean;
  floating: boolean;
  coverage: number;
  centerBelongs: boolean;
}
