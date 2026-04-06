import dedent from 'dedent';
import { describe, expect, it } from 'vitest';
import { formatResearchSummary, parseResearchSections } from '../../src/ai/researcher/parser.ts';

const researchMarkdown = dedent`
  ## Page Purpose
  This page is a test management interface.

  ## Navigation

  Navigation bar with project-wide links.
  > Container: \`.nav-height\`
  > **Focused**

  | Element | Type | ARIA | CSS |
  |------|------|------|------|
  | 'Tests link' | link | { role: 'link', text: 'Tests' } | '.nav-item' |
  | 'Runs link' | link | { role: 'link', text: 'Runs' } | '.nav-item' |
  | 'Plans link' | link | { role: 'link', text: 'Plans' } | '.nav-item' |

  ## Header

  Top-bar controls.
  > Container: \`.sticky-header\`

  | Element | Type | ARIA | CSS |
  |------|------|------|------|
  | 'Filter button' | button | { role: 'button', text: 'Filter' } | '.filter-btn' |
  | 'Search field' | combobox | { role: 'combobox', text: 'Search' } | 'input#search' |

  ## List

  Suite list content.
  > Container: \`.suites-list-content\`

  # Extended Research

  ### Dropdown Expansion

  Action:
  > Container: \`.ember-basic-dropdown\`

  | Element | Type | ARIA | CSS |
  |------|------|------|------|
  | Folder | button | { role: 'button', text: 'Folder' } | - |
  | Suite | button | { role: 'button', text: 'Suite' } | - |
  | Tests From Requirement | button | { role: 'button', text: 'Tests From Requirement' } | - |

  ---

  ### Manual Filter Tab

  Action:
  > Container: \`.width-settings\`

  | Element | Type | ARIA | CSS |
  |------|------|------|------|
  | Reset button | button | { role: 'button', text: 'Reset' } | - |
`;

describe('parseResearchSections', () => {
  it('marks sections after Extended Research as extended', () => {
    const sections = parseResearchSections(researchMarkdown);
    const main = sections.filter((s) => !s.isExtended);
    const extended = sections.filter((s) => s.isExtended);

    expect(main.map((s) => s.name)).toEqual(['Page Purpose', 'Navigation', 'Header', 'List']);
    expect(extended.map((s) => s.name)).toEqual(['Dropdown Expansion', 'Manual Filter Tab']);
  });

  it('does not mark sections as extended when no Extended Research heading', () => {
    const md = dedent`
      ## Navigation

      > Container: \`.nav-height\`

      | Element | Type | ARIA | CSS |
      |------|------|------|------|
      | 'Tests link' | link | { role: 'link', text: 'Tests' } | '.nav-item' |

      ### Sub Section

      | Element | Type | ARIA | CSS |
      |------|------|------|------|
      | 'Button' | button | { role: 'button', text: 'Click' } | '.btn' |
    `;
    const sections = parseResearchSections(md);
    expect(sections.every((s) => !s.isExtended)).toBe(true);
  });
});

describe('formatResearchSummary', () => {
  it('produces compact one-line-per-section output', () => {
    const summary = formatResearchSummary(researchMarkdown);
    const lines = summary.split('\n');

    expect(lines[0]).toBe('* Navigation (3 elements) `.nav-height` **Focused**');
    expect(lines[1]).toBe('* Header (2 elements) `.sticky-header`');
    expect(lines[2]).toBe('* List (0 elements) `.suites-list-content`');
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('Extended Research');
    expect(lines[5]).toBe('');
    expect(lines[6]).toBe('* Dropdown Expansion (3 elements) `.ember-basic-dropdown`');
    expect(lines[7]).toBe('* Manual Filter Tab (1 element) `.width-settings`');
    expect(summary).not.toContain('Page Purpose');
  });

  it('includes vision info when coordinates present', () => {
    const md = dedent`
      ## Navigation

      | Element | Type | ARIA | CSS | Coordinates |
      |------|------|------|------|------|
      | 'Link' | link | { role: 'link', text: 'Link' } | '.nav' | (10, 20) |
      | 'Button' | button | { role: 'button', text: 'Btn' } | '.btn' | (30, 40) |
    `;
    const summary = formatResearchSummary(md, { visionUsed: true });
    expect(summary).toContain('Vision: 2 elements with coordinates');
  });

  it('omits Extended Research heading when no extended sections', () => {
    const md = dedent`
      ## Header

      > Container: \`.sticky-header\`

      | Element | Type | ARIA | CSS |
      |------|------|------|------|
      | 'Button' | button | { role: 'button', text: 'Click' } | '.btn' |
    `;
    const summary = formatResearchSummary(md);
    expect(summary).not.toContain('Extended Research');
    expect(summary).toContain('* Header (1 element) `.sticky-header`');
  });

  it('handles singular element count', () => {
    const md = dedent`
      ## Section

      | Element | Type | ARIA | CSS |
      |------|------|------|------|
      | 'Only one' | button | { role: 'button', text: 'One' } | '.btn' |
    `;
    const summary = formatResearchSummary(md);
    expect(summary).toContain('* Section (1 element)');
  });
});
