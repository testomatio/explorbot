# Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Explorbot reach list content that is not loaded yet, whether the list pages through controls or grows as it is scrolled, including lists that scroll inside their own container.

**Architecture:** Detection is layered cheapest-first — HTML markers (no AI), then Researcher's own judgment while it describes a section, then a deterministic scroll gate, then a probe that scrolls and measures. The result is recorded as a `> Pagination:` line in the section's container blockquote. Tester and Navigator read that line plus a live marker scan, and inject one of two short rule fragments only when a strategy was detected. No new AI tool: `I.scrollTo(locator)` already scrolls every scrollable ancestor of its target.

**Tech Stack:** Bun (never Node), TypeScript, CodeceptJS + Playwright, `bun:test`, `mdq()` for all markdown, Biome for format/lint.

**Spec:** `docs/superpowers/specs/2026-09-09-pagination-rule-design.md`

## Global Constraints

- **Bun only.** `bun test`, `bun run format`, `bun run lint:fix`. Never `npm`/`node`.
- **No comments in code** unless a step's code block shows one.
- **No `try`/`catch` inside `try`/`catch`.** Prefer early return over `if`/`else`. No ternaries. No `...(cond ? {k:v} : {})` — use a plain `if`.
- **All markdown manipulation goes through `mdq()`** (`src/utils/markdown-query.ts`). Never split lines or regex over markdown structure. Regex over an *attribute value* or a *single extracted line* is fine.
- **Prompts must be general.** No site names, no CSS selectors, no example lifted from a debug session. 1–3 lines per bullet.
- **Never hardcode locators.** Markers in Task 1 are W3C-spec attributes, which is the one allowed kind of structural constant.
- **Types go at the end of the file.**
- **Private methods after public methods.**
- Run `bun run format` after each code change; `bun run lint:fix` before the final commit.
- Do **not** start a regression run, add the `regression` label, or `gh workflow run regression.yml`.

---

### Task 1: HTML marker scan

**Files:**
- Create: `src/utils/pagination.ts`
- Test: `tests/unit/pagination-markers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `detectPaginationMarkers(html: string): PaginationStrategy | null` and `type PaginationStrategy = 'controls' | 'infinite'`. Tasks 4, 6 and 7 import both.

Uses `jsdom`, already a dependency and used the same way elsewhere in `src/utils/html.ts`.

**IMPORTANT — jsdom import order:** a test file that touches jsdom must have `import 'parse5';` as its **first** line. jsdom is CJS and `require()`s ESM-only parse5; without the leading import the file silently registers zero tests.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pagination-markers.test.ts`:

```ts
import 'parse5';
import { describe, expect, it } from 'bun:test';
import { detectPaginationMarkers } from '../../src/utils/pagination.ts';

describe('pagination markers', () => {
  it('reads rel=next and rel=prev as controls', () => {
    const html = '<nav><a href="?p=1" rel="prev">Back</a><a href="?p=3" rel="next">On</a></nav>';

    expect(detectPaginationMarkers(html)).toBe('controls');
  });

  it('reads role=feed as infinite', () => {
    const html = '<div role="feed"><article>One</article></div>';

    expect(detectPaginationMarkers(html)).toBe('infinite');
  });

  it('reads aria-setsize=-1 as infinite', () => {
    const html = '<ul><li aria-setsize="-1" aria-posinset="1">One</li></ul>';

    expect(detectPaginationMarkers(html)).toBe('infinite');
  });

  it('ignores aria-current in every value', () => {
    const html = '<nav><a href="/a" aria-current="page">A</a><a href="/b" aria-current="true">B</a></nav>';

    expect(detectPaginationMarkers(html)).toBeNull();
  });

  it('prefers controls when both kinds of marker are present', () => {
    const html = '<div role="feed"></div><a href="?p=2" rel="next">On</a>';

    expect(detectPaginationMarkers(html)).toBe('controls');
  });

  it('returns null for a plain list', () => {
    const html = '<ul><li>One</li><li>Two</li></ul>';

    expect(detectPaginationMarkers(html)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/pagination-markers.test.ts`
Expected: FAIL — cannot resolve `../../src/utils/pagination.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/pagination.ts`:

```ts
import { JSDOM } from 'jsdom';

const CONTROL_MARKERS = 'a[rel="next"], a[rel="prev"]';
const INFINITE_MARKERS = '[role="feed"], [aria-setsize="-1"]';

export function detectPaginationMarkers(html: string): PaginationStrategy | null {
  if (!html) return null;
  const { document } = new JSDOM(html).window;
  if (document.querySelector(CONTROL_MARKERS)) return 'controls';
  if (document.querySelector(INFINITE_MARKERS)) return 'infinite';
  return null;
}

export type PaginationStrategy = 'controls' | 'infinite';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/pagination-markers.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/utils/pagination.ts tests/unit/pagination-markers.test.ts
git commit -m "Read pagination strategy from spec-defined HTML markers"
```

---

### Task 2: Parse `Data:` sections and the `Pagination:` line

**Files:**
- Modify: `src/ai/researcher/parser.ts`
- Test: `tests/unit/research-parser-pagination.test.ts`

**Interfaces:**
- Consumes: `PaginationStrategy` from Task 1.
- Produces: `parseDataSections(markdown: string): ResearchSection[]` and `extractPaginationFromBlockquote(sectionMarkdown: string): PaginationStrategy | null`. Tasks 4, 5 and 6 import both.

**Why this task exists:** Researcher emits a list of data items as a `## Data: <name>` section (`src/ai/researcher.ts:502-509`), and `parseResearchSections` filters exactly those out (`src/ai/researcher/parser.ts:100`). Probing only its output would skip every list on the page.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/research-parser-pagination.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { extractPaginationFromBlockquote, parseDataSections, parseResearchSections } from '../../src/ai/researcher/parser.ts';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/research-parser-pagination.test.ts`
Expected: FAIL — `parseDataSections` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/ai/researcher/parser.ts`, add to the `PaginationStrategy` import line at the top:

```ts
import type { PaginationStrategy } from '../../utils/pagination.ts';
```

Add these two exports after `parseResearchSections`:

```ts
export function parseDataSections(markdown: string): ResearchSection[] {
  return parseSections(markdown)
    .filter((s) => s.name.toLowerCase().startsWith('data:'))
    .map((section) => ({
      name: section.name,
      containerCss: extractContainerFromBlockquote(section.rawMarkdown),
      elements: [],
      rawMarkdown: section.rawMarkdown,
      isExtended: false,
    }));
}

export function extractPaginationFromBlockquote(sectionMarkdown: string): PaginationStrategy | null {
  const bq = mdq(sectionMarkdown).query('blockquote[0]').text().trim();
  if (!bq) return null;
  const match = bq.match(/Pagination:\s*(\w+)/i);
  if (!match) return null;
  const value = match[1].toLowerCase();
  if (value === 'controls') return 'controls';
  if (value === 'infinite') return 'infinite';
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/research-parser-pagination.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run the parser's existing tests for regressions**

Run: `bun test tests/unit/ --bail`
Expected: PASS. If a researcher test fails, `parseDataSections` has changed shared behaviour — it must not.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/ai/researcher/parser.ts tests/unit/research-parser-pagination.test.ts
git commit -m "Parse Data sections and the Pagination line"
```

---

### Task 3: Scroll gate and probe measurement helpers

**Files:**
- Modify: `src/utils/pagination.ts`
- Test: `tests/integration/pagination-browser.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: three in-page functions passed to `page.evaluate`, plus their result types:
  - `measureScroll(css: string): ScrollMeasure | null` — `{ ownScroller, belowFold, scrollTop, rowCount }`
  - `restoreScroll({ css, scrollTop }: { css: string; scrollTop: number }): void`

  Task 4 calls both through `explorer.withPage`.

Both must be **self-contained** — passed to `page.evaluate`, so no outer-scope references, no imports used inside the body.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/pagination-browser.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type Browser, chromium } from 'playwright';
import { measureScroll, restoreScroll } from '../../src/utils/pagination.ts';

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
});

const rows = (count: number, prefix = 'row') => Array.from({ length: count }, (_, i) => `<div class="row">${prefix} ${i}</div>`).join('');

const pageWith = async (body: string) => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0">${body}</body></html>`);
  return page;
};

describe('measureScroll', () => {
  it('reports a container that scrolls inside itself', async () => {
    const page = await pageWith(`<div id="box" style="height:200px;overflow-y:auto">${rows(60)}</div>`);

    const measure = await page.evaluate(measureScroll, '#box');

    expect(measure?.ownScroller).toBe(true);
    expect(measure?.rowCount).toBe(60);
    await page.close();
  });

  it('reports a list that continues below the fold', async () => {
    const page = await pageWith(`<div id="box">${rows(400)}</div>`);

    const measure = await page.evaluate(measureScroll, '#box');

    expect(measure?.ownScroller).toBe(false);
    expect(measure?.belowFold).toBe(true);
    await page.close();
  });

  it('reports neither for a short list', async () => {
    const page = await pageWith('<div id="box"><div class="row">only</div></div>');

    const measure = await page.evaluate(measureScroll, '#box');

    expect(measure?.ownScroller).toBe(false);
    expect(measure?.belowFold).toBe(false);
    await page.close();
  });

  it('returns null for a selector that matches nothing', async () => {
    const page = await pageWith('<div id="box"></div>');

    expect(await page.evaluate(measureScroll, '#missing')).toBeNull();
    await page.close();
  });
});

describe('restoreScroll', () => {
  it('puts a container scroller back where it was', async () => {
    const page = await pageWith(`<div id="box" style="height:200px;overflow-y:auto">${rows(60)}</div>`);
    await page.evaluate(() => {
      document.getElementById('box')!.scrollTop = 0;
    });

    await page.evaluate(() => {
      document.getElementById('box')!.scrollTop = 900;
    });
    await page.evaluate(restoreScroll, { css: '#box', scrollTop: 0 });

    expect((await page.evaluate(measureScroll, '#box'))?.scrollTop).toBe(0);
    await page.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/integration/pagination-browser.test.ts`
Expected: FAIL — `measureScroll` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/utils/pagination.ts`, before the types:

```ts
export function measureScroll(css: string): ScrollMeasure | null {
  const element = document.querySelector(css);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    ownScroller: element.scrollHeight > element.clientHeight + 1,
    belowFold: rect.bottom > window.innerHeight,
    scrollTop: element.scrollTop,
    rowCount: element.querySelectorAll('*').length,
  };
}

export function restoreScroll({ css, scrollTop }: { css: string; scrollTop: number }): void {
  const element = document.querySelector(css);
  if (!element) return;
  element.scrollTop = scrollTop;
}
```

Add to the types at the end of the file:

```ts
export interface ScrollMeasure {
  ownScroller: boolean;
  belowFold: boolean;
  scrollTop: number;
  rowCount: number;
}
```

`+ 1` in `ownScroller` absorbs sub-pixel layout rounding, which otherwise reports a
non-scrolling container as scrollable.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/integration/pagination-browser.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/utils/pagination.ts tests/integration/pagination-browser.test.ts
git commit -m "Measure and restore scroll position for the pagination probe"
```

---

### Task 4: Researcher pagination mixin

**Files:**
- Create: `src/ai/researcher/pagination.ts`
- Modify: `src/ai/researcher.ts` (line 47, the `ResearcherBase` composition; line 49, the interface; and the call site near line 277)
- Modify: `src/ai/researcher/locators.ts` (extract one blockquote writer)
- Test: `tests/unit/researcher-pagination.test.ts`

**Interfaces:**
- Consumes: `PaginationStrategy`, `measureScroll`, `restoreScroll` (Tasks 1, 3); `parseDataSections`, `parseResearchSections`, `extractPaginationFromBlockquote` (Task 2).
- Produces: `WithPagination<T>` mixin exposing `detectPagination(result: ResearchResult): Promise<void>`, and `PaginationMethods` for the interface merge.

**One writer for the blockquote.** `updateSectionContainer` (`src/ai/researcher/locators.ts:300`) currently composes that blockquote. Extract the composition into a shared helper so `Container:` and `Pagination:` are always emitted by the same code.

**This also fixes a live bug.** `mdq(...).query('blockquote[0]').replace(text)` writes `text` verbatim — it does **not** re-add the `>` markers. So today's call:

```ts
result.text = sectionQuery.query('blockquote[0]').replace(`Container: '${newCss}'`);
```

turns the blockquote into a plain paragraph, after which `extractContainerFromBlockquote` (which queries `blockquote[0]`) returns **null** — the container is silently lost for every consumer. Verified against the real `mdq` and `parseResearchSections`:

```
before rewrite, container = .old-toolbar
after rewrite, container = null
```

Every line the helper emits must therefore carry its own `> ` prefix.

- [ ] **Step 1: Extract the shared blockquote writer**

In `src/ai/researcher/locators.ts`, export a helper and use it from `updateSectionContainer`:

```ts
export function composeContainerBlockquote(css: string, pagination: PaginationStrategy | null): string {
  let text = `> Container: '${css}'`;
  if (pagination) text += `\n> Pagination: ${pagination}`;
  return text;
}
```

Add the import at the top of `locators.ts`:

```ts
import type { PaginationStrategy } from '../../utils/pagination.ts';
```

Then in `updateSectionContainer`, replace the `newCss` branch body:

```ts
      if (newCss) {
        const pagination = extractPaginationFromBlockquote(section.rawMarkdown);
        result.text = sectionQuery.query('blockquote[0]').replace(composeContainerBlockquote(newCss, pagination));
      } else {
```

and add `extractPaginationFromBlockquote` to the existing `./parser.ts` import in that file.

This preserves a recorded `Pagination:` line when a container is later simplified or recovered, and restores the `>` markers the current code drops.

- [ ] **Step 1b: Cover the blockquote-survives-rewrite bug**

Add to `tests/unit/research-parser-pagination.test.ts`:

```ts
import { composeContainerBlockquote } from '../../src/ai/researcher/locators.ts';
import { mdq } from '../../src/utils/markdown-query.ts';

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
  });
});
```

Run it and watch the first case fail against the current single-line `replace`, then pass with the helper.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/researcher-pagination.test.ts`. It duck-types Explorer, following `tests/unit/driller.test.ts`:

```ts
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
  const agent = new Agent();
  let scrolled = false;
  agent.explorer = {
    withPage: async (fn: any) =>
      fn({
        evaluate: async (_fn: any, arg: any) => {
          const css = typeof arg === 'string' ? arg : arg?.css;
          const measure = measures[css];
          if (!measure) return null;
          if (scrolled) return { ...measure, rowCount: afterScrollRows };
          return measure;
        },
      }),
    action: () => ({
      attempt: async () => {
        scrolled = true;
        return true;
      },
    }),
  };
  return agent;
};

describe('detectPagination', () => {
  it('records infinite when scrolling adds rows', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const agent = agentWith({ '.suites-list-content': { ownScroller: true, belowFold: false, scrollTop: 0, rowCount: 20 } }, 40);

    await agent.detectPagination(result);

    expect(result.text).toContain('Pagination: infinite');
  });

  it('records nothing when scrolling adds no rows', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const agent = agentWith({ '.suites-list-content': { ownScroller: true, belowFold: false, scrollTop: 0, rowCount: 20 } }, 20);

    await agent.detectPagination(result);

    expect(result.text).not.toContain('Pagination:');
  });

  it('does not probe a section that cannot scroll', async () => {
    const result = new ResearchResult(RESEARCH, '/suites');
    const agent = agentWith({ '.suites-list-content': { ownScroller: false, belowFold: false, scrollTop: 0, rowCount: 5 } }, 99);

    await agent.detectPagination(result);

    expect(result.text).not.toContain('Pagination:');
  });

  it('leaves an already recorded strategy alone', async () => {
    const recorded = RESEARCH.replace("> Container: '.suites-list-content'", "> Container: '.suites-list-content'\n> Pagination: controls");
    const result = new ResearchResult(recorded, '/suites');
    const agent = agentWith({ '.suites-list-content': { ownScroller: true, belowFold: false, scrollTop: 0, rowCount: 20 } }, 40);

    await agent.detectPagination(result);

    expect(result.text).toContain('Pagination: controls');
    expect(result.text).not.toContain('Pagination: infinite');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test tests/unit/researcher-pagination.test.ts`
Expected: FAIL — cannot resolve `src/ai/researcher/pagination.ts`.

- [ ] **Step 4: Write the mixin**

Create `src/ai/researcher/pagination.ts`:

```ts
import type Explorer from '../../explorer.ts';
import { mdq } from '../../utils/markdown-query.ts';
import { type PaginationStrategy, measureScroll, restoreScroll } from '../../utils/pagination.ts';
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
      const before = await this.explorer.withPage((page) => page.evaluate(measureScroll, css));
      if (!before) return null;
      if (!before.ownScroller && !before.belowFold) return null;

      const action = this.explorer.action();
      const scrolled = await action.attempt(`I.scrollTo('${css} > *:last-child')`);
      if (!scrolled) return null;

      const after = await this.explorer.withPage((page) => page.evaluate(measureScroll, css));
      await this.explorer.withPage((page) => page.evaluate(restoreScroll, { css, scrollTop: before.scrollTop }));

      if (!after) return null;
      if (after.rowCount > before.rowCount) return 'infinite';
      return null;
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
```

**Note on the scroll target:** `'<css> > *:last-child'` targets the list's last child, and
`scrollIntoViewIfNeeded` walks every scrollable ancestor from there — which is what reaches a
container with its own scrollbar. Verified against Chromium during design.

**Rows are the evidence, not requests.** `Action.networkRequests` is private (`src/action.ts:46`)
and must stay so. A page fires telemetry and prefetches while scrolling, so a request count
would report growth where there is none — the same reason the tester's rule says a request with
no rows means nothing arrived.

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/unit/researcher-pagination.test.ts`
Expected: PASS, 4 tests.

A colon in the heading is fine — `mdq(...).query('section2(~"Data: Suites List")')` was verified against the real `mdq` to return exactly 1 match.

- [ ] **Step 6: Wire the mixin into Researcher**

In `src/ai/researcher.ts`, add the import beside the other mixin imports:

```ts
import { type PaginationMethods, WithPagination } from './researcher/pagination.ts';
```

Change line 47:

```ts
const ResearcherBase = WithSections(WithPagination(WithDeepAnalysis(WithCoordinates(WithLocators(TaskAgent as unknown as new (...args: any[]) => TaskAgent)))));
```

Change line 49:

```ts
export interface Researcher extends LocatorMethods, CoordinateMethods, DeepAnalysisMethods, SectionMethods, PaginationMethods {}
```

Call it after container validation and before deep analysis — replace the `backfillBrokenLocators` block's tail near line 277 so the order is: backfill, then pagination, then the focused-section fallback:

```ts
      if (!interrupted()) {
        await this.detectPagination(result);
      }
```

- [ ] **Step 7: Verify nothing regressed**

Run: `bun test tests/unit/ tests/integration/researcher-sections.test.ts`
Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add src/ai/researcher/pagination.ts src/ai/researcher/locators.ts src/ai/researcher.ts tests/unit/researcher-pagination.test.ts
git commit -m "Probe list containers for infinite scroll during research"
```

---

### Task 5: Researcher rule for pagination controls

**Files:**
- Create: `rules/researcher/pagination.md`
- Modify: `src/ai/researcher/sections.ts:81`
- Modify: `src/ai/researcher.ts` (the `<output_rules>` Data-section instructions, near line 502)

**Interfaces:**
- Consumes: the `> Pagination:` vocabulary from Task 2.
- Produces: research text that may carry `> Pagination: controls`, which Task 4 leaves alone and Task 6 reads.

- [ ] **Step 1: Write the rule file**

Create `rules/researcher/pagination.md`:

```markdown
<pagination_controls>
When a section holds controls that move between pages of the same collection — previous, next,
a page number, or a control that loads the following batch — add a second line to the section's
container blockquote:

> Pagination: controls

Judge by what the control does to the collection, not by its wording or its icon. Controls that
sort, filter, or switch between different collections are not pagination.
Omit the line when the section has no such control.
</pagination_controls>
```

- [ ] **Step 2: Load it in per-section research**

In `src/ai/researcher/sections.ts:81`, add `'pagination'` to the rules list:

```ts
      const rules = RulesLoader.loadRules('researcher', ['ui-map-table', 'list-element', 'container-rules', 'pagination'], currentUrl);
```

- [ ] **Step 3: Extend the Data-section instructions**

In `src/ai/researcher.ts`, in `<output_rules>` after the line reading
`- Data sections must NOT include a UI map table. Only include the container and a brief summary line.`, add:

```
      - When the data list has controls that move between pages of the collection, add "> Pagination: controls" under its container.
```

- [ ] **Step 4: Verify the rule reaches the prompt**

Run: `bun test tests/integration/researcher-sections.test.ts`
Expected: PASS. If the suite inspects the prompt, confirm `pagination_controls` appears; if it does not inspect prompts, add an assertion that the loaded rules string contains `pagination_controls`.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add rules/researcher/pagination.md src/ai/researcher/sections.ts src/ai/researcher.ts
git commit -m "Ask research to note pagination controls it can see"
```

---

### Task 6: Conditional rule injection into Tester and Navigator

**Files:**
- Modify: `src/ai/rules.ts` (add two exports)
- Modify: `src/ai/tester.ts` (`reinjectContextIfNeeded`, from line 554)
- Modify: `src/ai/navigator.ts` (its per-state context near line 414)
- Test: `tests/unit/pagination-rule-injection.test.ts`

**Interfaces:**
- Consumes: `detectPaginationMarkers` (Task 1), `extractPaginationFromBlockquote`, `parseDataSections`, `parseResearchSections` (Task 2).
- Produces: `paginationRuleFor(strategy: PaginationStrategy): string` and `paginationFromResearch(researchText: string): PaginationStrategy | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pagination-rule-injection.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { paginationFromResearch, paginationRuleFor } from '../../src/ai/rules.ts';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/pagination-rule-injection.test.ts`
Expected: FAIL — `paginationRuleFor` is not exported from `src/ai/rules.ts`.

- [ ] **Step 3: Write the rule fragments**

In `src/ai/rules.ts`, add the imports at the top:

```ts
import { extractPaginationFromBlockquote, parseDataSections, parseResearchSections } from './researcher/parser.ts';
import type { PaginationStrategy } from '../utils/pagination.ts';
```

Add these exports:

```ts
const paginationControlsRule = dedent`
  <pagination>
  This list pages through a larger collection. If what you need is not on screen,
  click next or the page number you need before concluding it is absent.
  </pagination>
`;

const infiniteScrollRule = dedent`
  <pagination>
  This list grows as it is scrolled. If what you need is not on screen, scroll to
  the last item in the list — every scrollable ancestor of that item scrolls, so
  this reaches a list with its own scrollbar.

  New rows in the aria changes mean more arrived; a request with none means nothing
  was left. Stop on the first attempt that adds no rows: the end of a collection is
  an answer, not a failure.
  </pagination>
`;

export function paginationRuleFor(strategy: PaginationStrategy): string {
  if (strategy === 'controls') return paginationControlsRule;
  return infiniteScrollRule;
}

export function paginationFromResearch(researchText: string): PaginationStrategy | null {
  if (!researchText) return null;
  const sections = [...parseResearchSections(researchText), ...parseDataSections(researchText)];
  for (const section of sections) {
    const strategy = extractPaginationFromBlockquote(section.rawMarkdown);
    if (strategy) return strategy;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/pagination-rule-injection.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Inject into Tester**

In `src/ai/tester.ts`, add to the existing `./rules.ts` import: `paginationFromResearch`, `paginationRuleFor`. Add to the `./utils/pagination.ts` import: `detectPaginationMarkers`, and `type PaginationStrategy`.

Add a field beside `seenUiMapUrls`:

```ts
  private paginationByUrl = new Map<string, PaginationStrategy>();
```

Inside `reinjectContextIfNeeded`, in the `if (isNewUrl)` block, right after `this.seenUiMapUrls.add(currentUrl);`:

```ts
        const recorded = paginationFromResearch(research);
        if (recorded) this.paginationByUrl.set(currentUrl, recorded);
```

**Mind the early returns.** This method returns from three places: `return context;` at the end of the `isNewUrl` block (`src/ai/tester.ts:676`), `if (context) return context;` further down, and a final `dedent` fallback. Appending "at the end of the method" would never reach a new URL — which is the case that matters most.

Add a private method after the existing public methods:

```ts
  private paginationContext(currentState: ActionResult, currentUrl: string): string {
    let strategy = detectPaginationMarkers(currentState.html);
    if (!strategy) strategy = this.paginationByUrl.get(currentUrl) ?? null;
    if (!strategy) return '';
    return `\n${paginationRuleFor(strategy)}\n`;
  }
```

Call it immediately before **both** of the first two returns:

```ts
      context += this.paginationContext(currentState, currentUrl);
      return context;
    }
```

and

```ts
    context += this.paginationContext(currentState, currentUrl);
    if (context) return context;
```

The third return is the every-fifth-iteration ARIA refresh, which carries no rules — leave it alone.

- [ ] **Step 6: Inject into Navigator**

In `src/ai/navigator.ts`, add `paginationRuleFor` to the existing `./rules.js` import and `detectPaginationMarkers` from `../utils/pagination.ts`.

At the prompt built near line 414, add a local before the `dedent` and a slot inside it:

```ts
    let paginationHint = '';
    const strategy = detectPaginationMarkers(actionResult.html);
    if (strategy) paginationHint = paginationRuleFor(strategy);
```

Place `${paginationHint}` directly after `${actionRule}` in that template.

Navigator gets the marker path only — it has no research text in hand at that point.

- [ ] **Step 7: Verify**

Run: `bun test tests/unit/ tests/integration/`
Expected: PASS.

- [ ] **Step 8: Format and commit**

```bash
bun run format
git add src/ai/rules.ts src/ai/tester.ts src/ai/navigator.ts tests/unit/pagination-rule-injection.test.ts
git commit -m "Inject the pagination rule only where a strategy was detected"
```

---

### Task 7: `actionRule` documents scrolling

**Files:**
- Modify: `src/ai/rules.ts` (`actionRule`, from line 307)
- Modify: `src/ai/tools.ts` (the `form` tool description, from line 354)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks import.

- [ ] **Step 1: Add the scroll commands to `<actions>`**

In `src/ai/rules.ts`, inside the `actionRule` dedent block, after the `I.click` subsection, add:

```
  ### I.scrollTo

  scrolls until the element is in view

  I.scrollTo(<locator>)

  Scrolls every scrollable ancestor of the target, so it reaches an element inside a container
  that has its own scrollbar. I.scrollPageToBottom() moves only the page itself.

  <example>
    I.scrollTo('.rows > *:last-child');
    I.scrollTo({ role: 'listitem', text: 'Last entry' });
    I.scrollPageToBottom();
  </example>
```

- [ ] **Step 2: Add the use case to the `form` tool description**

In `src/ai/tools.ts`, in the `form` tool's `Use cases:` list, add:

```
        - Reaching items further down a list (I.scrollTo)
```

- [ ] **Step 3: Verify**

Run: `bun test tests/integration/`
Expected: PASS.

- [ ] **Step 4: Format and commit**

```bash
bun run format
git add src/ai/rules.ts src/ai/tools.ts
git commit -m "Document the scroll commands the model can use"
```

---

### Task 8: Thread the ARIA added/removed split

**Files:**
- Modify: `src/utils/aria.ts` (`AriaDiff` at 587, `diffAriaSnapshots` at 503)
- Modify: `src/action-result.ts` (`PageDiff` at 46, `Diff` at 650, the populate site at 552, the calculate site at 740)
- Test: `tests/unit/aria.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `AriaDiff.added: number`, `AriaDiff.removed: number`; `PageDiff.ariaAdded?: number`, `PageDiff.ariaRemoved?: number`. Task 9 reads the `PageDiff` fields.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/aria.test.ts` inside the existing `describe('aria', ...)`:

```ts
  it('counts additions and removals separately', () => {
    const before = `- list:\n  - listitem "One"`;
    const after = `- list:\n  - listitem "One"\n  - listitem "Two"\n  - listitem "Three"`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
  });

  it('counts a replacement as both', () => {
    const before = `- list:\n  - listitem "One"`;
    const after = `- list:\n  - listitem "Two"`;

    const diff = diffAriaSnapshots(before, after);

    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/aria.test.ts`
Expected: FAIL — `diff.added` is undefined.

- [ ] **Step 3: Widen `AriaDiff`**

In `src/utils/aria.ts`, change the interface at line 587:

```ts
export interface AriaDiff {
  text: string | null;
  count: number;
  added: number;
  removed: number;
}
```

And the return at the end of `diffAriaSnapshots` (line 524):

```ts
  return {
    text: formatDiff(added, removed, toggled, typed),
    count: added.length + removed.length + toggled.length + typed.length,
    added: added.length,
    removed: removed.length,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/aria.test.ts`
Expected: PASS.

- [ ] **Step 5: Carry the split into `PageDiff`**

In `src/action-result.ts`, add to the `PageDiff` interface after `ariaChangeCount?: number;`:

```ts
  ariaAdded?: number;
  ariaRemoved?: number;
```

In `Diff`, add the fields beside `_ariaChangeCount`:

```ts
  private _ariaAdded = 0;
  private _ariaRemoved = 0;
```

Set them where `diffAriaSnapshots` is called (line 740):

```ts
    this._ariaAdded = ariaDiff.added;
    this._ariaRemoved = ariaDiff.removed;
```

Expose them beside the existing `ariaChangeCount` getter at line 708, matching its style:

```ts
  get ariaAdded(): number {
    return this._ariaAdded;
  }

  get ariaRemoved(): number {
    return this._ariaRemoved;
  }
```

Populate them where `ariaChangeCount` is set (line 553):

```ts
      pageDiff.ariaAdded = diff.ariaAdded;
      pageDiff.ariaRemoved = diff.ariaRemoved;
```

**Leave line 572 alone.** The other `LARGE_ARIA_CHANGE_THRESHOLD` comparison decides whether to attach iframe snapshots on a big change. That is unrelated to mode-change semantics and must keep using the total.

- [ ] **Step 6: Verify**

Run: `bun test tests/unit/`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add src/utils/aria.ts src/action-result.ts tests/unit/aria.test.ts
git commit -m "Carry the ARIA added and removed counts into PageDiff"
```

---

### Task 9: Correct the two contradicting tool messages

**Files:**
- Modify: `src/ai/tools.ts` (`hasObservablePageChange` at 1236, `isMajorPageChange` at 1220, the `form` no-change message at 417)
- Test: `tests/unit/pagination-tool-results.test.ts`

**Interfaces:**
- Consumes: `PageDiff.ariaAdded` / `ariaRemoved` (Task 8).
- Produces: nothing other tasks import.

**Why:** an end-of-list scroll currently returns `failedToolResult` and commits `TestResult.FAILED` into the notes read by final review and Historian; and a batch of appended rows trips "MAJOR PAGE CHANGE. Page entered a different mode."

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pagination-tool-results.test.ts`:

```ts
import { describe, expect, it } from 'bun:test';
import { isMajorPageChange } from '../../src/ai/tools.ts';
import type { PageDiff } from '../../src/action-result.ts';

const diff = (over: Partial<PageDiff>): PageDiff => ({ urlChanged: false, currentUrl: '/list', ...over }) as PageDiff;

describe('isMajorPageChange', () => {
  it('treats a large batch of pure additions as growth', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 120, ariaAdded: 120, ariaRemoved: 0 }))).toBe(false);
  });

  it('still flags a churning diff as a mode change', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 120, ariaAdded: 60, ariaRemoved: 60 }))).toBe(true);
  });

  it('ignores a small diff either way', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 4, ariaAdded: 2, ariaRemoved: 2 }))).toBe(false);
  });

  it('falls back to the total when the split is absent', () => {
    expect(isMajorPageChange(diff({ ariaChangeCount: 120 }))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/pagination-tool-results.test.ts`
Expected: FAIL — the first case returns `true`.

- [ ] **Step 3: Fix `isMajorPageChange`**

In `src/ai/tools.ts`:

```ts
export function isMajorPageChange(pageDiff: PageDiff): boolean {
  if (pageDiff.urlChanged === true) return false;
  if ((pageDiff.ariaChangeCount ?? 0) < LARGE_ARIA_CHANGE_THRESHOLD) return false;
  if (pageDiff.ariaRemoved === 0 && (pageDiff.ariaAdded ?? 0) > 0) return false;
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/pagination-tool-results.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Count a request as an observable change**

In `hasObservablePageChange`, add before the final return:

```ts
  if (data.pageDiff.requests?.length) return true;
```

- [ ] **Step 6: Rewrite the `form` no-change message**

At `src/ai/tools.ts:417`, replace the message and suggestion so they report what was observed instead of prescribing a form recovery:

```ts
            return failedToolResult('form', 'Command executed, but nothing on the page changed: no navigation, no ARIA change, no HTML change and no request.', {
              ...toolResult,
              code: codeBlock,
              suggestion: 'The command ran without reaching anything. Re-locate the target, check whether another UI layer is active, then retry. If the goal was to load more of a list, no change means the collection has ended.',
            });
```

- [ ] **Step 7: Verify**

Run: `bun test tests/unit/ tests/integration/`
Expected: PASS.

- [ ] **Step 8: Format, lint, commit**

```bash
bun run format
bun run lint:fix
git add src/ai/tools.ts tests/unit/pagination-tool-results.test.ts
git commit -m "Stop reporting an end-of-list check as a failed step"
```

---

### Task 10: Full-stack browser test and changelog

**Files:**
- Modify: `tests/integration/pagination-browser.test.ts` (extend)
- Create: `test-data/infinite-list.html`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Create the fixture**

Create `test-data/infinite-list.html` — a container that scrolls inside itself and appends rows when scrolled near its end:

```html
<!doctype html>
<html>
  <body style="margin: 0">
    <div id="feed" style="height: 240px; overflow-y: auto"></div>
    <script>
      const feed = document.getElementById('feed');
      let next = 0;
      const addBatch = () => {
        for (let i = 0; i < 20; i++) {
          const row = document.createElement('div');
          row.className = 'row';
          row.style.height = '40px';
          row.textContent = `row ${next++}`;
          feed.appendChild(row);
        }
      };
      addBatch();
      feed.addEventListener('scroll', () => {
        if (feed.scrollTop + feed.clientHeight < feed.scrollHeight - 20) return;
        if (next >= 100) return;
        addBatch();
      });
    </script>
  </body>
</html>
```

- [ ] **Step 2: Write the failing test**

Append to `tests/integration/pagination-browser.test.ts`:

```ts
describe('scrolling a container that appends', () => {
  it('adds rows and can be put back', async () => {
    const page = await browser.newPage();
    await page.goto(`file://${join(process.cwd(), 'test-data', 'infinite-list.html')}`, { waitUntil: 'domcontentloaded' });

    const before = await page.evaluate(measureScroll, '#feed');
    await page.locator('#feed > *:last-child').scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const after = await page.evaluate(measureScroll, '#feed');
    await page.evaluate(restoreScroll, { css: '#feed', scrollTop: before!.scrollTop });
    const restored = await page.evaluate(measureScroll, '#feed');

    expect(before?.ownScroller).toBe(true);
    expect(after!.rowCount).toBeGreaterThan(before!.rowCount);
    expect(restored?.scrollTop).toBe(before!.scrollTop);
    await page.close();
  });
});
```

Add `import { join } from 'node:path';` at the top of that file if Task 3 did not.

- [ ] **Step 3: Run it**

Run: `bun test tests/integration/pagination-browser.test.ts`
Expected: PASS. This is the end-to-end proof that `scrollIntoViewIfNeeded` reaches a container's own scroller and that the append fires.

- [ ] **Step 4: Run the whole suite**

Run: `bun test`
Expected: PASS. Note that `codeceptjs` and `just-bash` mocks leak process-wide between test files, so an unrelated failure may be ordering, not this work — re-run the failing file alone to confirm.

- [ ] **Step 5: Update the changelog**

Invoke the `/changelog` skill to add the entry. Do not hand-write it.

- [ ] **Step 6: Lint and commit**

```bash
bun run format
bun run lint:fix
git add test-data/infinite-list.html tests/integration/pagination-browser.test.ts CHANGELOG.md
git commit -m "Prove container scrolling end to end and update the changelog"
```

---

## Verification

Before opening a PR:

```bash
bun test
bun run lint:fix
bunx tsc --noEmit -p tsconfig.json
```

`tsc` matters: CI runs with `--noCheck`, so strict type errors pass every green check. Run it yourself on the changed files.

**Do not** add the `regression` label or trigger `regression.yml`. If this needs regression coverage, say so and let the user decide.
