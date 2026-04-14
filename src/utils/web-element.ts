import { type XPathMatch, buildClickableXPath, evaluateXPath, isDynamicId, isGenericClass } from './xpath.ts';

const KEY_DISPLAY_ATTRS = ['role', 'id', 'class', 'aria-label'];
const KEY_ATTRS = ['role', 'aria-label', 'id', 'name', 'type', 'href'];

type RawElementData = NonNullable<ReturnType<typeof extractElementData>>;

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
    return this.attrs['data-explorbot-eidx'] || this.attrs.eidx || null;
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
    const raw = this.attrs['data-explorbot-area'] || '';
    return raw
      .split('|')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  get contextLabel(): string {
    return (this.attrs['data-explorbot-context'] || '').trim();
  }

  get variantHints(): string[] {
    const raw = this.attrs['data-explorbot-variant'] || '';
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
      const data = await locator.first().evaluate(extractElementData);
      if (!data) return null;
      return WebElement.fromRawData(data);
    } catch {
      return null;
    }
  }

  static async fromEidx(page: any, eidx: string): Promise<WebElement | null> {
    return WebElement.fromPlaywrightLocator(page.locator(`[data-explorbot-eidx="${eidx}"]`));
  }

  static async fromEidxList(page: any, eidxList: string[]): Promise<WebElement[]> {
    if (eidxList.length === 0) return [];

    const rawList: RawElementData[] = await page.evaluate(
      ([list, extractFnStr]: [string[], string]) => {
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
      [eidxList, extractElementData.toString()] as [string[], string]
    );

    return rawList.map((d) => WebElement.fromRawData(d));
  }

  static async findByXPath(html: string, xpath: string): Promise<{ totalFound: number; elements: WebElement[]; error?: string }> {
    const result = await evaluateXPath(html, xpath);
    if (result.error) return { totalFound: 0, elements: [], error: result.error };
    return { totalFound: result.totalFound, elements: result.matches.map((m) => WebElement.fromXPathMatch(m)) };
  }
}

export function extractElementData(el: Element) {
  function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  function readText(node: Element | null): string {
    if (!node) return '';
    return normalizeText(node.textContent || '').slice(0, 120);
  }

  function getLabelLikeText(node: Element | null): string {
    if (!node) return '';
    const direct = readText(node);
    if (direct) return direct;
    const labelLike = node.querySelector('h1, h2, h3, h4, h5, h6, legend, caption, label, [role="heading"], [class*="title"], [class*="label"], [class*="header"], [class*="name"]');
    return readText(labelLike);
  }

  function collectVariantHints(target: Element): string[] {
    const tokens = new Set<string>();
    const className = target.getAttribute('class') || '';
    const tagName = target.tagName.toLowerCase();

    for (const cls of className.split(/\s+/).filter(Boolean)) {
      const lower = cls.toLowerCase();
      if (/^(xs|sm|md|lg|xl|xxl)$/.test(lower)) tokens.add(lower);
      if (/^(mini|small|medium|large|xlarge|xl|compact|dense)$/.test(lower)) tokens.add(lower);
      if (/(^|[-_])(xs|sm|md|lg|xl|xxl|mini|small|medium|large|compact|dense)([-_]|$)/.test(lower)) tokens.add(lower);
      if (/(selected|disabled|primary|secondary|tertiary|danger|success|warning|outline|ghost|icon|dropdown)/.test(lower)) tokens.add(lower);
    }

    const type = (target.getAttribute('type') || '').toLowerCase();
    if (type) tokens.add(type);
    if (target.hasAttribute('disabled') || target.getAttribute('aria-disabled') === 'true') tokens.add('disabled');
    if (className.toLowerCase().includes('selected') || target.getAttribute('aria-pressed') === 'true') tokens.add('selected');
    if (tagName === 'iframe') tokens.add('iframe');
    if (tagName === 'iframe' && isEmbeddedCodeEditorFrame(target)) tokens.add('code-editor');

    const svgCount = target.querySelectorAll('svg').length;
    if (svgCount > 0) tokens.add('has-icon');
    if (svgCount > 1) tokens.add('double-icon');

    const normalizedText = normalizeText(target.textContent || '');
    if (!normalizedText && svgCount > 0) tokens.add('icon-only');
    if (normalizedText && svgCount > 0) {
      const first = target.firstElementChild?.tagName.toLowerCase();
      const last = target.lastElementChild?.tagName.toLowerCase();
      if (first === 'svg') tokens.add('leading-icon');
      if (last === 'svg') tokens.add('trailing-icon');
    }

    if (tagName === 'a' && target.getAttribute('href')) tokens.add('navigates');

    return Array.from(tokens).slice(0, 8);
  }

  function isEmbeddedCodeEditorFrame(target: Element): boolean {
    const src = (target.getAttribute('src') || '').toLowerCase();
    const parentClasses = (target.parentElement?.getAttribute('class') || '').toLowerCase();
    const ancestorClasses = (target.closest('[class*="monaco"], [class*="codemirror"], [class*="ace_editor"], [class*="code"]')?.getAttribute('class') || '').toLowerCase();
    return src.includes('monaco') || src.includes('codemirror') || src.includes('ace') || parentClasses.includes('frame-container') || ancestorClasses.includes('monaco') || ancestorClasses.includes('codemirror') || ancestorClasses.includes('ace_editor');
  }

  function findContextLabel(target: Element): string {
    const labelTags = 'h1, h2, h3, h4, h5, h6, legend, caption, label, [role="heading"]';
    const labelledby = target.getAttribute('aria-labelledby');
    const candidates: string[] = [];
    if (labelledby) {
      for (const id of labelledby.split(/\s+/).filter(Boolean)) {
        const ref = document.getElementById(id);
        const text = readText(ref);
        if (text) candidates.push(text);
      }
    }

    const freestyleUsage = target.closest('[class*="FreestyleUsage"]');
    if (freestyleUsage) {
      const title = freestyleUsage.querySelector('[class*="FreestyleUsage-title"]');
      const titleText = readText(title);
      if (titleText) candidates.push(titleText);
    }

    const semanticContainer = target.closest('section, article, form, fieldset, li, tr, td, th, [role="group"], [role="tabpanel"], [role="region"], [class*="card"], [class*="panel"], [class*="item"], [class*="usage"], [class*="group"]');
    if (semanticContainer) {
      const ownHeading = semanticContainer.querySelector(labelTags);
      const ownHeadingText = readText(ownHeading);
      if (ownHeadingText) candidates.push(ownHeadingText);

      let previous: Element | null = semanticContainer.previousElementSibling;
      let hops = 0;
      while (previous && hops < 3) {
        const previousText = getLabelLikeText(previous);
        if (previousText) {
          candidates.push(previousText);
          break;
        }
        previous = previous.previousElementSibling;
        hops++;
      }
    }

    let parent: Element | null = target.parentElement;
    let depth = 0;
    while (parent && depth < 4) {
      let sibling: Element | null = parent.previousElementSibling;
      let hops = 0;
      while (sibling && hops < 2) {
        const siblingText = getLabelLikeText(sibling);
        if (siblingText) {
          candidates.push(siblingText);
          sibling = null;
          break;
        }
        sibling = sibling.previousElementSibling;
        hops++;
      }
      parent = parent.parentElement;
      depth++;
    }

    const ownText = normalizeText(target.textContent || '');
    for (const candidate of candidates) {
      if (!candidate) continue;
      if (candidate === ownText) continue;
      if (candidate.toLowerCase().includes('title should not be empty')) continue;
      return candidate.slice(0, 120);
    }

    return '';
  }

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return null;
  if (Number.parseFloat(style.opacity || '1') < 0.1) return null;
  if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) return null;
  if ((el as HTMLElement).offsetParent === null && style.position !== 'fixed') return null;

  const allAttrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i];
    allAttrs[attr.name] = attr.value;
  }

  const areaHints: string[] = [];
  let current: Element | null = el;
  let depth = 0;
  while (current && depth < 5) {
    const tag = current.tagName.toLowerCase();
    areaHints.push(tag);

    const role = current.getAttribute('role');
    if (role) areaHints.push(`role:${role.toLowerCase()}`);

    const id = current.getAttribute('id');
    if (id) areaHints.push(`id:${id.toLowerCase()}`);

    const className = current.getAttribute('class');
    if (className) {
      for (const cls of className.split(/\s+/).filter(Boolean)) {
        areaHints.push(`class:${cls.toLowerCase()}`);
      }
    }

    current = current.parentElement;
    depth++;
  }

  allAttrs['data-explorbot-area'] = areaHints.join('|');
  allAttrs['data-explorbot-context'] = findContextLabel(el);
  allAttrs['data-explorbot-variant'] = collectVariantHints(el).join('|');

  return {
    tag: el.tagName.toLowerCase(),
    text: normalizeText(el.textContent || '').slice(0, 80),
    allAttrs,
    outerHTML: el.outerHTML.slice(0, 2000),
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}
