# Region-of-Interest States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect modals, drawers and soft-navigated subviews as first-class states by diffing HTML after each action, verify with a Playwright geometry probe whether the appeared region overlays the page, surface the region to Tester, Pilot, StateManager and experience files (`root:` frontmatter) — and **unify all overlay detection into `src/utils/overlay.ts`, deleting the old selector-heuristic path entirely**.

**Architecture:** A structural pipeline orchestrated by `Action.capturePageState` with every decision function in `overlay.ts`: memoized parse5 diff vs previous state → `findAppearedSubRoot` (≥ 10K chars) → browser coverage probe → `classifyRegionCoverage` → `Overlay.fromSubRoot`. `Overlay` gains `type: 'drawer' | 'region'`, `root` and `present` (`detected` keeps meaning "verified overlaying"). Named regions enter the state hash (`baseHash` escape hatch for research keys); experience files carry `root:` and load only while a matching region is open. After the new path lands, the selector-based path (`extractVisibleOverlayHtml`, `OVERLAY_SELECTORS`, `captureOverlayHtml`, `overlayHtml`, Driller's private extractor) is removed — detection is ARIA + diff/geometry, nothing else.

**Tech Stack:** Bun, TypeScript, parse5 (html-diff), Playwright `page.evaluate` (probe), gray-matter (experience frontmatter), bun:test.

**Spec:** `docs/superpowers/specs/2026-08-29-region-states-design.md` — read it first; the plan argues from it, including the "Removed code" table Task 11 executes.

## Global Constraints

- Bun only — never Node.js; run tests with `bun test <path>`.
- **Execute in the dedicated worktree branched off `main`** (created via `bunosh worktree:create`, which symlinks the main checkout's `node_modules`). Never touch the main checkout at `~/projects/explorbot` — it carries unrelated in-flight work. This plan's code quotes were taken from a tree that had small uncommitted changes to `src/ai/pilot.ts` and `src/ai/researcher/deep-analysis.ts`; the regions this plan edits exist identically on `main`, but re-read every file immediately before editing — line numbers are approximate anchors, the quoted code is the authoritative anchor, and where a quote differs slightly from what's on disk, the on-disk code wins as the base for the edit.
- Per-task commits stage **only the files named in the task** (`git add <file> <file>`), never `git add -A` — the dirty tree holds unrelated work.
- Code style (from CLAUDE.md): no comments unless stated; no ternary operators; no `...(cond ? {k:v} : {})` spread — plain `if`; premature exit over if/else; `?.` over `&&` chains; private methods after public; new types at end of file; `dedent` for prompts; `mdq()` for markdown (never regex/includes on markdown).
- Prompts and rules must be GENERAL — no examples from debug sessions, no site-specific selectors or class names.
- No AI calls anywhere in the detection path — detection is structural (data tier).
- Run `bun run format` after each code change, before each commit.
- Never trigger the regression CI workflow (`regression` label / `gh workflow run`) — local unit + integration tests are the feedback loop.

---

### Task 1: Overlay core — types, root, `present`, `findAppearedSubRoot`

**Files:**
- Modify: `src/utils/overlay.ts`, `src/utils/html-diff.ts` (one-line export)
- Test: `tests/unit/overlay-detection.test.ts`

**Interfaces:**
- Consumes: `HtmlDiffPart` and `pathToXPath` from `html-diff.ts` (`pathToXPath` becomes exported); `extractHeadings` from `./html.js` (already imported in overlay.ts).
- Produces (later tasks rely on these exact names):
  - `OverlayType = 'dialog' | 'modal' | 'drawer' | 'region'`; `OverlayData` gains `root?: string | null`.
  - `Overlay` gains `readonly root: string | null`, `get present(): boolean`, `static fromSubRoot(subRoot: AppearedSubRoot, verdict: RegionVerdict): Overlay`, private `static nameFromHtml(html: string): string | null`.
  - `findAppearedSubRoot(parts: HtmlDiffPart[]): AppearedSubRoot | null` in `overlay.ts`; `export interface AppearedSubRoot { container: string; elementXPath: string; subtree: string; size: number }` at end of `overlay.ts`.
  - `RegionVerdict` is implemented in Task 2; for this task declare it in `overlay.ts`'s end-of-file types block: `export interface RegionVerdict { overlays: boolean; coverage: number }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/overlay-detection.test.ts` (extend its imports with `findAppearedSubRoot` from `../../src/utils/overlay.ts` and `htmlDiff` from `../../src/utils/html-diff.ts`):

```ts
describe('findAppearedSubRoot', () => {
  const bigForm = Array.from({ length: 200 }, (_, i) => `<div><label>Field ${i}</label><input name="field-${i}" placeholder="value ${i}"></div>`).join('');
  const basePage = '<html><body><div id="app"><h1>Users</h1><ul><li><a href="/users/1">First User</a></li></ul></div></body></html>';
  const pageWithDrawer = `<html><body><div id="app"><h1>Users</h1><ul><li><a href="/users/1">First User</a></li></ul></div><div class="drawer"><h2>Edit User</h2><form>${bigForm}</form></div></body></html>`;

  it('finds a large appeared element with container and element xpath', async () => {
    const diff = await htmlDiff(basePage, pageWithDrawer);
    const subRoot = findAppearedSubRoot(diff.parts);
    expect(subRoot).not.toBeNull();
    expect(subRoot!.size).toBeGreaterThanOrEqual(10_000);
    expect(subRoot!.container).toBe('body');
    expect(subRoot!.elementXPath).toBe('//body/div[2]');
    expect(subRoot!.subtree).toContain('Edit User');
  });

  it('returns null when the appeared content is below the threshold', async () => {
    const before = '<html><body><div id="app"><h1>Users</h1></div></body></html>';
    const after = '<html><body><div id="app"><h1>Users</h1></div><div class="toast">Saved successfully</div></body></html>';
    const diff = await htmlDiff(before, after);
    expect(findAppearedSubRoot(diff.parts)).toBeNull();
  });

  it('returns null when nothing appeared', async () => {
    const diff = await htmlDiff(basePage, basePage);
    expect(findAppearedSubRoot(diff.parts)).toBeNull();
  });
});

describe('Overlay.fromSubRoot', () => {
  const subRoot = {
    container: 'aside.detail-panel',
    elementXPath: '//body/div[2]',
    subtree: '<aside class="detail-panel"><h2>Edit User</h2><form><input name="name"></form></aside>',
    size: 12000,
  };

  it('overlaying with full coverage becomes a modal named by headings', () => {
    const overlay = Overlay.fromSubRoot(subRoot, { overlays: true, coverage: 0.95 });
    expect(overlay.type).toBe('modal');
    expect(overlay.name).toBe('Edit User');
    expect(overlay.root).toBe('aside.detail-panel');
    expect(overlay.detected).toBe(true);
    expect(overlay.present).toBe(true);
  });

  it('overlaying with partial coverage becomes a drawer', () => {
    expect(Overlay.fromSubRoot(subRoot, { overlays: true, coverage: 0.3 }).type).toBe('drawer');
  });

  it('inline verdict becomes a region: present but not detected', () => {
    const overlay = Overlay.fromSubRoot(subRoot, { overlays: false, coverage: 0.3 });
    expect(overlay.type).toBe('region');
    expect(overlay.detected).toBe(false);
    expect(overlay.present).toBe(true);
  });

  it('body container falls back to the element xpath as root', () => {
    const overlay = Overlay.fromSubRoot({ ...subRoot, container: 'body' }, { overlays: true, coverage: 1 });
    expect(overlay.root).toBe('//body/div[2]');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/overlay-detection.test.ts`
Expected: FAIL — `findAppearedSubRoot` / `fromSubRoot` do not exist.

- [ ] **Step 3: Export `pathToXPath` from html-diff**

In `src/utils/html-diff.ts` change `function pathToXPath(treePath: string): string {` to `export function pathToXPath(treePath: string): string {`. Nothing else in that file changes.

- [ ] **Step 4: Extend Overlay and add `findAppearedSubRoot`**

Rewrite `src/utils/overlay.ts` (keep `OVERLAY_SELECTORS`, `fromAria`, `resolve`, `fromHtml`, `captureConfig` bodies verbatim for now — they are deleted in Task 11, not here; `fromHtml` delegates to the new `nameFromHtml`):

```ts
import { detectFocusArea } from './aria.js';
import { type HtmlDiffPart, pathToXPath } from './html-diff.js';
import { HTML_EXTRACTION_LIMITS, HTML_SELECTORS, HTML_VISIBILITY_LIMITS, type VisibleOverlayExtractionConfig, extractHeadings } from './html.js';

export const OVERLAY_SELECTORS = { /* unchanged */ } as const;

export type OverlayType = 'dialog' | 'modal' | 'drawer' | 'region';
export type OverlayData = { type?: OverlayType | null; name?: string | null; root?: string | null };

export class Overlay {
  readonly type: OverlayType | null;
  readonly name: string | null;
  readonly root: string | null;

  constructor(data: OverlayData = {}) {
    this.type = data.type ?? null;
    this.name = data.name ?? null;
    this.root = data.root ?? null;
  }

  get detected(): boolean {
    return this.type !== null && this.type !== 'region';
  }

  get present(): boolean {
    return this.type !== null;
  }

  static fromHtml(html: string): Overlay {
    return new Overlay({ type: 'modal', name: Overlay.nameFromHtml(html) });
  }

  static fromSubRoot(subRoot: AppearedSubRoot, verdict: RegionVerdict): Overlay {
    let type: OverlayType = 'region';
    if (verdict.overlays) {
      type = 'drawer';
      if (verdict.coverage >= FULL_COVERAGE_RATIO) type = 'modal';
    }
    let root = subRoot.container;
    if (root === 'body') root = subRoot.elementXPath;
    return new Overlay({ type, name: Overlay.nameFromHtml(subRoot.subtree), root });
  }

  static fromAria(snapshot: string | null): Overlay { /* unchanged */ }
  static resolve(data: { overlayHtml?: string; overlay?: OverlayData | null; ariaSnapshot?: string | null }): Overlay { /* unchanged */ }
  static captureConfig(): VisibleOverlayExtractionConfig { /* unchanged */ }

  private static nameFromHtml(html: string): string | null {
    const headings = extractHeadings(html);
    return [headings.h1, headings.h2, headings.h3, headings.h4].filter(Boolean).join(' ') || null;
  }
}

const SUBROOT_MIN_HTML = 10_000;
const FULL_COVERAGE_RATIO = 0.8;

export function findAppearedSubRoot(parts: HtmlDiffPart[]): AppearedSubRoot | null {
  let best: AppearedSubRoot | null = null;
  for (const part of parts) {
    const appeared = part.added.find((line) => line.startsWith('ELEMENT:'));
    if (!appeared) continue;
    if (part.subtree.length < SUBROOT_MIN_HTML) continue;
    if (best && part.subtree.length <= best.size) continue;
    best = {
      container: part.container,
      elementXPath: pathToXPath(appeared.slice('ELEMENT:'.length)),
      subtree: part.subtree,
      size: part.subtree.length,
    };
  }
  return best;
}

export interface AppearedSubRoot {
  container: string;
  elementXPath: string;
  subtree: string;
  size: number;
}

export interface RegionVerdict {
  overlays: boolean;
  coverage: number;
}
```

`/* unchanged */` markers mean: keep the existing bodies verbatim — do not retype them. Cycle check holds: overlay → html-diff → html, overlay → html, overlay → aria; nothing imports overlay from those three.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/overlay-detection.test.ts && bun test tests/unit/html-diff.test.ts && bun test tests/unit/aria.test.ts && bun test tests/unit/state-manager.test.ts`
Expected: PASS — `detected` semantics for `dialog`/`modal` are unchanged, and the pre-existing `extractVisibleOverlayHtml`/resolve tests still pass because that path is untouched until Task 11. If the first `findAppearedSubRoot` test's `container` assertion fails, inspect the actual value — `findStableContainer` returns `body` for top-level appended nodes because `html[1]/body[1]` is in `IGNORED_PATHS`.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/utils/overlay.ts src/utils/html-diff.ts tests/unit/overlay-detection.test.ts
git commit -m "feat: Overlay carries region types and root; detect appeared subroots from diff"
```

---

### Task 2: Coverage probe and classifier in overlay.ts

**Files:**
- Modify: `src/utils/overlay.ts`
- Test: `tests/unit/overlay-detection.test.ts`

**Interfaces:**
- Consumes: `RegionVerdict` (Task 1).
- Produces (Task 4 relies on): `classifyRegionCoverage(samples: RegionCoverageSamples | null): RegionVerdict`; `probeRegionCoverage(config: { xpath: string }): RegionCoverageSamples` (runs inside the browser); `getRegionCoverageProbeSource(): string`; `export interface RegionCoverageSamples { found: boolean; rect: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number }; position: string; zIndex: number; outsideHits: Array<'inside' | 'blocked' | 'page'>; siblingsInert: boolean; bodyScrollLocked: boolean }` at end of `overlay.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/overlay-detection.test.ts` (import `classifyRegionCoverage`, `getRegionCoverageProbeSource` and type `RegionCoverageSamples` from `../../src/utils/overlay.ts`):

```ts
const samplesBase = (): RegionCoverageSamples => ({
  found: true,
  rect: { x: 0, y: 0, width: 1280, height: 720 },
  viewport: { width: 1280, height: 720 },
  position: 'fixed',
  zIndex: 100,
  outsideHits: [],
  siblingsInert: false,
  bodyScrollLocked: false,
});

describe('classifyRegionCoverage', () => {
  it('full viewport coverage is overlaying', () => {
    const verdict = classifyRegionCoverage(samplesBase());
    expect(verdict.overlays).toBe(true);
    expect(verdict.coverage).toBeCloseTo(1);
  });

  it('partial floating region with all outside points blocked is overlaying', () => {
    const samples = samplesBase();
    samples.rect = { x: 880, y: 0, width: 400, height: 720 };
    samples.outsideHits = ['blocked', 'blocked', 'blocked', 'blocked'];
    const verdict = classifyRegionCoverage(samples);
    expect(verdict.overlays).toBe(true);
    expect(verdict.coverage).toBeLessThan(0.8);
  });

  it('inert siblings mean overlaying regardless of geometry', () => {
    const samples = samplesBase();
    samples.rect = { x: 0, y: 0, width: 400, height: 400 };
    samples.siblingsInert = true;
    expect(classifyRegionCoverage(samples).overlays).toBe(true);
  });

  it('static in-flow region with page hits outside is inline', () => {
    const samples = samplesBase();
    samples.rect = { x: 200, y: 100, width: 800, height: 500 };
    samples.position = 'static';
    samples.zIndex = 0;
    samples.outsideHits = ['page', 'page', 'page'];
    expect(classifyRegionCoverage(samples).overlays).toBe(false);
  });

  it('missing element or null samples is inline with zero coverage', () => {
    expect(classifyRegionCoverage(null)).toEqual({ overlays: false, coverage: 0 });
    const samples = samplesBase();
    samples.found = false;
    expect(classifyRegionCoverage(samples)).toEqual({ overlays: false, coverage: 0 });
  });
});

describe('getRegionCoverageProbeSource', () => {
  it('serializes to a reconstructible function', () => {
    const source = getRegionCoverageProbeSource();
    const fn = new Function(`return ${source}`)();
    expect(typeof fn).toBe('function');
  });
});
```

Run: `bun test tests/unit/overlay-detection.test.ts` — expected FAIL.

- [ ] **Step 2: Implement classifier and probe**

In `src/utils/overlay.ts`, below `findAppearedSubRoot`:

```ts
export function classifyRegionCoverage(samples: RegionCoverageSamples | null): RegionVerdict {
  if (!samples?.found) return { overlays: false, coverage: 0 };
  const viewportArea = samples.viewport.width * samples.viewport.height;
  if (!viewportArea) return { overlays: false, coverage: 0 };

  const rect = samples.rect;
  const visibleWidth = Math.min(rect.x + rect.width, samples.viewport.width) - Math.max(rect.x, 0);
  const visibleHeight = Math.min(rect.y + rect.height, samples.viewport.height) - Math.max(rect.y, 0);
  const coverage = (Math.max(0, visibleWidth) * Math.max(0, visibleHeight)) / viewportArea;

  if (coverage >= FULL_COVERAGE_RATIO) return { overlays: true, coverage };
  if (samples.siblingsInert) return { overlays: true, coverage };

  const floating = samples.position === 'fixed' || samples.position === 'absolute' || samples.zIndex > 0;
  if (!floating) return { overlays: false, coverage };

  const outside = samples.outsideHits;
  if (outside.length > 0 && outside.every((hit) => hit !== 'page')) return { overlays: true, coverage };
  if (samples.bodyScrollLocked && outside.length > 0 && outside.filter((hit) => hit !== 'page').length * 2 >= outside.length) return { overlays: true, coverage };

  return { overlays: false, coverage };
}

export function probeRegionCoverage(config: { xpath: string }): RegionCoverageSamples {
  const samples: RegionCoverageSamples = {
    found: false,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    position: 'static',
    zIndex: 0,
    outsideHits: [],
    siblingsInert: false,
    bodyScrollLocked: false,
  };

  const result = document.evaluate(config.xpath, document, null, 9, null);
  const node = result.singleNodeValue;
  if (!node || node.nodeType !== 1) return samples;
  const element = node as HTMLElement;
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return samples;

  const style = window.getComputedStyle(element);
  samples.found = true;
  samples.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  samples.position = style.position;
  samples.zIndex = Number.parseInt(style.zIndex || '0', 10) || 0;

  const bodyStyle = window.getComputedStyle(document.body);
  samples.bodyScrollLocked = bodyStyle.overflow === 'hidden' || bodyStyle.overflowY === 'hidden';

  for (const sibling of Array.from(element.parentElement?.children || [])) {
    if (sibling === element) continue;
    if (!sibling.hasAttribute('inert') && sibling.getAttribute('aria-hidden') !== 'true') continue;
    samples.siblingsInert = true;
    break;
  }

  function classifyHit(hit: Element | null): 'inside' | 'blocked' | 'page' {
    if (!hit) return 'page';
    if (element.contains(hit)) return 'inside';
    let current: Element | null = hit;
    for (let depth = 0; current && depth < 4; depth++) {
      const hitStyle = window.getComputedStyle(current as HTMLElement);
      const hitZ = Number.parseInt(hitStyle.zIndex || '0', 10) || 0;
      if ((hitStyle.position === 'fixed' || hitStyle.position === 'absolute') && hitZ > 0) return 'blocked';
      current = current.parentElement;
    }
    return 'page';
  }

  const inset = 10;
  const width = window.innerWidth;
  const height = window.innerHeight;
  const points: Array<[number, number]> = [
    [inset, inset],
    [width - inset, inset],
    [inset, height - inset],
    [width - inset, height - inset],
    [width / 2, inset],
    [width / 2, height - inset],
    [inset, height / 2],
    [width - inset, height / 2],
  ];
  for (const [x, y] of points) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) continue;
    samples.outsideHits.push(classifyHit(document.elementFromPoint(x, y)));
  }

  return samples;
}

export function getRegionCoverageProbeSource(): string {
  return probeRegionCoverage.toString();
}
```

Add `RegionCoverageSamples` to the end-of-file types block. The probe runs in the browser via `new Function`, so it must stay self-contained — no imports, no outer-scope references; type annotations erase at runtime so `toString()` stays valid. `9` is `XPathResult.FIRST_ORDERED_NODE_TYPE` as a literal.

- [ ] **Step 3: Run tests to verify they pass**

Run: `bun test tests/unit/overlay-detection.test.ts`
Expected: PASS.

- [ ] **Step 4: Format and commit**

```bash
bun run format
git add src/utils/overlay.ts tests/unit/overlay-detection.test.ts
git commit -m "feat: region coverage probe and classifier in overlay module"
```

---

### Task 3: ActionResult — baseHash, region hash, diff memoization, tool-result payoff

**Files:**
- Modify: `src/action-result.ts`
- Test: `tests/unit/action-result.test.ts`, `tests/unit/action-result-diff.test.ts`

**Interfaces:**
- Consumes: `Overlay.present`, `Overlay.root` (Task 1).
- Produces (Tasks 4–10 rely on): `get baseHash(): string`; `getStateHash()` including `region_<name>` for named present regions; memoized `diff(previous)` (same `previous.id` → same `Diff` instance); `public regionSubtree: string | undefined`; `PageDiff.areaOfInterest?: string`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/action-result.test.ts`:

```ts
describe('region state hash', () => {
  const html = '<html><body><h1>Users</h1></body></html>';

  it('named region forks the hash; baseHash stays the page hash', () => {
    const plain = new ActionResult({ url: 'https://app.example.com/users', html });
    const withRegion = new ActionResult({
      url: 'https://app.example.com/users',
      html,
      overlay: { type: 'drawer', name: 'Edit User', root: 'aside.panel' },
    });
    expect(withRegion.hash).not.toBe(plain.hash);
    expect(withRegion.hash).toContain('region_edit_user');
    expect(withRegion.baseHash).toBe(plain.hash);
  });

  it('unnamed region does not fork the hash', () => {
    const plain = new ActionResult({ url: 'https://app.example.com/users', html });
    const unnamed = new ActionResult({ url: 'https://app.example.com/users', html, overlay: { type: 'modal' } });
    expect(unnamed.hash).toBe(plain.hash);
  });
});
```

Append to `tests/unit/action-result-diff.test.ts` (reuse that file's existing helpers for building states):

```ts
describe('diff memoization and areaOfInterest', () => {
  it('returns the same Diff instance for the same previous state', async () => {
    const previous = new ActionResult({ id: 1, url: 'https://app.example.com/users', html: '<html><body><h1>Users</h1></body></html>' });
    const current = new ActionResult({ id: 2, url: 'https://app.example.com/users', html: '<html><body><h1>Users</h1><p>changed</p></body></html>' });
    const first = await current.diff(previous);
    const second = await current.diff(previous);
    expect(second).toBe(first);
  });

  it('reports the appeared region instead of a collapsed dump', async () => {
    const previous = new ActionResult({ id: 1, url: 'https://app.example.com/users', html: '<html><body><h1>Users</h1></body></html>' });
    const current = new ActionResult({
      id: 2,
      url: 'https://app.example.com/users',
      html: '<html><body><h1>Users</h1><aside class="panel"><h2>Edit User</h2></aside></body></html>',
      overlay: { type: 'drawer', name: 'Edit User', root: 'aside.panel' },
    });
    current.regionSubtree = '<aside class="panel"><h2>Edit User</h2><form><input name="name"><button>Save</button></form></aside>';
    const result = await current.toToolResult(previous, 'aside.panel');
    expect(result.pageDiff?.areaOfInterest).toBe('drawer "Edit User" opened, scope: aside.panel');
    expect(result.pageDiff?.htmlParts).toHaveLength(1);
    expect(result.pageDiff?.htmlParts?.[0].container).toBe('aside.panel');
    expect(result.pageDiff?.htmlParts?.[0].subtree).toContain('Edit User');
  });
});
```

Run: `bun test tests/unit/action-result.test.ts tests/unit/action-result-diff.test.ts` — expected FAIL.

- [ ] **Step 2: Implement hash changes**

In `src/action-result.ts` replace `getStateHash()` (currently at :478) with:

```ts
  getStateHash(): string {
    return this.computeStateHash(true);
  }

  get baseHash(): string {
    return this.computeStateHash(false);
  }
```

and add the private method (after the public methods, near `consoleErrors`):

```ts
  private computeStateHash(includeRegion: boolean): string {
    const parts: string[] = [];

    parts.push(this.relativeUrl || this.url || '/');

    this.extractHeadings(this.html);

    if (this.h1) parts.push(`h1_${this.h1}`);
    if (this.h2) parts.push(`h2_${this.h2}`);
    if (includeRegion && this.overlay.present && this.overlay.name) parts.push(`region_${this.overlay.name}`);

    let stateString = slugify(parts.map((part) => part.substring(0, 100)).join('_'));

    if (stateString.length > 200) {
      stateString = stateString.substring(0, 200);
      if (stateString.endsWith('_')) {
        stateString = stateString.slice(0, -1);
      }
    }

    return stateString;
  }
```

`get hash()` already delegates to `getStateHash()` — leave it.

- [ ] **Step 3: Implement diff memoization and regionSubtree**

Add fields next to `overlay`:

```ts
  public regionSubtree: string | undefined = undefined;
  private _diffCache: { previousId: number | undefined; diff: Diff } | null = null;
```

Replace `diff()` (currently `return Diff.create(this, previousState)`):

```ts
  async diff(previousState: ActionResult | null): Promise<Diff> {
    if (this._diffCache && this._diffCache.previousId === previousState?.id) return this._diffCache.diff;
    const diff = await Diff.create(this, previousState);
    this._diffCache = { previousId: previousState?.id, diff };
    return diff;
  }
```

- [ ] **Step 4: Implement the tool-result payoff**

Add to `PageDiff` interface: `areaOfInterest?: string;`

In `toToolResult`, replace the block

```ts
    if (diff.htmlParts.length > 0) {
      const collapsed = collapseHtmlParts(await diff.cleanedHtmlParts());
      if (collapsed.length > 0) {
        pageDiff.htmlParts = collapsed;
      }
    }
```

with:

```ts
    if (this.overlay.present && !previousState.overlay.present) {
      let area = `${this.overlay.type} "${this.overlay.name || 'unnamed'}" opened`;
      if (this.overlay.root) area += `, scope: ${this.overlay.root}`;
      pageDiff.areaOfInterest = area;
    }

    if (pageDiff.areaOfInterest && this.regionSubtree && this.overlay.root) {
      const htmlConfig = ConfigParser.getInstance().getConfig().html;
      let subtree = await minifyHtml(htmlCombinedSnapshot(this.regionSubtree, htmlConfig?.combined));
      if (subtree.length > HTML_PART_SUBTREE_BUDGET) {
        subtree = `${subtree.slice(0, HTML_PART_SUBTREE_BUDGET)}...<!-- truncated -->`;
      }
      pageDiff.htmlParts = [{ container: this.overlay.root, subtree, added: [], removed: [] }];
    } else if (diff.htmlParts.length > 0) {
      const collapsed = collapseHtmlParts(await diff.cleanedHtmlParts());
      if (collapsed.length > 0) {
        pageDiff.htmlParts = collapsed;
      }
    }
```

(`minifyHtml`, `htmlCombinedSnapshot`, `ConfigParser` are already imported in this file.)

- [ ] **Step 5: Run tests**

Run: `bun test tests/unit/action-result.test.ts tests/unit/action-result-diff.test.ts tests/unit/action-result-memo.test.ts tests/unit/state-manager.test.ts`
Expected: PASS. If the `region_edit_user` assertion fails on slug shape, print the hash and adjust the expectation to the actual `slugify` output of `region_Edit User` — the invariant under test is fork + containment, not the separator.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/action-result.ts tests/unit/action-result.test.ts tests/unit/action-result-diff.test.ts
git commit -m "feat: region-aware state hash, baseHash, memoized diff and areaOfInterest tool results"
```

---

### Task 4: Detection pipeline in Action

**Files:**
- Modify: `src/action.ts`

**Interfaces:**
- Consumes: `findAppearedSubRoot`, `classifyRegionCoverage`, `Overlay.fromSubRoot`, `getRegionCoverageProbeSource`, type `RegionCoverageSamples` — all from `./utils/overlay.ts` (Tasks 1–2); `result.diff` memoization + `regionSubtree` (Task 3).
- Produces: every captured `ActionResult` may now carry a diff-detected `overlay` (`modal`/`drawer`/`region`) and `regionSubtree` before `stateManager.updateState` runs. No new exports.

- [ ] **Step 1: Wire imports**

In `src/action.ts` extend the existing `./utils/overlay.ts` import (currently `import { Overlay } from './utils/overlay.js';` or similar — check) to also bring `classifyRegionCoverage`, `findAppearedSubRoot`, `getRegionCoverageProbeSource` and type `RegionCoverageSamples`.

- [ ] **Step 2: Hook detection before updateState**

In `capturePageState` (src/action.ts:170-188), between `const result = new ActionResult({...})` and `this.stateManager.updateState(result, codeBlock)`:

```ts
      if (!frame) await this.detectRegionOfInterest(result).catch((err: Error) => debugLog('Region detection failed:', err.message));
      this.stateManager.updateState(result, codeBlock);
```

- [ ] **Step 3: Implement the private methods**

After the existing private `captureOverlayHtml` (private methods stay after public ones):

```ts
  private async detectRegionOfInterest(result: ActionResult): Promise<void> {
    if (result.overlay.detected) return;
    const previousState = this.stateManager.getCurrentState();
    if (!previousState) return;
    const previous = ActionResult.fromState(previousState);
    if (!previous.html || previous.html === result.html) return;
    if (!result.isSameUrl({ url: previous.url })) return;

    const diff = await result.diff(previous);
    const subRoot = findAppearedSubRoot(diff.htmlParts);
    if (!subRoot) return;

    const samples = await this.probeRegion(subRoot.elementXPath);
    const verdict = classifyRegionCoverage(samples);
    result.overlay = Overlay.fromSubRoot(subRoot, verdict);
    result.regionSubtree = subRoot.subtree;
    debugLog(`Region of interest: ${result.overlay.type} "${result.overlay.name}" root=${result.overlay.root} coverage=${verdict.coverage.toFixed(2)}`);
  }

  private async probeRegion(xpath: string): Promise<RegionCoverageSamples | null> {
    return this.playwrightHelper.page
      .evaluate(
        ({ probeSource, config }: { probeSource: string; config: any }) => {
          const probe = new Function(`return ${probeSource}`)() as (config: any) => any;
          return probe(config);
        },
        { probeSource: getRegionCoverageProbeSource(), config: { xpath } }
      )
      .catch((err: Error) => {
        debugLog('Region coverage probe failed:', err.message);
        return null;
      });
  }
```

Two guards matter and must not be dropped: `result.overlay.detected` (an ARIA-detected overlay already owns the state) and `isSameUrl` (URL changes are already full state changes with research; the diff path is only for in-place swaps).

- [ ] **Step 4: Verify nothing regressed**

Run: `bun test tests/unit/`
Expected: PASS (the glue has no unit test — its pure parts are covered by Tasks 1–3; end-to-end behavior is exercised by the local regression harness, which only the user runs).

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/action.ts
git commit -m "feat: detect region of interest from page diff during capture"
```

---

### Task 5: StateManager records region states

**Files:**
- Modify: `src/state-manager.ts`
- Test: `tests/unit/state-manager.test.ts`

**Interfaces:**
- Consumes: `Overlay.present` (Task 1); region-aware `hash` (Task 3).
- Produces: transitions recorded for region open/close; `tag('data').log('state', …)` payload gains `region` when a region is present. Rename `hasDialogAppeared` → `hasRegionAppeared` (private — no external consumers).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/state-manager.test.ts` (reuse that file's existing StateManager construction):

```ts
describe('region state transitions', () => {
  const html = '<html><body><h1>Users</h1></body></html>';

  it('records a transition when a named region opens and when it closes', () => {
    const base = new ActionResult({ url: '/users', html });
    stateManager.updateState(base);
    const historyAfterBase = stateManager.getStateHistory().length;

    const withDrawer = new ActionResult({ url: '/users', html, overlay: { type: 'drawer', name: 'Edit User', root: 'aside.panel' } });
    stateManager.updateState(withDrawer);
    expect(stateManager.getStateHistory().length).toBe(historyAfterBase + 1);

    const closed = new ActionResult({ url: '/users', html });
    stateManager.updateState(closed);
    expect(stateManager.getStateHistory().length).toBe(historyAfterBase + 2);
  });

  it('records a transition for an unnamed region via hasRegionAppeared', () => {
    const base = new ActionResult({ url: '/users', html });
    stateManager.updateState(base);
    const historyAfterBase = stateManager.getStateHistory().length;

    const unnamed = new ActionResult({ url: '/users', html, overlay: { type: 'modal' } });
    stateManager.updateState(unnamed);
    expect(stateManager.getStateHistory().length).toBe(historyAfterBase + 1);
  });
});
```

Run: `bun test tests/unit/state-manager.test.ts` — observe which assertions already pass (named open/close comes from the Task 3 hash fork); the tests pin the behavior either way.

- [ ] **Step 2: Generalize the check**

In `src/state-manager.ts`:

```ts
    const hashChanged = actionResult.hash !== previousHash;
    const regionAppeared = !hashChanged && this.hasRegionAppeared(previousState, newState);

    if (hashChanged || regionAppeared) {
```

and rename/adjust the private method:

```ts
  private hasRegionAppeared(previousState: WebPageState | null, newState: WebPageState): boolean {
    const prevFocus = previousState?.overlay ?? Overlay.fromAria(previousState?.ariaSnapshot ?? null);
    const newFocus = newState.overlay ?? Overlay.fromAria(newState.ariaSnapshot ?? null);
    return !prevFocus.present && newFocus.present;
  }
```

Update the debug line inside the branch to `debugLog('State change detected: region of interest appeared');`.

- [ ] **Step 3: Extend the remote state frame**

In `emitStateChange`:

```ts
    const payload: Record<string, unknown> = { url: state.fullUrl || state.url, path: state.url, title: state.title, h1: state.h1 };
    if (state.overlay?.present) payload.region = state.overlay.name || state.overlay.type;
    tag('data').log('state', payload);
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/state-manager.test.ts tests/unit/state-manager-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/state-manager.ts tests/unit/state-manager.test.ts
git commit -m "feat: record region-of-interest transitions in state manager"
```

---

### Task 6: Experience `root:` envelope

**Files:**
- Modify: `src/experience-tracker.ts`, `src/action-result.ts`, `CLAUDE.md`
- Test: `tests/unit/experience-tracker.test.ts`

**Interfaces:**
- Consumes: `Overlay.present` / `Overlay.root` (Task 1), region-hashed states (Task 3).
- Produces: experience frontmatter key `root` (single writer: `ExperienceTracker.ensureExperienceFile`); retrieval gate in `ActionResult.isRelevantExperienceRecord(record: WebPageState & { root?: string }, …)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/experience-tracker.test.ts`, reusing that file's existing `beforeEach` setup (temp experience dir, tracker construction). The tests need only the `tracker` it already builds:

```ts
describe('region experience root', () => {
  const html = '<html><body><h1>Users</h1></body></html>';
  const regionOverlay = { type: 'drawer' as const, name: 'Edit User', root: 'aside.panel' };

  it('writes root frontmatter for a region state', () => {
    const regionState = new ActionResult({ url: '/users', html, overlay: regionOverlay });
    tracker.writeAction(regionState, { title: 'Save the edit form', code: 'I.click("Save")', explanation: '' });
    const { data } = tracker.readExperienceFile(regionState.getStateHash());
    expect(data.root).toBe('aside.panel');
  });

  it('skips root-scoped records when no region is open, loads them when it matches', () => {
    const regionState = new ActionResult({ url: '/users', html, overlay: regionOverlay });
    tracker.writeAction(regionState, { title: 'Save the edit form', code: 'I.click("Save")', explanation: '' });

    const baseState = new ActionResult({ url: '/users', html });
    const baseContents = tracker.getRelevantExperience(baseState).map((e) => e.content);
    expect(baseContents.join('\n')).not.toContain('Save the edit form');

    const openState = new ActionResult({ url: '/users', html, overlay: regionOverlay });
    const openContents = tracker.getRelevantExperience(openState).map((e) => e.content);
    expect(openContents.join('\n')).toContain('Save the edit form');

    const otherRegion = new ActionResult({ url: '/users', html, overlay: { type: 'drawer' as const, name: 'Filters', root: 'div.filters' } });
    const otherContents = tracker.getRelevantExperience(otherRegion).map((e) => e.content);
    expect(otherContents.join('\n')).not.toContain('Save the edit form');
  });
});
```

Run: `bun test tests/unit/experience-tracker.test.ts` — expected FAIL.

- [ ] **Step 2: Implement the writer**

In `src/experience-tracker.ts` `ensureExperienceFile` (currently :118), replace the frontmatter literal:

```ts
    if (!existsSync(filePath)) {
      const frontmatter: Record<string, unknown> = {
        url: state.url ? extractStatePath(state.url) : '',
        title: state.title,
      };
      if (state.overlay.present && state.overlay.root) {
        frontmatter.root = state.overlay.root;
      }
      this.writeExperienceFile(stateHash, '', frontmatter);
    }
```

Plain `if` — no conditional spread.

- [ ] **Step 3: Implement the retrieval gate**

In `src/action-result.ts` `isRelevantExperienceRecord` (currently :261), widen the signature and add the gate as the first check after the null guard:

```ts
  isRelevantExperienceRecord(record: WebPageState & { root?: string }, options?: { includeDescendantExperience?: boolean }): boolean {
    if (!record.url || !this.url) return false;
    if (record.root) {
      if (!this.overlay.present) return false;
      if (this.overlay.root && this.overlay.root !== record.root) return false;
    }
    if (this.isMatchedBy(record)) return true;
```

(rest of the method unchanged). A record without `root` behaves exactly as today — envelope rule 3. The `root` gate comes first so behavior does not depend on heading coincidences between region and page states.

- [ ] **Step 4: Document the envelope key**

In `CLAUDE.md`, "Data Envelope Formats" table, Experience row: change the envelope cell from `sparse frontmatter` to `sparse frontmatter: url, title, optional root (region scoping selector — record loads only while a matching region is open)`.

- [ ] **Step 5: Run tests**

Run: `bun test tests/unit/experience-tracker.test.ts tests/unit/experience-compactor.test.ts tests/unit/historian-experience.test.ts`
Expected: PASS.

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/experience-tracker.ts src/action-result.ts CLAUDE.md tests/unit/experience-tracker.test.ts
git commit -m "feat: root selector envelope key scopes experience to open regions"
```

---

### Task 7: Researcher — baseHash keys, widened overlay research

**Files:**
- Modify: `src/ai/researcher.ts`, `src/ai/researcher/deep-analysis.ts`

**Interfaces:**
- Consumes: `baseHash` (Task 3), `Overlay.present` (Task 1).
- Produces: research cache keyed by `baseHash` (region states share the page's research); `researchOverlay` fires for any named present region, not only dialog/modal.

- [ ] **Step 1: Key the cache by baseHash**

In `src/ai/researcher.ts`:

At :78-80 replace the static helper body:

```ts
  static getCachedResearch(state: WebPageState): string {
    return getCachedResearch(ActionResult.fromState(state).baseHash);
  }
```

At :99 replace `const stateHash = state.hash || this.actionResult.getStateHash();` with:

```ts
    const stateHash = this.actionResult.baseHash;
```

Then run `grep -n "\.hash" src/ai/researcher.ts src/ai/researcher/*.ts` and audit each hit: cache reads/writes (`getCachedResearch`, `saveResearch`, `getPreviousResearch`, `researchPath` keys) move to `baseHash`; state-equality comparisons (e.g. `getStateHash() === getCurrentState()?.hash` at :154 and :317) stay full-hash — both sides use the same computation, so they remain consistent.

- [ ] **Step 2: Widen researchOverlay**

In `src/ai/researcher/deep-analysis.ts` at :93-95 replace:

```ts
      const focusArea = current.overlay;
      if (!focusArea.detected || !focusArea.name) return null;
      if (focusArea.type !== 'dialog' && focusArea.type !== 'modal') return null;
```

with:

```ts
      const focusArea = current.overlay;
      if (!focusArea.present || !focusArea.name) return null;
```

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/ && bun test tests/integration/`
Expected: PASS. Failures here mean a cache-key call site was converted that should not have been (or vice versa) — re-audit the grep list before changing anything else.

- [ ] **Step 4: Format and commit**

```bash
bun run format
git add src/ai/researcher.ts src/ai/researcher/deep-analysis.ts
git commit -m "feat: key research by base page hash and research any named region"
```

---

### Task 8: Tester context — focus scope root, area of interest

**Files:**
- Modify: `src/ai/tester.ts`

**Interfaces:**
- Consumes: `Overlay.present`/`root` (Task 1), `baseHash` (Task 3), widened `researchOverlay` (Task 7).
- Produces: `<focus_scope>` carries the root selector; new `<area_of_interest>` block for inline regions injected once per state change; `pageStateHash` holds `baseHash`.

- [ ] **Step 1: Track state-change trigger**

In `reinjectContextIfNeeded` (src/ai/tester.ts:528), replace the tracking prologue:

```ts
    const isNewUrl = this.previousUrl !== currentUrl;

    this.previousUrl = currentUrl;
    this.previousStateHash = currentStateHash;
```

with:

```ts
    const isNewUrl = this.previousUrl !== currentUrl;
    const isNewState = !isNewUrl && this.previousStateHash !== null && this.previousStateHash !== currentStateHash;

    this.previousUrl = currentUrl;
    this.previousStateHash = currentStateHash;
```

- [ ] **Step 2: Root selector in focus_scope**

In the `if (focusArea.detected)` block (currently :558), add before `context +=`:

```ts
      let rootHint = '';
      if (focusArea.root) rootHint = `\nIts content lives inside \`${focusArea.root}\` — scope locators to it.`;
```

and change the first line of the dedent block to:

```
        A ${focusArea.type}${areaName} is currently open above the page.${rootHint}
```

(the rest of the block unchanged — the strict "not actionable outside" wording stays, and stays gated on `detected`, i.e. on a probe-verified or ARIA-verified overlay).

- [ ] **Step 3: Inline area_of_interest block**

Immediately after the `if (focusArea.detected) { ... }` block add:

```ts
    if (!focusArea.detected && focusArea.present && isNewState) {
      let rootHint = '';
      if (focusArea.root) rootHint = `\nIt lives inside \`${focusArea.root}\`.`;
      context += dedent`
        <area_of_interest>
        A large new area "${focusArea.name || 'unnamed area'}" appeared on this page without navigation.${rootHint}
        The scenario most likely continues inside this area — prefer its elements for your next actions.
        The rest of the page (navigation, menus, filters) is still interactive and remains available.
        </area_of_interest>
      `;
    }
```

General wording only — no element names, no site specifics.

- [ ] **Step 4: baseHash for research keys and widened overlay-research gate**

At :592 replace `this.pageStateHash = currentStateHash;` with:

```ts
      this.pageStateHash = currentState.baseHash;
```

At :630 replace the condition `if (focusArea.detected && focusArea.name && this.pageStateHash && this.pageActionResult)` with:

```ts
    if (focusArea.present && focusArea.name && this.pageStateHash && this.pageActionResult) {
```

- [ ] **Step 5: Run tests**

Run: `bun test tests/unit/ && bun test tests/integration/`
Expected: PASS (prompt changes must go through the integration suite before pushing — house rule).

- [ ] **Step 6: Format and commit**

```bash
bun run format
git add src/ai/tester.ts
git commit -m "feat: tester context carries region root and inline area of interest"
```

---

### Task 9: Pilot state context and prompt

**Files:**
- Modify: `src/ai/pilot.ts`
- Test: `tests/unit/pilot-state-context.test.ts`

**Interfaces:**
- Consumes: `Overlay.present`/`root` (Task 1).
- Produces: `<state>` shows `modal: <name> (root: <selector>)` for verified overlays and `region: <name> (inline, root: <selector>)` for inline regions; one general diagnostic bullet in the Pilot system prompt.

**Note:** `src/ai/pilot.ts` and this test file carry uncommitted in-flight changes — read both fully before editing and integrate, do not revert anything.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/pilot-state-context.test.ts`, following that file's existing pattern for building an `ActionResult` and reading `buildStateContext` output:

```ts
it('shows verified overlay with its root', () => {
  const state = new ActionResult({ url: '/users', html: '<html><body><h1>Users</h1></body></html>', overlay: { type: 'drawer', name: 'Edit User', root: 'aside.panel' } });
  const context = buildContext(state);
  expect(context).toContain('modal: Edit User (root: aside.panel)');
});

it('shows inline region distinctly from a modal', () => {
  const state = new ActionResult({ url: '/users', html: '<html><body><h1>Users</h1></body></html>', overlay: { type: 'region', name: 'User Details', root: 'section.details' } });
  const context = buildContext(state);
  expect(context).toContain('region: User Details (inline, root: section.details)');
  expect(context).not.toContain('modal: User Details');
});
```

(`buildContext` here stands for however the existing tests invoke `buildStateContext` — reuse their helper verbatim.)

Run: `bun test tests/unit/pilot-state-context.test.ts` — expected FAIL.

- [ ] **Step 2: Implement the state lines**

In `src/ai/pilot.ts` `buildStateContext` (currently :828-834) replace:

```ts
    const focusArea = state.overlay;
    if (focusArea.detected) {
      lines.push(`modal: ${focusArea.name || focusArea.type}`);
    } else {
      lines.push('modal: none');
    }
```

with:

```ts
    const focusArea = state.overlay;
    if (focusArea.detected) {
      let line = `modal: ${focusArea.name || focusArea.type}`;
      if (focusArea.root) line += ` (root: ${focusArea.root})`;
      lines.push(line);
    } else if (focusArea.present) {
      let line = `region: ${focusArea.name || 'unnamed'} (inline`;
      if (focusArea.root) line += `, root: ${focusArea.root}`;
      lines.push(`${line})`);
    } else {
      lines.push('modal: none');
    }
```

- [ ] **Step 3: One general prompt bullet**

In `getSystemPrompt`, in the "Diagnostic patterns" list, add one line:

```
      - "region:" in <state> → a large area appeared in place without navigation (subview, wizard step, panel). Direct Tester to act inside it; the rest of the page is still usable.
```

Nothing else in the prompt changes.

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/pilot-state-context.test.ts && bun test tests/integration/`
Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
bun run format
git add src/ai/pilot.ts tests/unit/pilot-state-context.test.ts
git commit -m "feat: pilot state context distinguishes overlaying modals from inline regions"
```

---

### Task 10: Driller — nested overlay context from pageDiff

**Files:**
- Modify: `src/ai/driller.ts`
- Test: `tests/unit/driller.test.ts` (run, extend only if it covers `detectNestedOverlayContext`)

**Interfaces:**
- Consumes: `pageDiff.htmlParts` / `pageDiff.areaOfInterest` from tool results (Task 3).
- Produces: `detectNestedOverlayContext` no longer queries the live DOM; `Driller.getVisibleOverlayHtml` is deleted along with its imports (`getVisibleOverlayHtmlExtractorSource`, `OVERLAY_SELECTORS`, and any `HTML_*` config constants imported only for it).

- [ ] **Step 1: Replace the DOM query with the diff the result already carries**

In `src/ai/driller.ts` `detectNestedOverlayContext` (currently :648), replace the overlay-fetch prologue:

```ts
    if (!result?.pageDiff?.ariaChanges || result.pageDiff.urlChanged) return null;

    const overlayHtml = await this.getVisibleOverlayHtml();
    if (!overlayHtml) return null;
```

with:

```ts
    if (!result?.pageDiff?.ariaChanges || result.pageDiff.urlChanged) return null;

    const parts = result.pageDiff.htmlParts ?? [];
    let appeared = parts.filter((part: any) => part.added?.length > 0);
    if (result.pageDiff.areaOfInterest) appeared = parts;
    const overlayHtml = appeared.map((part: any) => part.subtree).join('\n');
    if (!overlayHtml) return null;
```

The rest of the method (the `<nested_overlay>` dedent block) is unchanged — `overlayHtml` keeps its name and role in the prompt.

- [ ] **Step 2: Delete the private extractor**

Remove the whole `private async getVisibleOverlayHtml()` method (currently :674-692). Then remove from the imports at the top of `driller.ts`: `getVisibleOverlayHtmlExtractorSource`, `OVERLAY_SELECTORS`, and each of `HTML_SELECTORS` / `HTML_EXTRACTION_LIMITS` / `HTML_VISIBILITY_LIMITS` **only if** `grep -n "<name>" src/ai/driller.ts` shows no remaining use in this file.

- [ ] **Step 3: Run tests**

Run: `bun test tests/unit/driller.test.ts && bun test tests/unit/`
Expected: PASS.

- [ ] **Step 4: Format and commit**

```bash
bun run format
git add src/ai/driller.ts
git commit -m "refactor: driller reads nested overlays from page diff instead of DOM queries"
```

---

### Task 11: Delete the selector-based overlay path

**Files:**
- Modify: `src/action.ts`, `src/action-result.ts`, `src/utils/overlay.ts`, `src/utils/html.ts`
- Test: `tests/unit/overlay-detection.test.ts`

**Interfaces:**
- Consumes: everything new from Tasks 1–10 (the replacements must be in place first).
- Produces: `Overlay.resolve(data: { overlay?: OverlayData | null; ariaSnapshot?: string | null })` — narrowed signature, no `overlayHtml`. Deleted symbols (per the spec's "Removed code" table): `Action.captureOverlayHtml`, `ActionResultData.overlayHtml`, `Overlay.fromHtml`, `Overlay.captureConfig`, `OVERLAY_SELECTORS`, `extractVisibleOverlayHtml`, `getVisibleOverlayHtmlExtractorSource`, `VisibleOverlayExtractionConfig`.

- [ ] **Step 1: Update the tests first**

In `tests/unit/overlay-detection.test.ts`:
- Delete the `describe('extractVisibleOverlayHtml', …)` block and the `overlayConfig` helper plus the now-unused imports (`extractVisibleOverlayHtml`, `VisibleOverlayExtractionConfig`, `OVERLAY_SELECTORS`, `HTML_*` constants — keep any that other tests in the file still use).
- Rewrite the `Overlay.resolve` tests that pass `overlayHtml` (currently around :129 and :153) to assert the narrowed behavior:

```ts
it('resolve prefers stored overlay data over aria', () => {
  const overlay = Overlay.resolve({ overlay: { type: 'modal', name: 'Stored' }, ariaSnapshot: aria });
  expect(overlay.name).toBe('Stored');
});

it('resolve falls back to aria detection', () => {
  expect(Overlay.resolve({ ariaSnapshot: aria }).detected).toBe(true);
});
```

(adapt the `aria` fixture to whatever the file already defines).

Run: `bun test tests/unit/overlay-detection.test.ts` — expected FAIL (resolve still accepts overlayHtml, extractor still exists — the failures confirm the tests now demand the deletion).

- [ ] **Step 2: Delete in overlay.ts**

Remove `OVERLAY_SELECTORS`, `Overlay.fromHtml`, `Overlay.captureConfig`, and the `overlayHtml` branch of `resolve`:

```ts
  static resolve(data: { overlay?: OverlayData | null; ariaSnapshot?: string | null }): Overlay {
    if (data.overlay) return new Overlay(data.overlay);
    return Overlay.fromAria(data.ariaSnapshot ?? null);
  }
```

Prune imports that only served the deleted code (`HTML_EXTRACTION_LIMITS`, `HTML_SELECTORS`, `HTML_VISIBILITY_LIMITS`, `VisibleOverlayExtractionConfig`). `nameFromHtml` stays — `fromSubRoot` uses it.

- [ ] **Step 3: Delete in action.ts and action-result.ts**

- `src/action.ts`: remove the `captureOverlayHtml` method; remove `let overlayHtml = '';`, `if (!frame) overlayHtml = await this.captureOverlayHtml();` and the `overlayHtml: overlayHtml || undefined,` constructor line in `capturePageState`; drop `getVisibleOverlayHtmlExtractorSource` from imports.
- `src/action-result.ts`: remove `overlayHtml?: string;` from `ActionResultData`.

- [ ] **Step 4: Delete in html.ts**

Remove `extractVisibleOverlayHtml`, `getVisibleOverlayHtmlExtractorSource`, and the `VisibleOverlayExtractionConfig` interface. For each limit field used only by them (`overlayHtmlLength`, `maxOverlayCount`, `minOverlayWidth`, `minOverlayHeight`, `maxViewportOverlayRatio`, `minOpacity`): run `grep -rn "<field>" src/` and delete the field only when the extractor was its sole consumer — shared visibility limits used by other extractors stay.

- [ ] **Step 5: Verify the path is gone**

```bash
grep -rn "extractVisibleOverlayHtml\|getVisibleOverlayHtmlExtractorSource\|OVERLAY_SELECTORS\|captureConfig\|overlayHtml\|Overlay.fromHtml" src/ tests/
```

Expected: no hits in `src/` (test-fixture prose mentioning "overlay" is fine; symbol references are not).

- [ ] **Step 6: Run tests**

Run: `bun test tests/unit/ && bun test tests/integration/`
Expected: PASS.

- [ ] **Step 7: Format and commit**

```bash
bun run format
git add src/action.ts src/action-result.ts src/utils/overlay.ts src/utils/html.ts tests/unit/overlay-detection.test.ts
git commit -m "refactor: remove selector-based overlay detection; overlay.ts is the single detection module"
```

---

### Task 12: Finalization

**Files:**
- Modify: `CHANGELOG.md` (via the `/changelog` skill)

- [ ] **Step 1: Full verification**

```bash
bun run format
bun run lint:fix
bun test tests/unit/
bun test tests/integration/
```

Expected: everything green. Fix regressions before proceeding; do not skip failing tests.

- [ ] **Step 2: Dedup pass**

Run the code-duplication-detector agent over the changed files (house rule after major changes). Apply only findings that touch code introduced by this plan.

- [ ] **Step 3: Changelog**

Invoke the `/changelog` skill to add the entry for this feature, then commit:

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for region-of-interest states"
```

- [ ] **Step 4: Report**

Report to the user: what was built, what was deleted (the spec's "Removed code" table), test results, and that end-to-end validation against a real app is available via the local `regression:*` bunosh commands — which only the user decides to run. Never trigger the regression CI workflow.
