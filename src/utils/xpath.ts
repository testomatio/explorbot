const EXPANDABLE_ICON_CLASSES = ['dots', 'chevron', 'ellipsis', 'caret', 'arrow', 'expand', 'collapse', 'hamburger', 'more'];

export const EXPANDABLE_ICON_DESCRIPTIONS = [
  'three horizontal dots (ellipsis/more options)',
  'three vertical dots (kebab menu)',
  'chevron pointing down or right',
  'caret / small triangle arrow',
  'down arrow or right arrow',
  'hamburger icon (three horizontal lines)',
  'plus or minus icon next to a section',
  'filter / funnel icon',
  'gear / settings icon that might open a menu',
  'expand / collapse toggle icon',
];

const EXPANDABLE_TRIGGER_CLASSES = ['toggle', 'trigger', 'split', 'popup', 'filter', 'tune'];

const EXPANDABLE_CONTAINER_CLASSES = ['dropdown-trigger', 'dropdown-toggle', 'popover-trigger', 'menu-trigger'];

const CLICKABLE = `@role='button' or self::button or self::a or @tabindex`;

const classContains = (classes: string[]) => classes.map((c) => `contains(@class,'${c}')`).join(' or ');

export const EXPANDABLE_XPATHS = [`//*[@aria-haspopup or @aria-expanded]`, `//*[(${CLICKABLE}) and .//*[${classContains(EXPANDABLE_ICON_CLASSES)}]]`, `//*[${classContains(EXPANDABLE_CONTAINER_CLASSES)}]`, `//*[(${CLICKABLE}) and (${classContains(EXPANDABLE_TRIGGER_CLASSES)})]`];

export interface XPathMatch {
  tag: string;
  attrs: string;
  outerHTML: string;
  text: string;
  absoluteXPath: string;
  allAttrs: Record<string, string>;
}

export interface XPathResult {
  totalFound: number;
  matches: XPathMatch[];
  error?: string;
}

const KEY_ATTRS = ['role', 'aria-label', 'id', 'name', 'type', 'href'];
const MAX_MATCHES = 30;
const MAX_OUTER_HTML = 200;
const MAX_TEXT = 80;

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}...`;
}

function getAbsoluteXPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current.nodeType === 1) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html') {
      current = current.parentElement;
      continue;
    }
    if (tag === 'body') {
      parts.unshift('body');
      current = current.parentElement;
      continue;
    }
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) index++;
      sibling = sibling.previousElementSibling;
    }
    parts.unshift(`${tag}[${index}]`);
    current = current.parentElement;
  }
  return `//${parts.join('/')}`;
}

function extractAttrs(el: Element): string {
  return KEY_ATTRS.map((attr) => {
    const val = el.getAttribute(attr);
    if (!val) return null;
    return `${attr}="${val}"`;
  })
    .filter(Boolean)
    .join(' ');
}

export function buildClickableXPath(el: XPathMatch): string {
  const isDynamicId = (id: string) => /^(ember|react|__next)\d|^\d+$/.test(id);
  const isGenericClass = (cls: string) => /^ember-view$|^ember\d|^react-|^__next/.test(cls);
  const a = el.allAttrs;

  if (a.id && !isDynamicId(a.id)) return `//*[@id="${a.id}"]`;

  const conditions: string[] = [`self::${el.tag}`];
  if (a.role) conditions.push(`@role="${a.role}"`);
  if (a['aria-label']) conditions.push(`@aria-label="${a['aria-label']}"`);
  if (a.class) {
    const classes = a.class.split(/\s+/).filter((c) => !isGenericClass(c) && c.length > 2);
    for (const cls of classes.slice(0, 3)) {
      conditions.push(`contains(@class,"${cls}")`);
    }
  }
  if (el.text && el.text.length > 0 && el.text.length < 40) {
    conditions.push(`contains(.,"${el.text.replace(/"/g, "'")}")`);
  }

  return `//*[${conditions.join(' and ')}]`;
}

export function cssToAncestorXPath(css: string): string | null {
  const trimmed = css.trim();
  if (!trimmed) return null;

  const idMatch = trimmed.match(/^#([\w-]+)$/);
  if (idMatch) return `@id="${idMatch[1]}"`;

  const tagClassMatch = trimmed.match(/^(\w+)\.([\w-]+)$/);
  if (tagClassMatch) return `self::${tagClassMatch[1]} and contains(@class,"${tagClassMatch[2]}")`;

  const classMatch = trimmed.match(/^\.([\w-]+)$/);
  if (classMatch) return `contains(@class,"${classMatch[1]}")`;

  const attrMatch = trimmed.match(/^\[([^\]]+)\]$/);
  if (attrMatch) return `@${attrMatch[1]}`;

  return null;
}

export async function evaluateXPath(html: string, xpath: string): Promise<XPathResult> {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(html);

  try {
    const doc = dom.window.document;
    const result = doc.evaluate(xpath, doc, null, 7, null);

    const matches: XPathMatch[] = [];
    const totalFound = result.snapshotLength;

    for (let i = 0; i < Math.min(totalFound, MAX_MATCHES); i++) {
      const node = result.snapshotItem(i);
      if (!node || node.nodeType !== 1) continue;

      const el = node as Element;
      const allAttrs: Record<string, string> = {};
      for (let a = 0; a < el.attributes.length; a++) {
        const attr = el.attributes[a];
        allAttrs[attr.name] = attr.value;
      }
      matches.push({
        tag: el.tagName.toLowerCase(),
        attrs: extractAttrs(el),
        outerHTML: truncate(el.outerHTML, MAX_OUTER_HTML),
        text: truncate(el.textContent?.trim() || '', MAX_TEXT),
        absoluteXPath: getAbsoluteXPath(el),
        allAttrs,
      });
    }

    return { totalFound, matches };
  } catch (err: any) {
    return { totalFound: 0, matches: [], error: err?.message || 'XPath evaluation failed' };
  } finally {
    dom.window.close();
  }
}
