import { type XPathMatch, buildClickableXPath, isDynamicId, isGenericClass } from './xpath.ts';

const KEY_DISPLAY_ATTRS = ['role', 'id', 'class', 'aria-label'];

function extractElementData(el: Element) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const allAttrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    allAttrs[attr.name] = attr.value;
  }

  const iconEl = el.querySelector('svg[class], i[class]');
  let iconClass: string | null = null;
  if (iconEl) {
    const cn = iconEl.className && typeof iconEl.className === 'object' ? (iconEl as SVGElement).className.baseVal : (iconEl.className as string);
    iconClass = cn.split(/\s+/).find((c: string) => c.length > 2) || null;
  }

  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || '').trim().slice(0, 80),
    allAttrs,
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
    childIconClass: iconClass,
  };
}

type RawElementData = NonNullable<ReturnType<typeof extractElementData>>;

export class WebElement {
  tag: string;
  xpath: string;
  clickXPath: string;
  attrs: Record<string, string>;
  text: string;
  x: number;
  y: number;
  childIconClass: string | null;

  constructor(data: { tag: string; xpath: string; clickXPath: string; attrs: Record<string, string>; text: string; x: number; y: number; childIconClass?: string | null }) {
    this.tag = data.tag;
    this.xpath = data.xpath;
    this.clickXPath = data.clickXPath;
    this.attrs = data.attrs;
    this.text = data.text;
    this.x = data.x;
    this.y = data.y;
    this.childIconClass = data.childIconClass || null;
  }

  get description(): string {
    const attrParts = KEY_DISPLAY_ATTRS.map((k) => (this.attrs[k] ? `${k}="${this.attrs[k].slice(0, 40)}"` : '')).filter(Boolean);
    return `<${this.tag} ${attrParts.join(' ')}> text="${this.text.slice(0, 40)}"`;
  }

  get coordinates(): string {
    return `(${this.x}, ${this.y})`;
  }

  get eidx(): number | null {
    const val = this.attrs['data-explorbot-eidx'];
    return val ? Number.parseInt(val, 10) : null;
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

  private static fromRawData(d: RawElementData): WebElement {
    return new WebElement({
      tag: d.tag,
      xpath: '',
      clickXPath: buildClickableXPath({ tag: d.tag, allAttrs: d.allAttrs, text: d.text } as XPathMatch),
      attrs: d.allAttrs,
      text: d.text,
      x: d.x,
      y: d.y,
      childIconClass: d.childIconClass,
    });
  }

  static fromXPathMatch(m: XPathMatch): WebElement {
    return new WebElement({
      tag: m.tag,
      xpath: m.absoluteXPath,
      clickXPath: buildClickableXPath(m),
      attrs: m.allAttrs,
      text: m.text,
      x: 0,
      y: 0,
    });
  }

  static async fromPlaywrightLocator(locator: any): Promise<WebElement | null> {
    try {
      const count = await locator.count();
      if (count === 0) return null;
      const data = await locator.first().evaluate(extractElementData);
      if (!data) return null;
      return WebElement.fromRawData(data);
    } catch {
      return null;
    }
  }

  static async fromEidx(page: any, eidx: number): Promise<WebElement | null> {
    return WebElement.fromPlaywrightLocator(page.locator(`[data-explorbot-eidx="${eidx}"]`));
  }

  static async fromEidxList(page: any, eidxList: number[]): Promise<WebElement[]> {
    if (eidxList.length === 0) return [];

    const rawList: RawElementData[] = await page.evaluate(
      ([list, extractFnStr]: [number[], string]) => {
        const extract = new Function(`return ${extractFnStr}`)() as (el: Element) => any;
        const results: any[] = [];
        for (const eidx of list) {
          const el = document.querySelector(`[data-explorbot-eidx="${eidx}"]`);
          if (!el) continue;
          const data = extract(el);
          if (data) results.push(data);
        }
        return results;
      },
      [eidxList, extractElementData.toString()] as [number[], string]
    );

    return rawList.map((d) => WebElement.fromRawData(d));
  }
}
