const PROBE_CONFIG = {
  maxRegions: 6,
  maxUnseen: 8,
  scrollSlack: 24,
  minRegionSize: 80,
  minHiddenFraction: 0.1,
  minTextLength: 2,
  maxLabelLength: 60,
  interactiveSelector: 'a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=tab],[role=menuitem]',
};

export async function collectVisibilityReport(page: any): Promise<VisibilityReport | null> {
  const report = await page.evaluate(probeVisibility, PROBE_CONFIG).catch(() => null);
  if (!report) return null;
  if (!report.regions.length && !report.unseen.length) return null;
  return report;
}

export function probeVisibility(config: ProbeConfig): VisibilityReport {
  const regions: VisibilityRegion[] = [];
  const unseen: UnseenElement[] = [];
  let moreRegions = 0;
  let moreUnseen = 0;

  const docWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
  const docHeight = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);

  const label = (el: Element): string => {
    const named = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder');
    if (named) return `${el.getAttribute('role') || el.tagName.toLowerCase()} "${named.trim().slice(0, config.maxLabelLength)}"`;

    const heading = el.querySelector('h1,h2,h3,legend,caption,[role=heading]');
    if (heading?.textContent?.trim()) return `${el.getAttribute('role') || el.tagName.toLowerCase()} "${heading.textContent.trim().slice(0, config.maxLabelLength)}"`;

    const own = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (own) return `${el.getAttribute('role') || el.tagName.toLowerCase()} "${own.slice(0, config.maxLabelLength)}"`;
    return el.tagName.toLowerCase();
  };

  const perceivable = (el: Element, style: CSSStyleDeclaration): boolean => {
    const check = (el as any).checkVisibility;
    if (typeof check === 'function') return check.call(el, { opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return Number.parseFloat(style.opacity || '1') > 0.05;
  };

  const backdrop = (el: Element): string => {
    let node: Element | null = el;
    while (node) {
      const color = window.getComputedStyle(node).backgroundColor;
      if (color && color !== 'transparent' && !color.startsWith('rgba(0, 0, 0, 0)')) return color;
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };

  const screenReaderOnly = (rect: DOMRect, style: CSSStyleDeclaration): boolean => {
    if (rect.width > 2 || rect.height > 2) return false;
    return style.clip !== 'auto' || style.clipPath !== 'none' || style.position === 'absolute';
  };

  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.getAttribute('aria-hidden') === 'true') continue;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;

    const scrollsY = el.scrollHeight > el.clientHeight + config.scrollSlack && (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.clientHeight > config.minRegionSize;
    const scrollsX = el.scrollWidth > el.clientWidth + config.scrollSlack && (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.clientWidth > config.minRegionSize;
    if (scrollsY || scrollsX) {
      const shown = scrollsY ? el.clientHeight / el.scrollHeight : el.clientWidth / el.scrollWidth;
      const hiddenFraction = Math.round((1 - shown) * 100);
      if (hiddenFraction >= config.minHiddenFraction * 100) {
        if (regions.length < config.maxRegions) regions.push({ label: label(el), hiddenPercent: hiddenFraction, axis: scrollsY ? 'vertical' : 'horizontal' });
        else moreRegions++;
      }
    }

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const isInteractive = el.matches(config.interactiveSelector);
    if (text.length < config.minTextLength && !isInteractive) continue;
    if (el.querySelector(config.interactiveSelector) && !isInteractive) continue;
    if (!perceivable(el, style)) continue;

    const rect = el.getBoundingClientRect();
    if (screenReaderOnly(rect, style)) continue;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    let reason = '';

    if (rect.width < 1 || rect.height < 1) reason = 'occupies no space on the page';
    if (!reason && (rect.right + scrollX < 0 || rect.bottom + scrollY < 0 || rect.left + scrollX > docWidth || rect.top + scrollY > docHeight)) reason = 'positioned outside the page, where no scrolling reaches it';

    if (!reason && text && style.color === backdrop(el)) reason = `drawn in ${style.color}, the same colour as what is behind it`;

    if (!reason && rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth) {
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) reason = `covered by ${label(top)}`;
    }

    if (!reason) continue;
    if (unseen.length >= config.maxUnseen) {
      moreUnseen++;
      continue;
    }
    unseen.push({ label: label(el), reason });
  }

  return { regions, unseen, moreRegions, moreUnseen };
}

export interface VisibilityRegion {
  label: string;
  hiddenPercent: number;
  axis: 'vertical' | 'horizontal';
}

export interface UnseenElement {
  label: string;
  reason: string;
}

export interface VisibilityReport {
  regions: VisibilityRegion[];
  unseen: UnseenElement[];
  moreRegions: number;
  moreUnseen: number;
}

interface ProbeConfig {
  maxRegions: number;
  maxUnseen: number;
  scrollSlack: number;
  minRegionSize: number;
  minHiddenFraction: number;
  minTextLength: number;
  maxLabelLength: number;
  interactiveSelector: string;
}
