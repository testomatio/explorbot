import type { WebPageState } from '../../../src/state-manager.ts';
import { parseResearchSections, type ResearchElement } from '../../../src/ai/researcher/parser.ts';

const OPEN_API_TAG_SELECTOR_PATTERN = /api-\d+\/tag\/([a-z0-9-]+)(?:["'#/\]\s]|$)/i;
const OPEN_API_NAVIGATION_SECTION_KEYWORDS = ['navigation', 'menu'];

export function extractResearchNavigationTargets(state: WebPageState, research: string): string[] {
  const currentUrl = state.url || '/';
  const sections = parseResearchSections(research);
  const targets: string[] = [];
  const seen = new Set<string>();

  for (const section of sections) {
    const sectionName = section.name.toLowerCase();
    if (!OPEN_API_NAVIGATION_SECTION_KEYWORDS.some((keyword) => sectionName.includes(keyword))) {
      continue;
    }

    for (const element of section.elements) {
      const target = extractNavigationTarget(currentUrl, element);
      if (!target || seen.has(target)) {
        continue;
      }

      seen.add(target);
      targets.push(target);
    }
  }

  return targets;
}

function extractNavigationTarget(currentUrl: string, element: ResearchElement): string | null {
  const openApiTagFromCss = extractOpenApiTagHashFromCss(element.css);
  if (openApiTagFromCss) {
    return buildSamePageHashTarget(currentUrl, openApiTagFromCss);
  }

  if (!currentUrl.includes('#tag/')) {
    return null;
  }

  const inferredOpenApiTag = inferOpenApiTagSlugFromLabel(element.name);
  if (!inferredOpenApiTag) {
    return null;
  }

  return buildSamePageHashTarget(currentUrl, `tag/${inferredOpenApiTag}`);
}

function extractOpenApiTagHashFromCss(css: string | null): string | null {
  if (!css) {
    return null;
  }

  const normalizedSelector = css.replaceAll('\\/', '/');
  const match = normalizedSelector.match(OPEN_API_TAG_SELECTOR_PATTERN);
  if (!match?.[1]) {
    return null;
  }

  return `tag/${match[1].toLowerCase()}`;
}

function inferOpenApiTagSlugFromLabel(name: string): string | null {
  const cleanedLabel = name
    .replace(/^'+|'+$/g, '')
    .replace(/\(expanded\)|\(collapsed\)|open group|close group|show more/gi, '')
    .trim();

  if (!cleanedLabel.includes('/')) {
    return null;
  }

  const slug = cleanedLabel
    .split('/')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return slug || null;
}

function buildSamePageHashTarget(currentUrl: string, hashPath: string): string {
  const [baseWithSearch] = currentUrl.split('#');
  return `${baseWithSearch}#${hashPath}`;
}
