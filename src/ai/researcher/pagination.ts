import type Explorer from '../../explorer.ts';
import { mdq } from '../../utils/markdown-query.ts';
import { type PaginationStrategy, type ScrollMeasure, measureScroll, restoreScroll } from '../../utils/pagination.ts';
import { composeContainerBlockquote } from './locators.ts';
import { type Constructor, debugLog } from './mixin.ts';
import { extractPaginationFromBlockquote, parseDataSections, parseResearchSections } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

export function WithPagination<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;

    async detectPagination(result: ResearchResult): Promise<void> {
      const sections = [...parseResearchSections(result.text), ...parseDataSections(result.text)];

      for (const section of sections) {
        const css = section.containerCss;
        if (!css) continue;
        if (extractPaginationFromBlockquote(section.rawMarkdown)) continue;

        const strategy = await this.probeSection(css);
        if (!strategy) continue;

        this.recordPagination(result, section.name, css, strategy);
        debugLog(`Pagination in "${section.name}": ${strategy}`);
      }
    }

    private async probeSection(css: string): Promise<PaginationStrategy | null> {
      const before = await this.measure(css);
      if (!before) return null;
      if (!before.ownScroller && !before.belowFold) return null;

      const action = this.explorer.action();
      const scrolled = await action.attempt(`I.scrollTo('${css} > *:last-child')`).catch(() => false);
      if (!scrolled) return null;

      const after = await this.measure(css);
      await this.explorer.withPage((page) => page.evaluate(restoreScroll, { css, scrollTop: before.scrollTop, windowScrollY: before.windowScrollY })).catch(() => {});

      if (!after) return null;
      if (after.rowCount > before.rowCount) return 'infinite';
      return null;
    }

    private measure(css: string): Promise<ScrollMeasure | null> {
      return this.explorer
        .withPage((page) => page.evaluate(measureScroll, css))
        .catch((err: Error) => {
          debugLog(`Scroll measurement failed for '${css}': ${err.message}`);
          return null;
        });
    }

    private recordPagination(result: ResearchResult, name: string, css: string, strategy: PaginationStrategy): void {
      const escaped = name.replace(/"/g, '\\"');
      let sectionQuery = mdq(result.text).query(`section2(~"${escaped}")`);
      if (sectionQuery.count() === 0) sectionQuery = mdq(result.text).query(`section3(~"${escaped}")`);
      if (sectionQuery.count() === 0) return;
      result.text = sectionQuery.query('blockquote[0]').replace(composeContainerBlockquote(css, strategy));
    }
  };
}

export interface PaginationMethods {
  detectPagination(result: ResearchResult): Promise<void>;
}
