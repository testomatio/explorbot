import { describe, expect, it } from 'bun:test';
import { WithPagination } from '../../src/ai/researcher/pagination.ts';
import { ResearchResult } from '../../src/ai/researcher/research-result.ts';

const RESEARCH = `## Menu

> Container: '.toolbar'

| Element | ARIA | CSS | eidx |
| Filter | button "Filter" | .filter-btn | 3 |

## Data: Suites List

> Container: '.suites-list-content'

Suite items, 13 items.
`;

class Base {
  explorer: any;
}

const agentWith = (measures: Record<string, any>, afterScrollRows: number) => {
  const Agent = WithPagination(Base as any);
  const agent = new Agent() as any;
  const scrolled = new Set<string>();
  const attempts: string[] = [];

  agent.explorer = {
    withPage: async (fn: any) =>
      fn({
        evaluate: async (_fn: any, arg: any) => {
          const css = typeof arg === 'string' ? arg : arg?.css;
          const measure = measures[css];
          if (!measure) return null;
          if (scrolled.has(css)) return { ...measure, rowCount: afterScrollRows };
          return measure;
        },
      }),
    action: () => ({
      attempt: async (code: string) => {
        attempts.push(code);
        for (const css of Object.keys(measures)) {
          if (code.includes(css)) scrolled.add(css);
        }
        return true;
      },
    }),
  };

  return { agent, attempts };
};

const scrollable = { ownScroller: true, belowFold: false, scrollTop: 0, windowScrollY: 0, rowCount: 20 };

describe('detectPagination', () => {
  it('records infinite when scrolling adds rows', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const { agent } = agentWith({ '.suites-list-content': scrollable }, 40);

    await agent.detectPagination(result);

    expect(result.text).toContain('Pagination: infinite');
  });

  it('keeps the container readable after recording', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const { agent } = agentWith({ '.suites-list-content': scrollable }, 40);

    await agent.detectPagination(result);

    expect(result.text).toContain("> Container: '.suites-list-content'");
  });

  it('records nothing when scrolling adds no rows', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const { agent } = agentWith({ '.suites-list-content': scrollable }, 20);

    await agent.detectPagination(result);

    expect(result.text).not.toContain('Pagination:');
  });

  it('does not probe a section that cannot scroll', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const { agent, attempts } = agentWith({ '.suites-list-content': { ...scrollable, ownScroller: false, rowCount: 5 } }, 99);

    await agent.detectPagination(result);

    expect(attempts).toEqual([]);
    expect(result.text).not.toContain('Pagination:');
  });

  it('restores both scroll offsets after probing', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const restores: any[] = [];
    const { agent } = agentWith({ '.suites-list-content': { ...scrollable, scrollTop: 120, windowScrollY: 300 } }, 40);
    const originalWithPage = agent.explorer.withPage;
    agent.explorer.withPage = async (fn: any) =>
      originalWithPage(async (page: any) => {
        const wrapped = {
          evaluate: async (evaluated: any, arg: any) => {
            if (arg && typeof arg === 'object' && 'windowScrollY' in arg) restores.push(arg);
            return page.evaluate(evaluated, arg);
          },
        };
        return fn(wrapped);
      });

    await agent.detectPagination(result);

    expect(restores).toHaveLength(1);
    expect(restores[0]).toMatchObject({ css: '.suites-list-content', scrollTop: 120, windowScrollY: 300 });
  });

  it('records nothing when the page cannot be measured', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const { agent } = agentWith({ '.suites-list-content': scrollable }, 40);
    agent.explorer.withPage = async () => {
      throw new Error('page.evaluate is not a function');
    };

    await agent.detectPagination(result);

    expect(result.text).not.toContain('Pagination:');
  });

  it('leaves an already recorded strategy alone', async () => {
    const recorded = RESEARCH.replace("> Container: '.suites-list-content'", "> Container: '.suites-list-content'\n> Pagination: controls");
    const result = new ResearchResult(recorded, '/suites');
    const { agent, attempts } = agentWith({ '.suites-list-content': scrollable }, 40);

    await agent.detectPagination(result);

    expect(result.text).toContain('Pagination: controls');
    expect(result.text).not.toContain('Pagination: infinite');
    expect(attempts).toEqual([]);
  });
});
