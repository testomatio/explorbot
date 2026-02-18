import { parseAriaLocator } from './aria.ts';
import { jsonToTable, parseSections, tableToJson } from './markdown-parser.ts';
import { mdq } from './markdown-query.ts';

export interface ResearchElement {
  name: string;
  aria: { role: string; text: string } | null;
  css: string | null;
  xpath: string | null;
  coordinates: string | null;
  color: string | null;
  icon: string | null;
}

export interface ResearchSection {
  name: string;
  containerCss: string | null;
  elements: ResearchElement[];
  rawMarkdown: string;
}

const SKIP_SECTIONS = new Set(['summary', 'screenshot analysis', 'data']);

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

function mapRowToElement(row: Record<string, string>): ResearchElement | null {
  const colMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    colMap[key.toLowerCase()] = value;
  }

  const name = stripQuotes(colMap.element || '');
  if (!name) return null;

  return {
    name,
    aria: parseAriaLocator(colMap.aria || '-'),
    css: normalizeLocatorValue(colMap.css || '-'),
    xpath: normalizeLocatorValue(colMap.xpath || '-'),
    coordinates: (colMap.coordinates || '-').trim() === '-' ? null : colMap.coordinates.trim(),
    color: (colMap.color || '-').trim() === '-' || (colMap.color || '').trim() === '' ? null : colMap.color.trim(),
    icon: (colMap.icon || '-').trim() === '-' || (colMap.icon || '').trim() === '' ? null : colMap.icon.trim(),
  };
}

function sanitizeCssSelector(val: string): string | null {
  let s = val.trim();
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.trim();
    if (s.startsWith('**') && s.endsWith('**')) s = s.slice(2, -2);
    if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) s = s.slice(1, -1);
    if (s.startsWith('`') && s.endsWith('`')) s = s.slice(1, -1);
  }
  s = s.trim();
  if (!s || s === '-') return null;
  if (!/^[.#\[\w]/.test(s)) return null;
  return s;
}

export function extractContainerFromBlockquote(sectionMarkdown: string): string | null {
  const bq = mdq(sectionMarkdown).query('blockquote[0]').text().trim();
  if (!bq) return null;
  const match = bq.match(/Container:\s*(.+)/i);
  if (!match) return null;
  return sanitizeCssSelector(match[1]);
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

export function rebuildSectionMarkdown(section: ResearchSection): string {
  const hasCoordinates = section.elements.some((e) => e.coordinates);
  const hasColor = section.elements.some((e) => e.color);
  const hasIcon = section.elements.some((e) => e.icon);

  const columns = ['Element', 'ARIA', 'CSS', 'XPath'];
  if (hasCoordinates) columns.push('Coordinates');
  if (hasColor) columns.push('Color');
  if (hasIcon) columns.push('Icon');

  const rows = section.elements.map((el) => {
    const row: Record<string, string> = {
      Element: `'${el.name}'`,
      ARIA: el.aria ? `{ role: '${el.aria.role}', text: '${el.aria.text}' }` : '-',
      CSS: el.css ? `'${el.css}'` : '-',
      XPath: el.xpath ? `'${el.xpath}'` : '-',
    };
    if (hasCoordinates) row.Coordinates = el.coordinates || '-';
    if (hasColor) row.Color = el.color || '-';
    if (hasIcon) row.Icon = el.icon || '-';
    return row;
  });

  return jsonToTable(rows, columns);
}
