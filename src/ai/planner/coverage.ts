import dedent from 'dedent';
import { z } from 'zod';
import type { Plan } from '../../test-plan.ts';
import { tag } from '../../utils/logger.ts';
import type { Provider } from '../provider.ts';
import { Researcher } from '../researcher.ts';

export const COVERAGE_THRESHOLD = 0.75;
export const SUBPAGE_COVERAGE_THRESHOLD = 0.3;

const ElementCountSchema = z.object({
  interactive_elements: z.number().describe('Number of interactive elements excluding navigation'),
});

const TESTS_PER_ELEMENT = 3;

export async function analyzeCoverage(provider: Provider, plan: Plan): Promise<CoverageResult> {
  if (!plan.url) return { pages: [], totalCoverage: 0 };

  const allUrls = [...new Set(plan.tests.flatMap((t) => t.getVisitedUrls({ localOnly: true })))];

  const pagesWithResearch: { url: string; research: string }[] = [];
  for (const url of allUrls) {
    const state = plan.tests.flatMap((t) => t.states).find((s) => s.url === url);
    if (!state) continue;
    const research = Researcher.getCachedResearch(state);
    if (!research) continue;
    pagesWithResearch.push({ url, research });
  }

  if (pagesWithResearch.length === 0) return { pages: [], totalCoverage: 0 };

  const conversation = provider.startConversation(
    dedent`
      Count interactive elements on web pages from research data.
      Count buttons, inputs, links, selects, toggles, checkboxes, and other interactive elements.
      Exclude navigation elements that lead away from the current page (menus, nav links, breadcrumbs).
      Do not count elements from a page if a similar page was already analyzed.
    `,
    'planner'
  );

  const pages: CoverageResult['pages'] = [];
  let totalPotential = 0;
  let totalTests = 0;

  for (const { url, research } of pagesWithResearch) {
    conversation.addUserText(`Page: ${url}\n\n${research}`);

    const result = await provider.generateObject(conversation.messages, ElementCountSchema, conversation.model);
    const interactiveElements = result?.object?.interactive_elements || 0;
    const potentialTests = interactiveElements * TESTS_PER_ELEMENT;
    const tests = plan.tests.filter((t) => t.getVisitedUrls({ localOnly: true }).includes(url)).length;
    const coverage = potentialTests === 0 && tests === 0 ? 0 : tests / Math.max(potentialTests, tests);

    pages.push({ url, potential_tests: potentialTests, tests, coverage });
    totalPotential += potentialTests;
    totalTests += tests;
  }

  const totalCoverage = totalPotential === 0 && totalTests === 0 ? 0 : totalTests / Math.max(totalPotential, totalTests);

  for (const page of pages) {
    tag('substep').log(`${page.url}: ${page.tests}/${page.potential_tests} (${Math.round(page.coverage * 100)}%)`);
  }
  tag('info').log(`Total coverage: ${Math.round(totalCoverage * 100)}%`);

  return { pages, totalCoverage };
}

export type CoverageResult = {
  pages: { url: string; potential_tests: number; tests: number; coverage: number }[];
  totalCoverage: number;
};
