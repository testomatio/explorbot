import dedent from 'dedent';
import type { ActionResult } from '../../action-result.js';
import type Explorer from '../../explorer.ts';
import { parseAriaLocator } from '../../utils/aria.ts';
import { tag } from '../../utils/logger.js';
import { WebElement } from '../../utils/web-element.ts';
import type { Conversation } from '../conversation.ts';
import type { Provider } from '../provider.js';
import { locatorRule as generalLocatorRuleText } from '../rules.js';
import { type Constructor, debugLog } from './mixin.ts';
import { parseResearchSections } from './parser.ts';
import type { ResearchResult } from './research-result.ts';

export const DYNAMIC_ID_PATTERN = /^#ember\d|^\/\/[^[]*\[@id="ember\d|#react-select-|#rc-|#ng-|#cdk-|#mat-|data-ebd-id/;
export const isForbiddenLocator = (s: string) => DYNAMIC_ID_PATTERN.test(s) || s.includes('data-explorbot-eidx') || /\[eidx=/.test(s);

function buildPwLocatorString(loc: Locator): string {
  const base = loc.container ? `locate('${loc.container}')` : 'page';
  if (loc.type === 'aria') {
    const parsed = parseAriaLocator(loc.locator);
    if (!parsed) return `${base}.getByRole('???')`;
    return `${base}.getByRole('${parsed.role}', { name: '${parsed.text}' })`;
  }
  return `${base}.locator('${loc.locator}')`;
}

export function WithLocators<T extends Constructor>(Base: T) {
  return class extends Base {
    declare explorer: Explorer;
    declare provider: Provider;
    declare actionResult: ActionResult | undefined;

    async testLocators(locators: Locator[]): Promise<void> {
      let broken = 0;
      for (const loc of locators) {
        if (loc.type !== 'aria' && isForbiddenLocator(loc.locator)) {
          loc.valid = false;
          loc.error = 'dynamic ID';
          loc.pwLocator = buildPwLocatorString(loc);
          debugLog(`DYNAMIC ID [${loc.section}] ${loc.type} "${loc.element}": ${loc.locator}`);
          broken++;
          continue;
        }
        try {
          const count = await this.explorer.playwrightLocatorCount((page) => {
            const base = loc.container ? page.locator(loc.container) : page;
            if (loc.type === 'aria') {
              const parsed = parseAriaLocator(loc.locator);
              if (!parsed) return page.locator('__invalid__');
              return base.getByRole(parsed.role as any, { name: parsed.text });
            }
            const converted = loc.locator.replace(/:contains\(/g, ':has-text(');
            if (converted !== loc.locator) {
              loc.locator = converted;
            }
            return base.locator(loc.locator);
          });
          loc.valid = count === 1;
          loc.pwLocator = buildPwLocatorString(loc);
          if (!loc.valid) {
            loc.error = count === 0 ? '0 elements' : `${count} elements`;
            debugLog(`BROKEN [${loc.section}] ${loc.type} "${loc.element}": ${loc.locator} (${loc.error})`);
            broken++;
          }
        } catch (err) {
          loc.valid = false;
          loc.error = err instanceof Error ? err.message : String(err);
          loc.pwLocator = buildPwLocatorString(loc);
          debugLog(`ERROR [${loc.section}] ${loc.type} "${loc.element}": ${loc.locator} — ${loc.error}`);
          broken++;
        }
      }

      tag('substep').log(`Validated ${locators.length} locators: ${locators.length - broken} valid, ${broken} broken`);
    }

    async fixBrokenSections(result: ResearchResult, conversation: Conversation): Promise<void> {
      const broken = result.locators.filter((l) => l.valid === false);
      if (broken.length === 0) return;

      const bySection = new Map<string, Locator[]>();
      for (const loc of broken) {
        const list = bySection.get(loc.section) || [];
        list.push(loc);
        bySection.set(loc.section, list);
      }

      const allLocsBySection = new Map<string, Locator[]>();
      for (const loc of result.locators) {
        const list = allLocsBySection.get(loc.section) || [];
        list.push(loc);
        allLocsBySection.set(loc.section, list);
      }

      const sectionParts: string[] = [];
      const parsedSections = parseResearchSections(result.text);
      for (const [name, sectionBroken] of bySection) {
        const allLocs = allLocsBySection.get(name) || [];
        const section = parsedSections.find((s) => s.name === name);
        const container = section?.containerCss;

        const isContainerBroken = sectionBroken.some((l) => l.error === 'container broken');

        let header = `## ${name}\n`;
        if (container) {
          header += isContainerBroken ? `\n> Container: '${container}'  ← BROKEN (container not found)\n` : `\n> Container: '${container}'\n`;
        }

        const testedLines = allLocs.map((loc) => {
          const status = loc.valid === false ? `← BROKEN (${loc.error || 'unknown'})` : '← OK';
          return `- '${loc.element}': ${loc.pwLocator || loc.locator} ${status}`;
        });

        sectionParts.push(`${header}\nTested Elements:\n${testedLines.join('\n')}`);
      }

      const prompt = dedent`
        Some locators in your research are broken. Please fix the broken sections.

        ${sectionParts.join('\n\n')}

        Return corrected sections in the same format as the original research.
        Fix broken containers and locators. Keep working ones unchanged.
        ${generalLocatorRuleText}
      `;

      tag('substep').log(`Fixing ${broken.length} broken locators via AI conversation...`);

      try {
        conversation.addUserText(prompt);
        const invocationResult = await this.provider.invokeConversation(conversation, undefined, { agentName: 'researcher' });
        if (!invocationResult) return;

        const fixedSections = parseResearchSections(invocationResult.response.text);
        if (fixedSections.length === 0) return;

        for (const fixedSection of fixedSections) {
          const originalSections = parseResearchSections(result.text);
          const original = originalSections.find((s) => s.name === fixedSection.name);
          if (!original) continue;

          if (fixedSection.containerCss && fixedSection.containerCss !== original.containerCss) {
            debugLog(`Fixed container for "${fixedSection.name}": '${original.containerCss}' → '${fixedSection.containerCss}'`);
            original.containerCss = fixedSection.containerCss;
          }

          const fixedByName = new Map(fixedSection.elements.map((el) => [el.name, el]));
          for (const el of original.elements) {
            const fix = fixedByName.get(el.name);
            if (!fix) continue;
            if (fix.css) el.css = fix.css;
            if (fix.aria) el.aria = fix.aria;
          }
          result.rebuildSectionInText(original);
        }

        result.parseLocators();
        await this.testLocators(result.locators);
      } catch (err) {
        tag('substep').log(`AI fix failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    async backfillBrokenLocators(result: ResearchResult): Promise<void> {
      result.parseLocators();
      await this.testLocators(result.locators);

      const sections = parseResearchSections(result.text);
      const brokenCss = new Set(result.locators.filter((l) => l.type === 'css' && l.valid === false).map((l) => `${l.section}::${l.element}`));

      const needsXpath: number[] = [];
      const needsXpathEls = new Map<number, { section: (typeof sections)[0]; el: (typeof sections)[0]['elements'][0] }>();

      for (const section of sections) {
        for (const el of section.elements) {
          if (el.aria && !/\w/.test(el.aria.text)) el.aria = null;
          if (!el.eidx || el.xpath) continue;
          const hasWorkingCss = el.css && !brokenCss.has(`${section.name}::${el.name}`);
          const hasWorkingAria = el.aria && /\w/.test(el.aria.text);
          if (!hasWorkingCss && !hasWorkingAria) {
            needsXpath.push(el.eidx);
            needsXpathEls.set(el.eidx, { section, el });
          }
        }
      }

      if (needsXpath.length > 0) {
        const page = this.explorer.playwrightHelper.page;
        const webElements = await WebElement.fromEidxList(page, needsXpath);
        const changedSections = new Set<(typeof sections)[0]>();
        for (const w of webElements) {
          const entry = needsXpathEls.get(w.eidx!);
          if (!entry || !w.clickXPath) continue;
          entry.el.xpath = w.clickXPath;
          changedSections.add(entry.section);
        }
        for (const section of changedSections) result.rebuildSectionInText(section);
        tag('substep').log(`Backfilled XPath for ${webElements.length} elements missing working locators`);
      }

      const containerLocs = result.containerLocators;
      await this.testLocators(containerLocs);
      const brokenContainers = containerLocs.filter((c) => c.valid === false).map((c) => c.locator);
      if (brokenContainers.length > 0) {
        result.nullifyBrokenContainers(brokenContainers);
      }
    }
  };
}

export interface Locator {
  section: string;
  container: string | null;
  element: string;
  type: 'css' | 'xpath' | 'aria';
  locator: string;
  valid: boolean | null;
  error: string | null;
  pwLocator: string | null;
}

export interface LocatorMethods {
  testLocators(locators: Locator[]): Promise<void>;
  fixBrokenSections(result: ResearchResult, conversation: Conversation): Promise<void>;
  backfillBrokenLocators(result: ResearchResult): Promise<void>;
}
