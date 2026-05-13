import { ELEMENT_EXTRACTION_CONFIG, EXPLORBOT_ATTRS, type ElementExtractionConfig, type RawElementData, extractElementData, getElementDataExtractorSource } from './html.ts';
import { type XPathMatch, buildClickableXPath, evaluateXPath, isDynamicId, isGenericClass } from './xpath.ts';

export { extractElementData } from './html.ts';

const KEY_DISPLAY_ATTRS = ['role', 'id', 'class', 'aria-label'];
const KEY_ATTRS = ['role', 'aria-label', 'id', 'name', 'type', 'href'];

export class WebElement {
  tag: string;
  role: string;
  xpath: string;
  clickXPath: string;
  attrs: Record<string, string>;
  text: string;
  outerHTML: string;
  x: number;
  y: number;
  constructor(data: { tag: string; role?: string; xpath: string; clickXPath: string; attrs: Record<string, string>; text: string; outerHTML?: string; x: number; y: number }) {
    this.tag = data.tag;
    this.role = data.role || data.attrs.role || '';
    this.xpath = data.xpath;
    this.clickXPath = data.clickXPath;
    this.attrs = data.attrs;
    this.text = data.text;
    this.outerHTML = data.outerHTML || '';
    this.x = data.x;
    this.y = data.y;
  }

  get description(): string {
    const attrParts = KEY_DISPLAY_ATTRS.map((k) => (this.attrs[k] ? `${k}="${this.attrs[k].slice(0, 40)}"` : '')).filter(Boolean);
    return `<${this.tag} ${attrParts.join(' ')}> text="${this.text.slice(0, 40)}"`;
  }

  get keyAttrs(): string {
    return KEY_ATTRS.map((k) => (this.attrs[k] ? `${k}="${this.attrs[k]}"` : ''))
      .filter(Boolean)
      .join(' ');
  }

  get coordinates(): string {
    return `(${this.x}, ${this.y})`;
  }

  get eidx(): string | null {
    return this.attrs[EXPLORBOT_ATTRS.eidx] || this.attrs.eidx || null;
  }

  get isNavigationLink(): boolean {
    if (this.tag !== 'a') return false;
    const href = this.attrs.href || '';
    return !!href && href !== '#' && !href.startsWith('javascript:');
  }

  get filteredClasses(): string[] {
    const cls = this.attrs.class || '';
    return cls.split(/\s+/).filter((c) => c.length > 2 && !isDynamicId(c) && !isGenericClass(c));
  }

  get areaHints(): string[] {
    const raw = this.attrs[EXPLORBOT_ATTRS.area] || '';
    return raw
      .split('|')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  get contextLabel(): string {
    return (this.attrs[EXPLORBOT_ATTRS.context] || '').trim();
  }

  get variantHints(): string[] {
    const raw = this.attrs[EXPLORBOT_ATTRS.variant] || '';
    return raw
      .split('|')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  static fromRawData(d: RawElementData, role?: string): WebElement {
    return new WebElement({
      tag: d.tag,
      role,
      xpath: '',
      clickXPath: buildClickableXPath({ tag: d.tag, allAttrs: d.allAttrs, text: d.text } as XPathMatch),
      attrs: d.allAttrs,
      text: d.text,
      outerHTML: d.outerHTML,
      x: d.x,
      y: d.y,
    });
  }

  static fromXPathMatch(m: XPathMatch): WebElement {
    return new WebElement({
      tag: m.tag,
      xpath: m.absoluteXPath,
      clickXPath: buildClickableXPath(m),
      attrs: m.allAttrs,
      text: m.text,
      outerHTML: m.outerHTML,
      x: 0,
      y: 0,
    });
  }

  static async fromPlaywrightLocator(locator: any): Promise<WebElement | null> {
    try {
      const count = await locator.count();
      if (count === 0) return null;
      const data = await locator.first().evaluate(extractElementData, ELEMENT_EXTRACTION_CONFIG);
      if (!data) return null;
      return WebElement.fromRawData(data);
    } catch {
      return null;
    }
  }

  static async fromEidx(page: any, eidx: string): Promise<WebElement | null> {
    return WebElement.fromPlaywrightLocator(page.locator(`[${EXPLORBOT_ATTRS.eidx}="${eidx}"]`));
  }

  static async fromEidxList(page: any, eidxList: string[]): Promise<WebElement[]> {
    const validEidxList = eidxList.filter((eidx) => /^e\d+$/i.test(eidx));
    if (validEidxList.length === 0) return [];

    const rawList: RawElementData[] = await page.evaluate(
      ([list, extractFnStr, config]: [string[], string, ElementExtractionConfig]) => {
        const extract = new Function(`return ${extractFnStr}`)() as (el: Element) => any;
        const results: any[] = [];
        for (const eidx of list) {
          const el = document.querySelector(`[${config.attrs.eidx}="${eidx}"]`);
          if (!el) continue;
          const data = extract(el, config);
          if (data) results.push(data);
        }
        return results;
      },
      [validEidxList, getElementDataExtractorSource(), ELEMENT_EXTRACTION_CONFIG] as [string[], string, ElementExtractionConfig]
    );

    return rawList.map((d) => WebElement.fromRawData(d));
  }

  static async findByXPath(html: string, xpath: string): Promise<{ totalFound: number; elements: WebElement[]; error?: string }> {
    const result = await evaluateXPath(html, xpath);
    if (result.error) return { totalFound: 0, elements: [], error: result.error };
    return { totalFound: result.totalFound, elements: result.matches.map((m) => WebElement.fromXPathMatch(m)) };
  }
}
