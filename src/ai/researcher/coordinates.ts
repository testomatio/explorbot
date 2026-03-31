import dedent from 'dedent';
import type { Page } from 'playwright';
import type { ActionResult } from '../../action-result.js';
import type Explorer from '../../explorer.ts';
import { tag } from '../../utils/logger.js';
import { mdq } from '../../utils/markdown-query.ts';
import { WebElement } from '../../utils/web-element.ts';
import type { Provider } from '../provider.js';
import { type Constructor, debugLog } from './mixin.ts';
import { parseResearchSections } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

export async function visuallyAnnotateContainers(page: Page, containers: Array<{ css: string; label: string }>): Promise<number> {
  return page.evaluate((ctrs: Array<{ css: string; label: string }>) => {
    const containerColors = ['#9b59b6', '#16a085', '#c0392b', '#2980b9'];
    const drawnContainers: Array<{ label: string; color: string }> = [];
    for (let i = 0; i < ctrs.length; i++) {
      let el: Element | null;
      try {
        el = document.querySelector(ctrs[i].css);
      } catch {
        continue;
      }
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const color = containerColors[i % containerColors.length];
      const box = document.createElement('div');
      box.setAttribute('data-explorbot-annotation', 'true');
      box.style.cssText = `position:absolute;left:${rect.left + window.scrollX}px;top:${rect.top + window.scrollY}px;width:${rect.width}px;height:${rect.height}px;border:1px dashed ${color};z-index:99998;pointer-events:none;`;
      document.body.appendChild(box);
      drawnContainers.push({ label: ctrs[i].label, color });
    }

    if (drawnContainers.length > 0) {
      const legend = document.createElement('div');
      legend.setAttribute('data-explorbot-annotation', 'true');
      legend.style.cssText = 'position:fixed;right:10px;bottom:10px;background:white;color:black;font-size:14px;font-family:sans-serif;padding:10px 14px;z-index:100001;pointer-events:none;border:3px solid #e63946;border-radius:6px;line-height:22px;';
      const title = '<div style="font-weight:bold;margin-bottom:4px;color:#e63946;">Legend</div>';
      const items = drawnContainers.map((c) => `<div><span style="display:inline-block;width:24px;border-top:3px dashed ${c.color};margin-right:8px;vertical-align:middle;"></span>${c.label}</div>`).join('');
      legend.innerHTML = title + items;
      document.body.appendChild(legend);
    }

    const colors = ['#e63946', '#2a9d8f', '#e9c46a', '#264653', '#f4a261', '#7b2cbf', '#0077b6', '#d62828'];
    const elements = document.querySelectorAll('[data-explorbot-eidx]');
    let count = 0;
    for (const el of elements) {
      const eidx = el.getAttribute('data-explorbot-eidx');
      if (!eidx) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      const color = colors[count % colors.length];

      const box = document.createElement('div');
      box.setAttribute('data-explorbot-annotation', 'true');
      box.style.cssText = `position:absolute;left:${rect.left + window.scrollX}px;top:${rect.top + window.scrollY}px;width:${rect.width}px;height:${rect.height}px;border:2px solid ${color};z-index:99999;pointer-events:none;`;

      const label = document.createElement('div');
      label.textContent = eidx;
      label.style.cssText = `position:absolute;top:-14px;right:-2px;background:${color};color:white;font-size:10px;padding:0 3px;line-height:14px;font-family:monospace;z-index:100000;pointer-events:none;`;
      box.appendChild(label);

      document.body.appendChild(box);
      count++;
    }
    return count;
  }, containers);
}

export function WithCoordinates<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;
    declare provider: Provider;
    declare actionResult: ActionResult | undefined;

    analyzeScreenshotForVisualProps(): Promise<VisualAnalysisResult> {
      return this._analyzeScreenshotForVisualProps();
    }

    async visuallyAnnotateElements(opts?: { containers?: Array<{ css: string; label: string }> }): Promise<number> {
      return visuallyAnnotateContainers(this.explorer.playwrightHelper.page, opts?.containers || []);
    }

    private async _analyzeScreenshotForVisualProps(): Promise<VisualAnalysisResult> {
      const elements = new Map<number, { coordinates: string | null; color: string | null; icon: string | null }>();
      const emptyResult: VisualAnalysisResult = { elements, pagePurpose: null, primaryActions: null, focusedSection: null };
      if (!this.actionResult) return emptyResult;

      const image = this.actionResult.screenshot;
      if (!image) return emptyResult;
      tag('step').log('Analyzing annotated screenshot for visual properties');

      const prompt = dedent`
        This screenshot has two types of annotations:
        - **Section containers**: dashed bordered boxes (no labels on them). A legend at the bottom-left maps dashed line colors to section names. Ignore containers for this task.
        - **Interactive elements**: solid bordered boxes with eidx numbers in the top-right corner above the box. Adjacent elements use different colors.

        For each interactive element (solid border, eidx number), report:
        | eidx | Coordinates | Color | Icon |

        Column definitions:
        - eidx: the number shown in the colored label above the top-right corner of each solid-bordered box
        - Coordinates: (X, Y) center point of the element
        - Color: accent color if distinctive (red, green, blue, orange, yellow, purple, gray), otherwise -
        - Icon: one-word icon description (plus, x, trash, pencil, gear, search, hamburger, ellipsis, chevron, star, check, filter), otherwise -

        Ignore the legend block and dashed container borders.

        Then add:

        ## Page Purpose
        One sentence: what this page is for from the user's perspective.

        ## Primary Actions
        List 3-5 most prominent interactive elements (accent buttons, CTAs, main form actions).
        Format: - eidx N: action description

        ## Focused Section
        Which section from the legend appears to be the user's primary focus area?
        Look for: modal overlays, drawers, panels with shadows or elevated z-index, highlighted/active areas.
        If a dialog or overlay is visible, that is the focused section.
        Otherwise, pick the section with the most prominent interactive content.
        Reply with the exact section name from the legend. If no legend is shown, reply with "-".
      `;

      try {
        const aiResult = await this.provider.processImage(prompt, image.toString('base64'));
        const text = aiResult.text || '';
        const rows = mdq(text).query('table').toJson();
        for (const row of rows) {
          const eidx = Number.parseInt(row.eidx, 10);
          if (Number.isNaN(eidx)) continue;
          const val = (v: string) => (v && v !== '-' ? v : null);
          elements.set(eidx, {
            coordinates: val(row.Coordinates),
            color: val(row.Color),
            icon: val(row.Icon),
          });
        }

        const pagePurposeSection = mdq(text).query('section2("Page Purpose")').text().trim();
        const primaryActionsSection = mdq(text).query('section2("Primary Actions")').text().trim();
        const focusedSectionRaw = mdq(text).query('section2("Focused Section")').text().trim();
        const focusedSection = focusedSectionRaw && focusedSectionRaw !== '-' ? focusedSectionRaw.split('\n')[0].trim() : null;

        debugLog(`Parsed visual props for ${elements.size} elements`);
        return {
          elements,
          pagePurpose: pagePurposeSection || null,
          primaryActions: primaryActionsSection
            ? primaryActionsSection
                .split('\n')
                .filter((l) => l.trim().startsWith('-'))
                .map((l) => l.trim())
            : null,
          focusedSection,
        };
      } catch (err) {
        debugLog(`Screenshot visual analysis failed: ${err instanceof Error ? err.message : err}`);
      }

      debugLog(`Parsed visual props for ${elements.size} elements`);
      return emptyResult;
    }

    async mergeVisualData(result: ResearchResult, visualData: Map<number, { coordinates: string | null; color: string | null; icon: string | null }>): Promise<void> {
      const sections = parseResearchSections(result.text);
      let merged = 0;

      for (const section of sections) {
        let sectionMerged = false;
        for (const el of section.elements) {
          let eidx = el.eidx || null;
          if (!eidx) {
            const locator = el.css || el.xpath || (el.aria ? `role=${el.aria.role}[name="${el.aria.text}"]` : null);
            if (locator) eidx = await this.explorer.getEidxByLocator(locator, section.containerCss);
          }
          if (!eidx) continue;

          const vis = visualData.get(eidx);
          if (!vis) continue;
          Object.assign(el, Object.fromEntries(Object.entries(vis).filter(([, v]) => v)));
          sectionMerged = true;
          merged++;
        }
        if (sectionMerged) result.rebuildSectionInText(section);
      }
      debugLog(`Merged visual props for ${merged} elements`);
    }

    async backfillCoordinates(result: ResearchResult): Promise<void> {
      const page = this.explorer.playwrightHelper.page;
      const sections = parseResearchSections(result.text);
      const eidxWithoutCoords: number[] = [];
      for (const section of sections) {
        for (const el of section.elements) {
          if (el.eidx && !el.coordinates) eidxWithoutCoords.push(el.eidx);
        }
      }
      if (eidxWithoutCoords.length === 0) return;

      const webElements = await WebElement.fromEidxList(page, eidxWithoutCoords);
      if (webElements.length === 0) return;

      const rectMap = new Map(webElements.map((w) => [w.eidx!, w]));
      for (const section of sections) {
        let changed = false;
        for (const el of section.elements) {
          if (el.eidx && !el.coordinates) {
            const w = rectMap.get(el.eidx);
            if (w) {
              el.coordinates = w.coordinates;
              changed = true;
            }
          }
        }
        if (changed) result.rebuildSectionInText(section);
      }
    }
  };
}

export interface VisualAnalysisResult {
  elements: Map<number, { coordinates: string | null; color: string | null; icon: string | null }>;
  pagePurpose: string | null;
  primaryActions: string[] | null;
  focusedSection: string | null;
}

export interface CoordinateMethods {
  analyzeScreenshotForVisualProps(): Promise<VisualAnalysisResult>;
  mergeVisualData(result: ResearchResult, visualData: Map<number, { coordinates: string | null; color: string | null; icon: string | null }>): Promise<void>;
  backfillCoordinates(result: ResearchResult): Promise<void>;
  visuallyAnnotateElements(opts?: { containers?: Array<{ css: string; label: string }> }): Promise<number>;
}
