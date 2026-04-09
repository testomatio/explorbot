import { parseAriaLocator } from '../../utils/aria.ts';
import { jsonToTable } from '../../utils/markdown-parser.ts';
import { mdq } from '../../utils/markdown-query.ts';
import type { Locator } from './locators.ts';
import { RESEARCH_COLUMN_ORDER, type ResearchSection, parseResearchSections, rebuildSectionMarkdown } from './parser.ts';

export class ResearchResult {
  text: string;
  url: string;
  createdAt: Date;
  locators: Locator[] = [];

  constructor(text: string, url: string) {
    this.text = text;
    this.url = url;
    this.createdAt = new Date();
  }

  parseLocators(): void {
    const sections = parseResearchSections(this.text);
    const locators: Locator[] = [];
    for (const section of sections) {
      for (const el of section.elements) {
        if (el.css) locators.push({ section: section.name, container: section.containerCss, element: el.name, type: 'css', locator: el.css, valid: null, error: null, pwLocator: null });
        if (el.xpath) locators.push({ section: section.name, container: section.containerCss, element: el.name, type: 'xpath', locator: el.xpath, valid: null, error: null, pwLocator: null });
        if (el.aria && /\w/.test(el.aria.text)) locators.push({ section: section.name, container: section.containerCss, element: el.name, type: 'aria', locator: `{ role: '${el.aria.role}', text: '${el.aria.text}' }`, valid: null, error: null, pwLocator: null });
      }
    }
    this.locators = locators;
  }

  get containers(): string[] {
    return [...new Set(this.locators.map((l) => l.container).filter(Boolean))] as string[];
  }

  get containerLocators(): Locator[] {
    return this.containers.map((css) => ({
      section: '',
      container: null,
      element: css,
      type: 'css' as const,
      locator: css,
      valid: null,
      error: null,
      pwLocator: null,
    }));
  }

  updateSection(sectionName: string, locators: Locator[]): void {
    const sections = parseResearchSections(this.text);
    const section = sections.find((s) => s.name === sectionName);
    if (!section) return;

    for (const el of section.elements) {
      const elLocators = locators.filter((l) => l.element === el.name);
      for (const loc of elLocators) {
        const value = loc.valid === false ? null : loc.locator || null;
        if (loc.type === 'css') el.css = value;
        if (loc.type === 'xpath') el.xpath = value;
        if (loc.type === 'aria') el.aria = value ? parseAriaLocator(value) : null;
      }
    }

    this.rebuildSectionInText(section);
  }

  rebuildSectionInText(section: ResearchSection): void {
    if (section.elements.length === 0) return;
    const newTable = rebuildSectionMarkdown(section);
    const escaped = section.name.replace(/"/g, '\\"');
    let sectionQuery = mdq(this.text).query(`section2(~"${escaped}")`);
    if (sectionQuery.count() === 0) sectionQuery = mdq(this.text).query(`section3(~"${escaped}")`);
    const updated = sectionQuery.query('table').replace(`${newTable.trimEnd()}\n`);
    if (updated === this.text) return;
    section.rawMarkdown = mdq(section.rawMarkdown).query('table').replace(`${newTable.trimEnd()}\n`);
    this.text = updated;
  }

  cleanup(): void {
    for (const table of mdq(this.text).query('table').each()) {
      const rows = table.toJson();
      if (rows.length === 0) continue;

      let changed = false;

      if (!('Type' in rows[0]) && 'ARIA' in rows[0]) {
        for (const row of rows) {
          row.Type = parseAriaLocator(row.ARIA || '-')?.role || '-';
        }
        changed = true;
      }

      for (const row of rows) {
        if (row.ARIA && !parseAriaLocator(row.ARIA)) {
          row.ARIA = '-';
          changed = true;
        }
      }

      const hasEidx = 'eidx' in rows[0];
      if (!changed && !hasEidx) continue;

      const rawTable = table.text();
      const baseColumns = Object.keys(rows[0]).filter((c) => c !== 'eidx');
      const columns = this.reorderColumns(baseColumns);
      const cleaned = rows.map(({ eidx, ...rest }) => rest);
      this.text = this.text.replace(rawTable, jsonToTable(cleaned, columns));
    }
  }

  private reorderColumns(columns: string[]): string[] {
    const ordered = RESEARCH_COLUMN_ORDER.filter((c) => columns.includes(c));
    const rest = columns.filter((c) => !RESEARCH_COLUMN_ORDER.includes(c));
    return [...ordered, ...rest];
  }
}
