import { parseAriaLocator } from '../../utils/aria.ts';
import { jsonToTable, parseSections, tableToJson } from '../../utils/markdown-parser.ts';
import { mdq } from '../../utils/markdown-query.ts';

export interface ResearchElement {
  name: string;
  type: string | null;
  aria: { role: string; text: string } | null;
  css: string | null;
  xpath: string | null;
  coordinates: string | null;
  color: string | null;
  icon: string | null;
  eidx: number | null;
}

export interface ResearchSection {
  name: string;
  containerCss: string | null;
  elements: ResearchElement[];
  rawMarkdown: string;
}

const SKIP_SECTIONS = new Set(['summary', 'screenshot analysis', 'data', 'primary actions']);

export const RESEARCH_COLUMN_ORDER = ['Element', 'Type', 'ARIA', 'CSS', 'XPath', 'Coordinates', 'Color', 'Icon', 'eidx'];

function stripQuotes(str: string): string {
  let trimmed = str.trim();
  if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
    trimmed = trimmed.slice(2, -2);
  }
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function normalizeLocatorValue(val: string): string | null {
  let s = val.trim();
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = stripQuotes(s).trim();
  }
  if (s === '-' || s === '') return null;
  return s;
}

export function mapRowToElement(row: Record<string, string>): ResearchElement | null {
  const colMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    colMap[key.toLowerCase()] = value;
  }

  const name = stripQuotes(colMap.element || '');
  if (!name) return null;

  const eidxRaw = (colMap.eidx || '').trim();
  const eidxNum = eidxRaw ? Number.parseInt(eidxRaw, 10) : Number.NaN;

  const aria = parseAriaLocator(colMap.aria || '-');

  return {
    name,
    type: colMap.type?.trim() || aria?.role || null,
    aria,
    css: normalizeLocatorValue(colMap.css || '-'),
    xpath: normalizeLocatorValue(colMap.xpath || '-'),
    coordinates: (colMap.coordinates || '-').trim() === '-' ? null : colMap.coordinates.trim(),
    color: (colMap.color || '-').trim() === '-' || (colMap.color || '').trim() === '' ? null : colMap.color.trim(),
    icon: (colMap.icon || '-').trim() === '-' || (colMap.icon || '').trim() === '' ? null : colMap.icon.trim(),
    eidx: Number.isNaN(eidxNum) ? null : eidxNum,
  };
}

export function extractContainerFromBlockquote(sectionMarkdown: string): string | null {
  const bq = mdq(sectionMarkdown).query('blockquote[0]').text().trim();
  if (!bq) return null;
  const match = bq.match(/Container:\s*(.+)/i);
  if (!match) return null;
  const css = normalizeLocatorValue(match[1]);
  if (!css || !/^[.#\[\w]/.test(css)) return null;
  return css;
}

export function parseResearchSections(markdown: string): ResearchSection[] {
  return parseSections(markdown)
    .filter((s) => !SKIP_SECTIONS.has(s.name.toLowerCase()) && !s.name.toLowerCase().includes('data:'))
    .map((section) => {
      const containerCss = extractContainerFromBlockquote(section.rawMarkdown);
      const rows = tableToJson(section.rawMarkdown);
      const elements = rows.map(mapRowToElement).filter(Boolean) as ResearchElement[];

      return { name: section.name, containerCss, elements, rawMarkdown: section.rawMarkdown };
    });
}

export function extractValidContainers(researchText: string, opts?: { exclude?: string[] }): Array<{ css: string; label: string }> {
  const exclude = opts?.exclude || [];
  return parseResearchSections(researchText)
    .filter((s) => s.containerCss && !exclude.includes(s.containerCss))
    .map((s) => ({ css: s.containerCss!, label: s.name }));
}

export function rebuildSectionMarkdown(section: ResearchSection): string {
  const hasEidx = section.elements.some((e) => e.eidx);
  const hasXpath = section.elements.some((e) => e.xpath);
  const hasCoordinates = section.elements.some((e) => e.coordinates);
  const hasColor = section.elements.some((e) => e.color);
  const hasIcon = section.elements.some((e) => e.icon);

  const presentColumns = new Set(['Element', 'ARIA', 'CSS']);
  if (section.elements.some((e) => e.type || e.aria)) presentColumns.add('Type');
  if (hasXpath) presentColumns.add('XPath');
  if (hasCoordinates) presentColumns.add('Coordinates');
  if (hasColor) presentColumns.add('Color');
  if (hasIcon) presentColumns.add('Icon');
  if (hasEidx) presentColumns.add('eidx');

  const columns = RESEARCH_COLUMN_ORDER.filter((c) => presentColumns.has(c));

  const rows = section.elements.map((el) => {
    const row: Record<string, string> = {
      Element: `'${el.name}'`,
    };
    if (presentColumns.has('Type')) row.Type = el.type || el.aria?.role || '-';
    row.ARIA = el.aria ? `{ role: '${el.aria.role}', text: '${el.aria.text}' }` : '-';
    row.CSS = el.css ? `'${el.css}'` : '-';
    if (hasXpath) row.XPath = el.xpath ? `'${el.xpath}'` : '-';
    if (hasCoordinates) row.Coordinates = el.coordinates || '-';
    if (hasColor) row.Color = el.color || '-';
    if (hasIcon) row.Icon = el.icon || '-';
    if (hasEidx) row.eidx = el.eidx ? String(el.eidx) : '-';
    return row;
  });

  return jsonToTable(rows, columns);
}
