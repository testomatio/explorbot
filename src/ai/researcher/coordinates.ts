import dedent from 'dedent';
import type { ActionResult } from '../../action-result.js';
import type Explorer from '../../explorer.ts';
import { tag } from '../../utils/logger.js';
import { mdq } from '../../utils/markdown-query.ts';
import { WebElement } from '../../utils/web-element.ts';
import type { Provider } from '../provider.js';
import { type Constructor, debugLog } from './mixin.ts';
import { parseResearchSections } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

export function WithCoordinates<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;
    declare provider: Provider;
    declare actionResult: ActionResult | undefined;

    analyzeScreenshotForVisualProps(): Promise<Map<number, { coordinates: string | null; color: string | null; icon: string | null }>> {
      return this._analyzeScreenshotForVisualProps();
    }

    private async _analyzeScreenshotForVisualProps(): Promise<Map<number, { coordinates: string | null; color: string | null; icon: string | null }>> {
      const result = new Map<number, { coordinates: string | null; color: string | null; icon: string | null }>();
      if (!this.actionResult) return result;

      const screenshotData = this._getScreenshotForVisual();
      if (!screenshotData) return result;

      const { image } = screenshotData;
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
        Return ONLY the markdown table. No explanations.
      `;

      try {
        const aiResult = await this.provider.processImage(prompt, image.toString('base64'));
        const text = aiResult.text || '';
        const rows = mdq(text).query('table').toJson();
        for (const row of rows) {
          const eidx = Number.parseInt(row.eidx, 10);
          if (Number.isNaN(eidx)) continue;
          const val = (v: string) => (v && v !== '-' ? v : null);
          result.set(eidx, {
            coordinates: val(row.Coordinates),
            color: val(row.Color),
            icon: val(row.Icon),
          });
        }
      } catch (err) {
        debugLog(`Screenshot visual analysis failed: ${err instanceof Error ? err.message : err}`);
      }

      debugLog(`Parsed visual props for ${result.size} elements`);
      return result;
    }

    private _getScreenshotForVisual(): { image: Buffer } | null {
      if (!this.actionResult) return null;
      const image = this.actionResult.screenshot;
      if (!image) return null;
      return { image };
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

export interface CoordinateMethods {
  analyzeScreenshotForVisualProps(): Promise<Map<number, { coordinates: string | null; color: string | null; icon: string | null }>>;
  mergeVisualData(result: ResearchResult, visualData: Map<number, { coordinates: string | null; color: string | null; icon: string | null }>): Promise<void>;
  backfillCoordinates(result: ResearchResult): Promise<void>;
}
