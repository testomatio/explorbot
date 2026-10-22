import { HTML_SELECTORS, HTML_VISIBILITY_LIMITS } from './html.ts';

export const UX_FOCUS_ATTR = 'data-explorbot-ux';

const UX_LIMITS = {
  touchTarget: 44,
  pointerTarget: 24,
  touchWidth: 1024,
  targetGap: 8,
  minFontSize: 12,
  minLineHeight: 1.3,
  maxEntries: 8,
  minOpacity: HTML_VISIBILITY_LIMITS.minOpacity,
};

export function uxProbeArgs(scope: string): UxProbeArgs {
  return { scope, controlsSelector: HTML_SELECTORS.interactiveControl, limits: UX_LIMITS };
}

export function renderUxMeasurements(measurements: UxMeasurements): string {
  const lines = [`viewport: ${measurements.width}px wide`];
  for (const [check, entries] of Object.entries(measurements.checks)) {
    if (!entries.length) continue;
    lines.push(`${check}:`, ...entries.map((entry) => `  - ${entry}`));
  }
  if (lines.length === 1) lines.push('no measurable problems');
  return lines.join('\n');
}

// Passed to page.evaluate as a function — must stay self-contained with no outer-scope references.
export function measureUx({ scope, controlsSelector, limits }: UxProbeArgs): UxMeasurements {
  const root = document.querySelector(scope) || document.body;
  const width = window.innerWidth;
  const touch = width <= limits.touchWidth;
  const visibleWidth = document.documentElement.clientWidth;
  const checks: Record<string, string[]> = {
    'horizontal overflow': [],
    'zoom and viewport meta': [],
    'small targets': [],
    'crowded targets': [],
    'placeholder-only labels': [],
    'small text': [],
    'cramped line-height': [],
    'truncated text without full text': [],
    'layout-property transitions': [],
  };

  const add = (check: string, entry: string) => {
    if (checks[check].length >= limits.maxEntries) return;
    if (checks[check].includes(entry)) return;
    checks[check].push(entry);
  };

  const describe = (el: Element) => {
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ');
    if (!name) return `${role} (unnamed)`;
    return `${role} "${name.slice(0, 40)}"`;
  };

  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > limits.minOpacity;
  };

  if (root === document.body || root.matches('main, [role="main"]')) {
    const docWidth = document.documentElement.scrollWidth;
    if (docWidth > visibleWidth + 1) add('horizontal overflow', `page is ${docWidth}px wide in a ${visibleWidth}px visible area`);

    const meta = document.querySelector('meta[name="viewport"]')?.getAttribute('content');
    if (!meta) add('zoom and viewport meta', 'no viewport meta tag');
    const metaRules = (meta || '').toLowerCase().replace(/\s/g, '');
    if (metaRules.includes('user-scalable=no') || metaRules.includes('user-scalable=0')) add('zoom and viewport meta', 'zoom disabled by user-scalable');
    const maxScale = metaRules.split(',').find((part) => part.startsWith('maximum-scale='));
    if (maxScale && Number(maxScale.split('=')[1]) <= 1) add('zoom and viewport meta', `zoom capped by ${maxScale}`);
  }

  const minTarget = touch ? limits.touchTarget : limits.pointerTarget;
  const controls = Array.from(root.querySelectorAll(controlsSelector)).filter(visible);
  const boxes = controls.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  for (const { el, rect } of boxes) {
    if (el.tagName === 'A' && window.getComputedStyle(el).display === 'inline') continue;
    if (rect.width >= minTarget && rect.height >= minTarget) continue;
    add('small targets', `${describe(el)} is ${Math.round(rect.width)}×${Math.round(rect.height)}px, below ${minTarget}px`);
  }

  if (touch) {
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const gapX = Math.max(b.rect.left - a.rect.right, a.rect.left - b.rect.right);
        const gapY = Math.max(b.rect.top - a.rect.bottom, a.rect.top - b.rect.bottom);
        const gap = Math.max(gapX, gapY);
        if (gap >= limits.targetGap) continue;
        if (a.rect.height >= limits.touchTarget && b.rect.height >= limits.touchTarget && a.rect.width >= limits.touchTarget && b.rect.width >= limits.touchTarget) continue;
        add('crowded targets', `${describe(a.el)} and ${describe(b.el)} are ${Math.max(0, Math.round(gap))}px apart`);
      }
    }
  }

  for (const el of Array.from(root.querySelectorAll('input[placeholder], textarea[placeholder]'))) {
    if (!visible(el)) continue;
    if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title')) continue;
    if ((el as HTMLInputElement).labels?.length) continue;
    add('placeholder-only labels', describe(el));
  }

  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!visible(el)) continue;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);

    const overflows = rect.right > visibleWidth + 1 && rect.left < visibleWidth;
    if (overflows && !(el.parentElement && el.parentElement.getBoundingClientRect().right > visibleWidth + 1)) add('horizontal overflow', `${describe(el)} ends at ${Math.round(rect.right)}px`);

    const animated = style.transitionProperty.split(',').map((property) => property.trim());
    const layout = animated.filter((property) => ['width', 'height', 'top', 'left', 'right', 'bottom', 'margin', 'padding'].includes(property));
    const transitions = style.transitionDuration.split(',').some((duration) => Number.parseFloat(duration) > 0);
    if (transitions && layout.length) add('layout-property transitions', `${describe(el)} transitions ${layout.join(', ')}`);

    const ownText = Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join('')
      .trim();
    if (!ownText) continue;

    const fontSize = Number.parseFloat(style.fontSize);
    if (fontSize < limits.minFontSize) add('small text', `"${ownText.slice(0, 40)}" at ${fontSize}px`);

    const lineHeight = Number.parseFloat(style.lineHeight);
    const multiline = rect.height > fontSize * 2.5;
    if (multiline && lineHeight && lineHeight / fontSize < limits.minLineHeight) add('cramped line-height', `"${ownText.slice(0, 40)}" at ${(lineHeight / fontSize).toFixed(2)}`);

    const htmlEl = el as HTMLElement;
    if (style.textOverflow === 'ellipsis' && htmlEl.scrollWidth > htmlEl.clientWidth && !el.getAttribute('title')) add('truncated text without full text', `"${ownText.slice(0, 40)}"`);
  }

  return { width, checks };
}

export function countRunningAnimations(scope: string): number {
  const root = document.querySelector(scope) || document.body;
  return document.getAnimations().filter((animation) => {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    return animation.playState === 'running' && target && root.contains(target);
  }).length;
}

interface UxProbeArgs {
  scope: string;
  controlsSelector: string;
  limits: typeof UX_LIMITS;
}

export interface UxMeasurements {
  width: number;
  checks: Record<string, string[]>;
}
