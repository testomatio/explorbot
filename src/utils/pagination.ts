export function inspectList(css: string): ListMeasure | null {
  const element = document.querySelector(css);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    hasPagingControls: !!element.querySelector('a[rel="next"], a[rel="prev"]'),
    isFeed: element.matches('[role="feed"]') || !!element.querySelector('[role="feed"]'),
    scrolls: element.scrollHeight > element.clientHeight + 1 || rect.bottom > window.innerHeight,
    items: element.querySelectorAll(':scope > *').length,
    scrollTop: element.scrollTop,
    pageScrollY: window.scrollY,
  };
}

export function restoreScroll({ css, scrollTop, pageScrollY }: ScrollPosition): void {
  const element = document.querySelector(css);
  if (element) element.scrollTop = scrollTop;
  window.scrollTo(0, pageScrollY);
}

export type PaginationStrategy = 'controls' | 'infinite';

export interface ListMeasure {
  hasPagingControls: boolean;
  isFeed: boolean;
  scrolls: boolean;
  items: number;
  scrollTop: number;
  pageScrollY: number;
}

export interface ScrollPosition {
  css: string;
  scrollTop: number;
  pageScrollY: number;
}
