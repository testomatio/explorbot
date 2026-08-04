import { ELEMENT_EXTRACTION_CONFIG } from './html.ts';

export async function eidxInContainer(page: any, containerCss: string | null): Promise<string[]> {
  const selector = containerCss ? `${containerCss} [${ELEMENT_EXTRACTION_CONFIG.attrs.eidx}]` : `[${ELEMENT_EXTRACTION_CONFIG.attrs.eidx}]`;
  const elements = await page.locator(selector).all();
  const result: string[] = [];
  for (const el of elements) {
    const attr = await el.getAttribute(ELEMENT_EXTRACTION_CONFIG.attrs.eidx).catch(() => null);
    if (attr) result.push(attr);
  }
  return result;
}

export async function eidxByLocator(page: any, locator: string, container?: string | null): Promise<string | null> {
  const base = container ? page.locator(container) : page;
  const el = locator.startsWith('//') ? base.locator(`xpath=${locator}`) : base.locator(locator);
  return el
    .first()
    .getAttribute(ELEMENT_EXTRACTION_CONFIG.attrs.eidx)
    .catch(() => null);
}
