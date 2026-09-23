import type Explorer from '../../explorer.ts';
import { mdq } from '../../utils/markdown-query.ts';
import { type ListMeasure, type PaginationStrategy, inspectList, restoreScroll } from '../../utils/pagination.ts';
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

        this.recordPagination(result, section.name, strategy);
        debugLog(`Pagination in "${section.name}": ${strategy}`);
      }
    }

    private async probeSection(css: string): Promise<PaginationStrategy | null> {
      const before = await this.measure(css);
      if (!before) return null;
      if (before.hasPagingControls) return 'controls';
      if (before.isFeed) return 'infinite';
      if (!before.scrolls) return null;

      const action = this.explorer.action();
      const scrolled = await action.attempt(`I.scrollTo('${css} > *:last-child')`).catch(() => false);
      if (!scrolled) return null;

      const after = await this.measure(css);
      await this.explorer.withPage((page) => page.evaluate(restoreScroll, { css, scrollTop: before.scrollTop, pageScrollY: before.pageScrollY })).catch(() => {});

      if (!after) return null;
      if (after.items > before.items) return 'infinite';
      return null;
    }

    private measure(css: string): Promise<ListMeasure | null> {
      return this.explorer
        .withPage((page) => page.evaluate(inspectList, css))
        .catch((err: Error) => {
          debugLog(`List measurement failed for '${css}': ${err.message}`);
          return null;
        });
    }

    private recordPagination(result: ResearchResult, name: string, strategy: PaginationStrategy): void {
      const escaped = name.replace(/"/g, '\\"');
      let sectionQuery = mdq(result.text).query(`section2(~"${escaped}")`);
      if (sectionQuery.count() === 0) sectionQuery = mdq(result.text).query(`section3(~"${escaped}")`);
      if (sectionQuery.count() === 0) return;
      result.text = sectionQuery.query('blockquote[0]').setKeyValue('Pagination', strategy).toString();
    }
  };
}

export interface PaginationMethods {
  detectPagination(result: ResearchResult): Promise<void>;
}
