import 'parse5';
import { describe, expect, it } from 'bun:test';
import { paginationFromResearch, paginationRuleFor } from '../../src/ai/rules.ts';
import { detectPaginationMarkers } from '../../src/utils/pagination.ts';

const contextFor = (html: string, research: string): string => {
  let strategy = detectPaginationMarkers(html);
  if (!strategy) strategy = paginationFromResearch(research);
  if (!strategy) return '';
  return paginationRuleFor(strategy);
};

describe('paginationRuleFor', () => {
  it('tells the model to click through pages for controls', () => {
    const rule = paginationRuleFor('controls');

    expect(rule).toContain('<pagination>');
    expect(rule).toContain('next');
    expect(rule).not.toContain('scroll');
  });

  it('tells the model to scroll for infinite', () => {
    const rule = paginationRuleFor('infinite');

    expect(rule).toContain('<pagination>');
    expect(rule).toContain('scroll');
  });
});

describe('paginationFromResearch', () => {
  it('reads a strategy recorded in a Data section', () => {
    const research = `## Data: Rows\n\n> Container: '.rows'\n> Pagination: infinite\n\nRow items.\n`;

    expect(paginationFromResearch(research)).toBe('infinite');
  });

  it('reads a strategy recorded in a normal section', () => {
    const research = `## Menu\n\n> Container: '.toolbar'\n> Pagination: controls\n\n| Element | ARIA | CSS | eidx |\n`;

    expect(paginationFromResearch(research)).toBe('controls');
  });

  it('returns null when no section records one', () => {
    const research = `## Menu\n\n> Container: '.toolbar'\n\n| Element | ARIA | CSS | eidx |\n`;

    expect(paginationFromResearch(research)).toBeNull();
  });

  it('returns null for empty research', () => {
    expect(paginationFromResearch('')).toBeNull();
  });
});

describe('choosing what to inject', () => {
  const RESEARCH_INFINITE = `## Data: Rows\n\n> Container: '.rows'\n> Pagination: infinite\n\nRow items.\n`;
  const RESEARCH_NONE = `## Menu\n\n> Container: '.toolbar'\n\n| Element | ARIA | CSS | eidx |\n`;

  it('injects nothing on a page with no list', () => {
    expect(contextFor('<div><p>About us</p></div>', RESEARCH_NONE)).toBe('');
  });

  it('injects only the matching fragment', () => {
    const context = contextFor('<ul><li>One</li></ul>', RESEARCH_INFINITE);

    expect(context).toContain('grows as it is scrolled');
    expect(context).not.toContain('click next or the page number');
  });

  it('lets a live marker win over what research recorded', () => {
    const context = contextFor('<a href="?p=2" rel="next">On</a>', RESEARCH_INFINITE);

    expect(context).toContain('click next or the page number');
    expect(context).not.toContain('grows as it is scrolled');
  });

  it('falls back to research when the page carries no marker', () => {
    expect(contextFor('<ul><li>One</li></ul>', RESEARCH_INFINITE)).toContain('grows as it is scrolled');
  });
});
