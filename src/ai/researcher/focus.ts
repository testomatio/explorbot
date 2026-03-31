import { detectFocusArea } from '../../utils/aria.ts';
import { mdq } from '../../utils/markdown-query.ts';
import type { ResearchSection } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

export const FOCUSED_MARKER = '> **Focused**';
const FOCUS_SKIP_SECTIONS = new Set(['navigation', 'menu']);

export function hasFocusedSection(text: string): boolean {
  return text.includes(FOCUSED_MARKER);
}

export function detectFocusFromAria(ariaSnapshot: string | null, sections: ResearchSection[]): string | null {
  const focusArea = detectFocusArea(ariaSnapshot);
  if (!focusArea.detected) return null;

  if (focusArea.type === 'dialog' || focusArea.type === 'modal') {
    const dialogSection = sections.find((s) => s.containerCss && (s.containerCss.includes('[role="dialog"]') || s.containerCss.includes('[role="alertdialog"]') || s.containerCss.includes('[aria-modal')));
    if (dialogSection) return dialogSection.name;
  }

  return null;
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
