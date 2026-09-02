import type { HtmlDiffPart } from './html-diff.js';

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
