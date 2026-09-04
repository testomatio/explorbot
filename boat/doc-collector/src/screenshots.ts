import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { removeVisualAnnotations } from '../../../src/ai/researcher/coordinates.ts';
import { parseResearchSections } from '../../../src/ai/researcher/parser.ts';
import { parseAriaLocator } from '../../../src/utils/aria.ts';
import type Explorer from '../../../src/explorer.ts';
import { type WebPageState, normalizeUrl } from '../../../src/state-manager.ts';
import { safeFilename, sanitizeFilename } from '../../../src/utils/strings.ts';
import type { PageDocumentation } from './ai/documentarian.ts';
import type { DocStateTransition } from './ai/tools.ts';
import type { DocbotConfig } from './config.ts';
import { addPadding, captureInteractionAfter, captureInteractionBefore, regionAround, saveRegion } from './interaction-screenshots.ts';

const DEFAULT_MAX_SECTION_SCREENSHOTS = 8;
const EVIDENCE_PADDING = 250;

export async function captureDocumentationScreenshots(explorer: Explorer, state: WebPageState, research: string, options: DocumentationScreenshotOptions): Promise<DocumentationScreenshot[]> {
  const page = explorer.page;
  if (!page) {
    return [];
  }

  await dismissTransientOverlay(page);
  await removeVisualAnnotations(page);
  mkdirSync(options.screenshotsDir, { recursive: true });

  const screenshots: DocumentationScreenshot[] = [];
  const pageName = sanitizeFilename(state.url || 'page') || 'page';
  const fullPage = await captureFullPageScreenshot(page, pageName, options);
  if (fullPage) {
    screenshots.push(fullPage);
  }

  const maxSections = getMaxSectionScreenshots(options.config);
  for (const section of getScreenshotSections(research).slice(0, maxSections)) {
    const screenshot = await captureSectionScreenshot(page, pageName, section, options);
    if (!screenshot) {
      continue;
    }
    screenshots.push(screenshot);
  }

  return screenshots;
}

export async function captureEvidenceScreenshots(explorer: Explorer, state: WebPageState, documentation: PageDocumentation, options: DocumentationScreenshotOptions): Promise<Array<DocumentationScreenshot | null>> {
  const page = explorer.page;
  if (!page) {
    return documentation.can.map(() => null);
  }

  await dismissTransientOverlay(page);
  await removeVisualAnnotations(page);
  if (!isOnDocumentedPage(page, state)) {
    return documentation.can.map(() => null);
  }
  mkdirSync(options.screenshotsDir, { recursive: true });
  const pageName = sanitizeFilename(state.url || 'page') || 'page';
  const shots: Array<DocumentationScreenshot | null> = [];
  for (const [index, item] of documentation.can.entries()) {
    shots.push(await captureEvidenceScreenshot(page, pageName, index, item, options));
  }
  return shots;
}

async function captureEvidenceScreenshot(page: any, pageName: string, index: number, item: { action: string; element?: string | null }, options: DocumentationScreenshotOptions): Promise<DocumentationScreenshot | null> {
  if (!item.element) return null;
  const element = resolveResearchLocator(item.element, options.research);
  if (!element) return null;
  const locatorInfo = parseAriaLocator(element);
  try {
    const locator = resolveEvidenceLocator(page, element, locatorInfo);
    if ((await locator.count()) !== 1) return null;
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 });
    const box = await locator.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) return null;
    const image = await page.screenshot();
    const png = PNG.sync.read(image);
    const region = regionAround(png, box, await page.viewportSize(), EVIDENCE_PADDING);
    const filePath = path.join(options.screenshotsDir, safeFilename(`${pageName}_can_${index + 1}`, '.png'));
    saveRegion(png, region, filePath);
    return {
      title: item.action,
      path: filePath,
      relativePath: toMarkdownPath(options.pageFilePath, filePath),
      kind: 'evidence',
    };
  } catch {
    return null;
  }
}

function resolveResearchLocator(requested: string, research?: string): string | null {
  if (!research) return requested;
  const requestedAria = parseAriaLocator(requested);
  const requestedCss = unwrapLocator(requested);
  for (const section of parseResearchSections(research)) {
    for (const element of section.elements) {
      if (requestedAria && element.aria?.role === requestedAria.role && element.aria.text === requestedAria.text) {
        return `{ role: '${element.aria.role}', text: '${element.aria.text}' }`;
      }
      if (element.css && requestedCss === unwrapLocator(element.css)) return element.css;
    }
  }
  return null;
}

function unwrapLocator(locator: string): string {
  const trimmed = locator.trim();
  const first = trimmed.at(0);
  const last = trimmed.at(-1);
  if (first === last && (first === '`' || first === '"' || first === "'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isOnDocumentedPage(page: any, state: WebPageState): boolean {
  try {
    const current = new URL(page.url());
    const expected = new URL(state.url || '', current.origin);
    return current.origin === expected.origin && normalizeUrl(current.href) === normalizeUrl(expected.href);
  } catch {
    return false;
  }
}

function resolveEvidenceLocator(page: any, element: string, locatorInfo: { role: string; text: string } | null): any {
  if (locatorInfo?.text) {
    return page.getByRole(locatorInfo.role, { name: locatorInfo.text, exact: true });
  }
  return page.locator(element);
}

async function dismissTransientOverlay(page: any): Promise<void> {
  try {
    await page.keyboard.press('Escape');
  } catch {}
}

export function getScreenshotSections(research: string): ScreenshotSection[] {
  const sections: ScreenshotSection[] = [];
  const seen = new Set<string>();

  for (const section of parseResearchSections(research)) {
    if (!section.containerCss) {
      continue;
    }
    if (section.elements.length === 0) {
      continue;
    }
    if (seen.has(section.containerCss)) {
      continue;
    }
    seen.add(section.containerCss);
    sections.push({
      title: section.name,
      selector: section.containerCss,
    });
  }

  return sections;
}

export async function captureInteractionScreenshot(explorer: Explorer, beforeScreenshot: Buffer | null, state: WebPageState, transition: DocStateTransition, options: DocumentationScreenshotOptions): Promise<DocumentationScreenshot | null> {
  const page = explorer.page;
  if (!page) {
    return null;
  }

  mkdirSync(options.screenshotsDir, { recursive: true });
  const pageName = sanitizeFilename(state.url || 'page') || 'page';
  const stateName = sanitizeFilename(transition.targetState?.label || transition.action) || 'state';
  const stateId = state.id ? `_${state.id}` : '';
  const filePath = path.join(options.screenshotsDir, safeFilename(`${pageName}_${stateName}${stateId}`, '.png'));
  const result = await captureInteractionAfter(page, beforeScreenshot, filePath, transition.changes?.urlChanged !== true);
  if (result === 'unchanged') return null;
  if (result === 'failed' && !(await captureViewport(page, filePath))) return null;

  return {
    title: transition.targetState?.label || transition.action,
    path: filePath,
    relativePath: toMarkdownPath(options.pageFilePath, filePath),
    kind: 'state',
  };
}

export async function captureBeforeInteraction(explorer: Explorer): Promise<Buffer | null> {
  const page = explorer.page;
  if (!page) return null;
  return captureInteractionBefore(page);
}

async function captureViewport(page: any, filePath: string): Promise<boolean> {
  try {
    await page.screenshot({ path: filePath });
    return true;
  } catch {
    return false;
  }
}

async function captureFullPageScreenshot(page: any, pageName: string, options: DocumentationScreenshotOptions): Promise<DocumentationScreenshot | null> {
  const filePath = path.join(options.screenshotsDir, safeFilename(`${pageName}_page`, '.png'));
  try {
    await page.screenshot({ path: filePath, fullPage: true });
  } catch {
    return null;
  }

  return {
    title: 'Page screenshot',
    path: filePath,
    relativePath: toMarkdownPath(options.pageFilePath, filePath),
    kind: 'page',
  };
}

async function captureSectionScreenshot(page: any, pageName: string, section: ScreenshotSection, options: DocumentationScreenshotOptions): Promise<DocumentationScreenshot | null> {
  const sectionName = sanitizeFilename(section.title) || 'section';
  const filePath = path.join(options.screenshotsDir, safeFilename(`${pageName}_${sectionName}`, '.png'));

  try {
    await page.locator(section.selector).first().screenshot({ path: filePath });
  } catch {
    return null;
  }

  return {
    title: section.title,
    path: filePath,
    relativePath: toMarkdownPath(options.pageFilePath, filePath),
    kind: 'section',
    selector: section.selector,
  };
}

function getMaxSectionScreenshots(config: DocbotConfig): number {
  const configured = config.docs?.maxSectionScreenshots;
  if (configured && configured > 0) {
    return configured;
  }
  return DEFAULT_MAX_SECTION_SCREENSHOTS;
}

function toMarkdownPath(pageFilePath: string, assetPath: string): string {
  return path.relative(path.dirname(pageFilePath), assetPath).replaceAll('\\', '/');
}

export interface DocumentationScreenshot {
  title: string;
  path: string;
  relativePath: string;
  kind: 'page' | 'section' | 'state' | 'evidence';
  selector?: string;
}

interface DocumentationScreenshotOptions {
  pageFilePath: string;
  screenshotsDir: string;
  config: DocbotConfig;
  research?: string;
}

interface ScreenshotSection {
  title: string;
  selector: string;
}
