import type { Page } from 'playwright';
import { mdq } from '../../utils/markdown-query.ts';
import type { ResearchSection } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

export const FOCUSED_MARKER = '> **Focused**';
const FOCUS_SKIP_SECTIONS = new Set(['navigation', 'menu']);

export function hasFocusedSection(text: string): boolean {
  return text.includes(FOCUSED_MARKER);
}

interface FocusProbe {
  name: string;
  isDialog: boolean;
  zIndex: number;
  hasShadow: boolean;
}

export async function detectFocusedSection(page: Page, sections: ResearchSection[]): Promise<string | null> {
  const candidates: FocusProbe[] = [];

  for (const section of sections) {
    if (!section.containerCss) continue;
    const key = section.name.toLowerCase().replace(/^section:\s*/, '');
    if (FOCUS_SKIP_SECTIONS.has(key)) continue;

    try {
      const locator = page.locator(section.containerCss).first();
      if (!(await locator.isVisible())) continue;

      const probe = await locator.evaluate((el) => {
        const dialogSelector = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
        const isDialog = el.matches(dialogSelector) || !!el.querySelector(dialogSelector);

        let cur: Element | null = el;
        let maxZ = 0;
        while (cur && cur !== document.body) {
          const cs = window.getComputedStyle(cur);
          if (cs.position !== 'static') {
            const z = Number.parseInt(cs.zIndex, 10);
            if (!Number.isNaN(z) && z > maxZ) maxZ = z;
          }
          cur = cur.parentElement;
        }

        const shadow = window.getComputedStyle(el).boxShadow;
        const hasShadow = !!shadow && shadow !== 'none';

        return { isDialog, zIndex: maxZ, hasShadow };
      });

      candidates.push({ name: section.name, ...probe });
    } catch {}
  }

  if (candidates.length === 0) return null;

  const dialogs = candidates.filter((c) => c.isDialog);
  const pool = dialogs.length > 0 ? dialogs : candidates;

  const winner = pool.reduce<FocusProbe | null>((best, c) => {
    if (!best) return c;
    if (c.zIndex !== best.zIndex) return c.zIndex > best.zIndex ? c : best;
    if (c.hasShadow !== best.hasShadow) return c.hasShadow ? c : best;
    return best;
  }, null);

  if (!winner) return null;
  if (dialogs.length === 0 && winner.zIndex === 0 && !winner.hasShadow) return null;
  return winner.name;
}

export function markSectionAsFocused(result: ResearchResult, sectionName: string): void {
  if (hasFocusedSection(result.text)) return;

  const escaped = sectionName.replace(/"/g, '\\"');
  let sectionQuery = mdq(result.text).query(`section2(~"${escaped}")`);
  if (sectionQuery.count() === 0) sectionQuery = mdq(result.text).query(`section3(~"${escaped}")`);
  if (sectionQuery.count() === 0) return;

  const containerBq = sectionQuery.query('blockquote[0]').text();
  if (!containerBq) return;

  result.text = result.text.replace(containerBq, `${containerBq}\n${FOCUSED_MARKER}`);
}

export function pickDefaultFocusedSection(sections: ResearchSection[]): string | null {
  const candidate = sections.find((s) => s.containerCss && !FOCUS_SKIP_SECTIONS.has(s.name.toLowerCase().replace(/^section:\s*/, '')));
  return candidate?.name || null;
}
