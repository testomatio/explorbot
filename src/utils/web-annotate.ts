import { ELEMENT_EXTRACTION_CONFIG, getElementDataExtractorSource } from './html.ts';
import { createDebug } from './logger.js';
import { WebElement } from './web-element.ts';

const debugLog = createDebug('explorbot:web-annotate');

const REF_LINE_PATTERN = /^(\s*)-\s+(\w+)\s*(?:"([^"]*)")?.*?\[ref=(e\d+)\]/;

const ANNOTATABLE_ROLES = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'combobox', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'slider', 'spinbutton', 'treeitem']);

function parseAriaRefs(ariaSnapshot: string): Array<{ role: string; name: string; ref: string }> {
  const entries: Array<{ role: string; name: string; ref: string }> = [];
  for (const line of ariaSnapshot.split('\n')) {
    const match = line.match(REF_LINE_PATTERN);
    if (!match) continue;
    if (!ANNOTATABLE_ROLES.has(match[2])) continue;
    entries.push({ role: match[2], name: match[3] || '', ref: match[4] });
  }
  return entries;
}

export async function annotatePageElements(page: any): Promise<{ ariaSnapshot: string; elements: WebElement[] }> {
  const ariaSnapshot: string = await page.locator('body').ariaSnapshot({ mode: 'ai' });
  const refEntries = parseAriaRefs(ariaSnapshot);

  const byRole = new Map<string, Array<{ name: string; ref: string }>>();
  for (const { role, name, ref } of refEntries) {
    let list = byRole.get(role);
    if (!list) {
      list = [];
      byRole.set(role, list);
    }
    list.push({ name, ref });
  }

  const elements: WebElement[] = [];
  for (const [role, entries] of byRole) {
    try {
      const rawList = await page.getByRole(role).evaluateAll(
        (domElements: Element[], [data, extractFnStr, config]: [Array<{ name: string; ref: string }>, string, typeof ELEMENT_EXTRACTION_CONFIG]) => {
          const extract = new Function(`return ${extractFnStr}`)() as (el: Element) => any;
          const results: any[] = [];
          let ariaIdx = 0;
          for (const el of domElements) {
            if (ariaIdx >= data.length) break;
            el.setAttribute(config.attrs.eidx, data[ariaIdx].ref);
            const elData = extract(el, config);
            if (elData) results.push(elData);
            ariaIdx++;
          }
          return results;
        },
        [entries, getElementDataExtractorSource(), ELEMENT_EXTRACTION_CONFIG]
      );
      for (const raw of rawList) {
        elements.push(WebElement.fromRawData(raw, role));
      }
    } catch {
      debugLog(`Failed to annotate role=${role}`);
    }
  }

  return { ariaSnapshot, elements };
}
