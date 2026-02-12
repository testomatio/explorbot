export interface XPathMatch {
  tag: string;
  attrs: string;
  outerHTML: string;
  text: string;
}

export interface XPathResult {
  totalFound: number;
  matches: XPathMatch[];
  error?: string;
}

const KEY_ATTRS = ['role', 'aria-label', 'id', 'name', 'type', 'href'];
const MAX_MATCHES = 10;
const MAX_OUTER_HTML = 200;
const MAX_TEXT = 80;

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return `${str.slice(0, max)}...`;
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
      matches.push({
        tag: el.tagName.toLowerCase(),
        attrs: extractAttrs(el),
        outerHTML: truncate(el.outerHTML, MAX_OUTER_HTML),
        text: truncate(el.textContent?.trim() || '', MAX_TEXT),
      });
    }

    return { totalFound, matches };
  } catch (err: any) {
    return { totalFound: 0, matches: [], error: err?.message || 'XPath evaluation failed' };
  } finally {
    dom.window.close();
  }
}
