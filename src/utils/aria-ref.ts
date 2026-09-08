import { WebElement } from './web-element.ts';

const REF_LINE_PATTERN = /^(\s*)-\s+(\w+)\s*(?:"([^"]*)")?.*?\[ref=(e\d+)\]/;
const ARIA_REF_PATTERN = /^(f\d+)?e\d+$/i;

const REF_ROLES: Record<string, string> = { a: 'link', button: 'button', select: 'combobox', textarea: 'textbox' };

export function ariaRefSelector(ref: string): string {
  return `aria-ref=${ref}`;
}

export function isAriaRef(ref: string): boolean {
  return ARIA_REF_PATTERN.test(ref);
}

export function ariaRefSnapshot(page: any): Promise<string> {
  return page.locator('body').ariaSnapshot({ mode: 'ai' });
}

export function parseAriaRefs(ariaSnapshot: string): AriaRefEntry[] {
  const entries: AriaRefEntry[] = [];
  for (const line of ariaSnapshot.split('\n')) {
    const match = line.match(REF_LINE_PATTERN);
    if (!match) continue;
    entries.push({ role: match[2], name: match[3] || '', ref: match[4] });
  }
  return entries;
}

export async function elementFromAriaRef(page: any, ref: string): Promise<WebElement | null> {
  if (!isAriaRef(ref)) return null;
  return WebElement.fromPlaywrightLocator(page.locator(ariaRefSelector(ref)));
}

export async function refIsGone(explorer: any, ref: string): Promise<boolean> {
  const count = () => Promise.resolve(explorer?.withPage?.((page: any) => page.locator(ariaRefSelector(ref)).count())).catch(() => undefined);
  if ((await count()) !== 0) return false;
  await Promise.resolve(explorer?.withPage?.(ariaRefSnapshot)).catch(() => null);
  return (await count()) === 0;
}

export async function describeRef(explorer: any, ref: string): Promise<{ role: string; text: string } | null> {
  return Promise.resolve(
    explorer?.withPage?.((page: any) =>
      page.locator(ariaRefSelector(ref)).evaluate((el: any, roles: Record<string, string>) => {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || roles[tag];
        if (!role) return null;
        const text = (el.getAttribute('aria-label') || el.innerText || el.value || '').trim().split('\n')[0];
        if (!text) return null;
        return { role, text };
      }, REF_ROLES)
    )
  ).catch(() => null);
}

export interface AriaRefEntry {
  role: string;
  name: string;
  ref: string;
}
