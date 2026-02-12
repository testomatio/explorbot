import { extractLabeledCode, jsonToTable, parseSections, tableToJson } from './markdown-parser.ts';

export interface ResearchElement {
  name: string;
  aria: { role: string; text: string } | null;
  css: string | null;
  xpath: string | null;
  coordinates: string | null;
  color: string | null;
}

export interface ResearchSection {
  name: string;
  containerCss: string | null;
  elements: ResearchElement[];
  rawMarkdown: string;
}

const SKIP_SECTIONS = new Set(['summary', 'screenshot analysis', 'data']);
const CONTAINER_CSS_LABEL = /(?:section\s+)?container\s+css\s+locator/i;

export function parseAriaLocator(ariaStr: string): { role: string; text: string } | null {
  const trimmed = ariaStr.trim();
  if (trimmed === '-' || trimmed === '' || trimmed === '"-"') return null;

  const match = trimmed.match(/\{\s*["']?role["']?\s*:\s*['"]([^'"]+)['"]\s*,\s*["']?text["']?\s*:\s*['"]([^'"]*)['"]\s*\}/);
  if (!match) return null;

  return { role: match[1], text: match[2] };
}

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
  const stripped = stripQuotes(val);
  if (stripped === '-' || stripped === '') return null;
  return stripped;
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
  };
}

export function parseResearchSections(markdown: string): ResearchSection[] {
  return parseSections(markdown)
    .filter((s) => !SKIP_SECTIONS.has(s.name.toLowerCase()))
    .map((section) => {
      const containerCss = extractLabeledCode(section.rawMarkdown, CONTAINER_CSS_LABEL);
      const rows = tableToJson(section.rawMarkdown);
      const elements = rows.map(mapRowToElement).filter(Boolean) as ResearchElement[];

      return { name: section.name, containerCss, elements, rawMarkdown: section.rawMarkdown };
    });
}

export function rebuildSectionMarkdown(section: ResearchSection): string {
  const hasCoordinates = section.elements.some((e) => e.coordinates);
  const hasColor = section.elements.some((e) => e.color);

  const columns = ['Element', 'ARIA', 'CSS', 'XPath'];
  if (hasCoordinates) columns.push('Coordinates');
  if (hasColor) columns.push('Color');

  const rows = section.elements.map((el) => {
    const row: Record<string, string> = {
      Element: `'${el.name}'`,
      ARIA: el.aria ? `{ role: '${el.aria.role}', text: '${el.aria.text}' }` : '-',
      CSS: el.css ? `'${el.css}'` : '-',
      XPath: el.xpath ? `'${el.xpath}'` : '-',
    };
    if (hasCoordinates) row.Coordinates = el.coordinates || '-';
    if (hasColor) row.Color = el.color || '-';
    return row;
  });

  return jsonToTable(rows, columns);
}
