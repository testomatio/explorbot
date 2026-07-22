import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseResearchSections } from '../../../src/ai/researcher/parser.ts';
import type Explorer from '../../../src/explorer.ts';
import type { WebPageState } from '../../../src/state-manager.ts';
import { safeFilename, sanitizeFilename } from '../../../src/utils/strings.ts';
import type { DocStateTransition } from './ai/tools.ts';
import type { DocbotConfig } from './config.ts';
import { captureInteractionStateScreenshot } from './interaction-screenshots.ts';

const DEFAULT_MAX_SECTION_SCREENSHOTS = 8;

export async function captureDocumentationScreenshots(explorer: Explorer, state: WebPageState, research: string, options: DocumentationScreenshotOptions): Promise<DocumentationScreenshot[]> {
  const page = explorer.page;
  if (!page) {
    return [];
  }

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

export async function captureInteractionScreenshot(explorer: Explorer, beforeState: WebPageState, state: WebPageState, transition: DocStateTransition, options: DocumentationScreenshotOptions): Promise<DocumentationScreenshot | null> {
  const page = explorer.page;
  if (!page) {
    return null;
  }

  mkdirSync(options.screenshotsDir, { recursive: true });
  const pageName = sanitizeFilename(state.url || 'page') || 'page';
  const stateName = sanitizeFilename(transition.targetState?.label || transition.action) || 'state';
  const stateId = state.id ? `_${state.id}` : '';
  const filePath = path.join(options.screenshotsDir, safeFilename(`${pageName}_${stateName}${stateId}`, '.png'));
  let captured = await captureInteractionStateScreenshot(page, beforeState, state, filePath);
  if (!captured) captured = await captureViewport(page, filePath);
  if (!captured) return null;

  return {
    title: transition.targetState?.label || transition.action,
    path: filePath,
    relativePath: toMarkdownPath(options.pageFilePath, filePath),
    kind: 'state',
  };
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
  kind: 'page' | 'section' | 'state';
  selector?: string;
}

interface DocumentationScreenshotOptions {
  pageFilePath: string;
  screenshotsDir: string;
  config: DocbotConfig;
}

interface ScreenshotSection {
  title: string;
  selector: string;
}
