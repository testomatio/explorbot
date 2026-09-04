import type { HtmlDiffPart } from './html-diff.js';
import { pathToXPath } from './html-diff.js';
import { extractHeadings } from './html.js';
import { createDebug } from './logger.js';

const debugLog = createDebug('explorbot:region');

export class Region {
  readonly type: RegionType | null;
  readonly name: string | null;
  readonly root: string | null;
  readonly html: string | null;
  readonly xpath: string | null;
  readonly parent: RegionData | null;

  constructor(data: RegionData = {}) {
    this.type = data.type ?? null;
    this.name = data.name ?? null;
    this.root = data.root ?? null;
    this.html = data.html ?? null;
    this.xpath = data.xpath ?? null;
    this.parent = data.parent ?? null;
  }

  get isOpen(): boolean {
    return this.type !== null;
  }

  get isModal(): boolean {
    return false;
  }

  describe(): string {
    if (!this.isOpen) return '';
    let text = `${this.type} "${this.name || 'unnamed'}" opened`;
    if (this.root) text += `, scope: ${this.root}`;
    return text;
  }

  withParent(parent: Region): Region {
    const Ctor = this.constructor as new (data: RegionData) => Region;
    return new Ctor({
      type: this.type,
      name: this.name,
      root: this.root,
      html: this.html,
      xpath: this.xpath,
      parent: { type: parent.type, name: parent.name, root: parent.root, xpath: parent.xpath },
    });
  }
}

export function addedSubtrees(diff: RegionDiff): AddedSubtree[] {
  const candidates: AddedSubtree[] = [];
  for (const part of diff.parts) {
    const appeared = part.added.find((line) => line.startsWith('ELEMENT:'));
    if (!appeared) continue;
    if (diff.pageSize > 0 && part.rawSize > REGION_MAX_RATIO * diff.pageSize) {
      debugLog(`Added subtree spans ${Math.round((part.rawSize / diff.pageSize) * 100)}% of the page — a new state, not a region`);
      continue;
    }
    const headings = headingsOf(part.subtree);
    const newHeading = headings.find((heading) => !diff.previousHtml.includes(heading)) ?? null;
    let name = newHeading;
    if (!name && headings.length > 0) name = headings.join(' ');
    const namedContainer = part.container !== 'body' && !part.container.startsWith('//');
    let root: string | null = null;
    if (namedContainer && part.containerWasEmpty) root = part.container;
    if (!root) root = part.appearedSelector ?? null;
    if (!root && namedContainer) root = part.container;
    candidates.push({
      xpath: pathToXPath(appeared.slice('ELEMENT:'.length)),
      html: part.subtree,
      size: part.subtree.length,
      rawSize: part.rawSize,
      sizable: part.subtree.length >= REGION_MIN_HTML,
      name,
      root,
      hasNewHeading: !!newHeading,
    });
  }
  const sizable = candidates.filter((candidate) => candidate.sizable);
  const totalRawSize = sizable.reduce((sum, candidate) => sum + candidate.rawSize, 0);
  const largest = Math.max(0, ...sizable.map((candidate) => candidate.rawSize));
  if (largest < REGION_DOMINANCE * totalRawSize) {
    debugLog('Changes are scattered across the page, no dominant region');
    return [];
  }
  const identified = candidates.filter((candidate) => candidate.name || candidate.root);
  if (identified.length < candidates.length) debugLog('Dropped added content with no name and no scoping root');
  identified.sort((a, b) => Number(b.hasNewHeading) - Number(a.hasNewHeading) || b.size - a.size);
  return identified;
}

const headingsOf = (html: string): string[] => {
  const headings = extractHeadings(html);
  return [headings.h1, headings.h2, headings.h3, headings.h4].filter(Boolean) as string[];
};

const REGION_MIN_HTML = 5_000;
const REGION_MAX_RATIO = 0.6;
const REGION_DOMINANCE = 0.7;

export type RegionType = 'overlay' | 'region';

export type RegionData = {
  type?: RegionType | null;
  name?: string | null;
  root?: string | null;
  html?: string | null;
  xpath?: string | null;
  parent?: RegionData | null;
};

export interface RegionDiff {
  parts: HtmlDiffPart[];
  pageSize: number;
  similarity: number;
  sameUrl: boolean;
  previousHtml: string;
}

export interface AddedSubtree {
  xpath: string;
  html: string;
  size: number;
  rawSize: number;
  sizable: boolean;
  name: string | null;
  root: string | null;
  hasNewHeading: boolean;
}
