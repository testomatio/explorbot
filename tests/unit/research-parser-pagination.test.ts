import { describe, expect, it } from 'bun:test';
import { composeContainerBlockquote } from '../../src/ai/researcher/locators.ts';
import { extractPaginationFromBlockquote, parseDataSections, parseResearchSections } from '../../src/ai/researcher/parser.ts';
import { mdq } from '../../src/utils/markdown-query.ts';

const RESEARCH = `## Menu

> Container: '.toolbar'

| Element | ARIA | CSS | eidx |
| Filter | button "Filter" | .filter-btn | 3 |

## Data: Suites List

> Container: '.suites-list-content'
> Pagination: infinite

Suite items, 13 items.
`;

describe('data sections', () => {
  it('returns Data sections with their container', () => {
    const sections = parseDataSections(RESEARCH);

    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe('Data: Suites List');
    expect(sections[0].containerCss).toBe('.suites-list-content');
  });

  it('leaves Data sections out of parseResearchSections', () => {
    const names = parseResearchSections(RESEARCH).map((s) => s.name);

    expect(names).toEqual(['Menu']);
  });

  it('returns nothing when the page has no Data section', () => {
    expect(parseDataSections(`## Menu\n\n> Container: '.toolbar'\n`)).toEqual([]);
  });
});

describe('pagination line', () => {
  it('reads infinite', () => {
    expect(extractPaginationFromBlockquote(parseDataSections(RESEARCH)[0].rawMarkdown)).toBe('infinite');
  });

  it('reads controls', () => {
    const markdown = `## List\n\n> Container: '.rows'\n> Pagination: controls\n`;

    expect(extractPaginationFromBlockquote(markdown)).toBe('controls');
  });

  it('returns null when the line is absent', () => {
    const markdown = `## List\n\n> Container: '.rows'\n`;

    expect(extractPaginationFromBlockquote(markdown)).toBeNull();
  });

  it('returns null for a value outside the vocabulary', () => {
    const markdown = `## List\n\n> Container: '.rows'\n> Pagination: maybe\n`;

    expect(extractPaginationFromBlockquote(markdown)).toBeNull();
  });
});

describe('rewriting a container', () => {
  it('leaves the blockquote readable', () => {
    const markdown = `## Menu\n\n> Container: '.old'\n\n| Element | ARIA | CSS | eidx |\n`;

    const rewritten = mdq(markdown).query('section2(~"Menu")').query('blockquote[0]').replace(composeContainerBlockquote('.new', null));

    expect(parseResearchSections(rewritten)[0].containerCss).toBe('.new');
  });

  it('keeps a recorded strategy through a rewrite', () => {
    const markdown = `## Menu\n\n> Container: '.old'\n> Pagination: controls\n\n| Element | ARIA | CSS | eidx |\n`;

    const rewritten = mdq(markdown).query('section2(~"Menu")').query('blockquote[0]').replace(composeContainerBlockquote('.new', 'controls'));

    expect(extractPaginationFromBlockquote(rewritten)).toBe('controls');
    expect(parseResearchSections(rewritten)[0].containerCss).toBe('.new');
  });
});
