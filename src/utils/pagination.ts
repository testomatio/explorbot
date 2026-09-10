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

export function measureScroll(css: string): ScrollMeasure | null {
  const element = document.querySelector(css);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    ownScroller: element.scrollHeight > element.clientHeight + 1,
    belowFold: rect.bottom > window.innerHeight,
    scrollTop: element.scrollTop,
    windowScrollY: window.scrollY,
    rowCount: element.querySelectorAll(':scope > *').length,
  };
}

export function restoreScroll({ css, scrollTop, windowScrollY }: ScrollRestore): void {
  const element = document.querySelector(css);
  if (element) element.scrollTop = scrollTop;
  window.scrollTo(0, windowScrollY);
}

export type PaginationStrategy = 'controls' | 'infinite';

export interface ScrollMeasure {
  ownScroller: boolean;
  belowFold: boolean;
  scrollTop: number;
  windowScrollY: number;
  rowCount: number;
}

export interface ScrollRestore {
  css: string;
  scrollTop: number;
  windowScrollY: number;
}
