import type { Page } from 'playwright';
import type { WebPageState } from '../../../src/state-manager.ts';
import { collectInteractiveNodes, detectFocusArea } from '../../../src/utils/aria.ts';
import { htmlDiff } from '../../../src/utils/html-diff.ts';

const TARGET_ATTRIBUTE = 'data-docbot-change-target';
const REGION_PADDING = 16;

export async function captureInteractionStateScreenshot(page: Page, beforeState: WebPageState, state: WebPageState, filePath: string): Promise<boolean> {
  await removeVisualAnnotations(page);
  if (await captureNewFocusArea(page, beforeState, state, filePath)) return true;

  const selectors = await getChangedDomSelectors(beforeState, state);
  try {
    if (selectors.length === 1) return await captureChangedContainer(page, selectors[0], filePath);
    await markChangedElements(page, beforeState, state, selectors);
    return await captureMarkedRegion(page, filePath);
  } catch {
    return false;
  } finally {
    await clearChangeMarkers(page);
  }
}

async function removeVisualAnnotations(page: Page): Promise<void> {
  try {
    await page.locator('[data-explorbot-annotation]').evaluateAll((elements) => {
      for (const element of elements) element.remove();
    });
  } catch {}
}

async function captureNewFocusArea(page: Page, beforeState: WebPageState, state: WebPageState, filePath: string): Promise<boolean> {
  const before = detectFocusArea(beforeState.ariaSnapshot || null);
  const after = detectFocusArea(state.ariaSnapshot || null);
  if (!after.detected || (before.detected && before.type === after.type && before.name === after.name)) return false;

  try {
    await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible, [aria-modal="true"]:visible').last().screenshot({ path: filePath });
    return true;
  } catch {
    return false;
  }
}

async function getChangedDomSelectors(beforeState: WebPageState, state: WebPageState): Promise<string[]> {
  if (!beforeState.html || !state.html) return [];

  try {
    const [added, removed] = await Promise.all([htmlDiff(beforeState.html, state.html, undefined, { includeTextChanges: true }), htmlDiff(state.html, beforeState.html, undefined, { includeTextChanges: true })]);
    return [...new Set([...added.parts, ...removed.parts].map((part) => part.container).filter((selector) => selector !== 'body' && selector !== 'html'))];
  } catch {
    return [];
  }
}

async function captureChangedContainer(page: Page, selector: string, filePath: string): Promise<boolean> {
  const locator = page.locator(selector).first();
  const isDocumentRoot = await locator.evaluate((element) => {
    const visibleContent = [...document.body.children].filter((child) => {
      if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(child.tagName)) return false;
      if (child.hasAttribute('data-explorbot-annotation')) return false;
      const box = child.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    return visibleContent.length === 1 && visibleContent[0] === element;
  });
  if (isDocumentRoot) return false;

  await locator.screenshot({ path: filePath });
  return true;
}

async function markChangedElements(page: Page, beforeState: WebPageState, state: WebPageState, selectors: string[]): Promise<void> {
  for (const node of getChangedAriaNodes(beforeState.ariaSnapshot || null, state.ariaSnapshot || null)) {
    if (!node.name) continue;
    try {
      const locators = await page.getByRole(node.role, { name: node.name, exact: true }).all();
      if (locators.length !== 1) continue;
      await locators[0].evaluate((element, attribute) => element.setAttribute(attribute, 'true'), TARGET_ATTRIBUTE);
    } catch {}
  }

  for (const selector of selectors) {
    try {
      await page.locator(selector).first().evaluate((element, attribute) => element.setAttribute(attribute, 'true'), TARGET_ATTRIBUTE);
    } catch {}
  }
}

async function captureMarkedRegion(page: Page, filePath: string): Promise<boolean> {
  const clip = await page.evaluate(
    ({ targetAttribute, padding }) => {
      const elements = [...document.querySelectorAll(`[${targetAttribute}]`)];
      if (elements.length === 0) return null;

      let region: Element | null = elements[0];
      while (region && !elements.every((element) => region?.contains(element))) region = region.parentElement;
      if (!region || region === document.body || region === document.documentElement) return null;

      const boxes = elements.map((element) => element.getBoundingClientRect()).filter((box) => box.width > 0 && box.height > 0);
      if (boxes.length === 0) return null;
      const left = Math.max(0, Math.min(...boxes.map((box) => box.left)) + window.scrollX - padding);
      const top = Math.max(0, Math.min(...boxes.map((box) => box.top)) + window.scrollY - padding);
      const right = Math.min(document.documentElement.scrollWidth, Math.max(...boxes.map((box) => box.right)) + window.scrollX + padding);
      const bottom = Math.min(document.documentElement.scrollHeight, Math.max(...boxes.map((box) => box.bottom)) + window.scrollY + padding);
      return { x: left, y: top, width: right - left, height: bottom - top };
    },
    { targetAttribute: TARGET_ATTRIBUTE, padding: REGION_PADDING }
  );
  if (!clip || clip.width < 1 || clip.height < 1) return false;

  await page.screenshot({ path: filePath, clip });
  return true;
}

async function clearChangeMarkers(page: Page): Promise<void> {
  try {
    await page.evaluate((targetAttribute) => {
      for (const element of document.querySelectorAll(`[${targetAttribute}]`)) element.removeAttribute(targetAttribute);
    }, TARGET_ATTRIBUTE);
  } catch {}
}

function getChangedAriaNodes(before: string | null, after: string | null): AriaTarget[] {
  const remaining = collectInteractiveNodes(before).map((node) => JSON.stringify(node));
  const changed: AriaTarget[] = [];

  for (const node of collectInteractiveNodes(after)) {
    const serialized = JSON.stringify(node);
    const match = remaining.indexOf(serialized);
    if (match >= 0) {
      remaining.splice(match, 1);
      continue;
    }
    if (typeof node.role !== 'string') continue;
    changed.push({ role: node.role as AriaTarget['role'], name: typeof node.name === 'string' ? node.name : '' });
  }
  return changed;
}

interface AriaTarget {
  role: Parameters<Page['getByRole']>[0];
  name: string;
}
