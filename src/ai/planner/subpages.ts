import dedent from 'dedent';
import { z } from 'zod';
import { normalizeUrl } from '../../state-manager.ts';
import type { StateManager } from '../../state-manager.ts';
import type { Plan } from '../../test-plan.ts';
import { tag } from '../../utils/logger.ts';
import type { Provider } from '../provider.ts';
import type { Constructor } from '../researcher/mixin.ts';

const planRegistry: Map<string, PlanRecord> = new Map();

export function registerPlan(url: string, plan: Plan, feature?: string): void {
  const key = buildKey(url, feature);
  planRegistry.set(key, { plan, feature, url });
}

export function getRegisteredPlan(url: string, feature?: string): PlanRecord | undefined {
  return planRegistry.get(buildKey(url, feature));
}

export function isPagePlanned(url: string): boolean {
  return planRegistry.has(buildKey(url));
}

export function clearPlanRegistry(url?: string): void {
  if (!url) {
    planRegistry.clear();
    return;
  }
  const key = buildKey(url);
  planRegistry.delete(key);
}

function buildKey(url: string, feature?: string): string {
  const normalized = normalizeUrl(url);
  if (feature) return `${normalized}::${feature}`;
  return normalized;
}

function isTemplateMatch(urlA: string, urlB: string): boolean {
  const partsA = normalizeUrl(urlA).split('/');
  const partsB = normalizeUrl(urlB).split('/');
  if (partsA.length !== partsB.length) return false;

  let diffCount = 0;
  for (let i = 0; i < partsA.length; i++) {
    if (partsA[i] === partsB[i]) continue;
    diffCount++;
    if (diffCount > 1) return false;
    const isNumericOrShortId = /^\d+$|^[a-f0-9]{4,}$/i;
    if (!isNumericOrShortId.test(partsA[i]) && !isNumericOrShortId.test(partsB[i])) return false;
  }
  return diffCount === 1;
}

const SubPagePickSchema = z.object({
  url: z.string().nullable(),
  reason: z.string(),
});

export function WithSubPages<T extends Constructor>(Base: T) {
  return class extends Base {
    declare provider: Provider;
    declare stateManager: StateManager;

    collectSubPageCandidates(plan: Plan, currentUrl: string): SubPageCandidate[] {
      const visited = plan.getVisitedPages();
      const currentPath = normalizeUrl(currentUrl);

      const candidates: SubPageCandidate[] = [];
      for (const page of visited) {
        const pagePath = normalizeUrl(page.url);
        if (!pagePath.startsWith(currentPath) || pagePath === currentPath) continue;
        if (isPagePlanned(page.url)) continue;
        if (candidates.some((c) => normalizeUrl(c.url) === pagePath)) continue;

        candidates.push({
          url: page.url,
          title: page.title,
          h1: page.h1,
          visitCount: this.stateManager.getVisitCount(page.url),
        });
      }

      candidates.sort((a, b) => b.visitCount - a.visitCount);
      return candidates;
    }

    async pickNextSubPage(candidates: SubPageCandidate[]): Promise<{ url: string; reason: string } | null> {
      if (candidates.length === 0) return null;

      const plannedEntries = [...planRegistry.entries()].map(([key, record]) => `- ${record.url} (${record.plan.tests.length} tests${record.feature ? `, feature: ${record.feature}` : ''})`).join('\n');

      const candidateList = candidates.map((c) => `- ${c.url} (visits: ${c.visitCount}${c.title ? `, title: "${c.title}"` : ''}${c.h1 ? `, h1: "${c.h1}"` : ''})`).join('\n');

      const conversation = this.provider.startConversation(
        dedent`
          You pick the next most business-relevant sub-page to test from a list of candidates.
          Higher visit count means the page was encountered more during testing — likely more important.
          Detect template pages: /users/1 and /users/2 are the same template — if one was planned, skip all others.
          Compare page titles, headings, and URL structure to detect templates.
          Skip help/docs/about pages if core feature pages remain.
          Return null for url when no more relevant pages remain.
        `,
        'planner'
      );

      conversation.addUserText(dedent`
        Already planned pages:
        ${plannedEntries || '(none)'}

        Candidate sub-pages:
        ${candidateList}

        Pick the most business-relevant untested page, or return null if none are worth testing.
      `);

      const result = await this.provider.generateObject(conversation.messages, SubPagePickSchema, conversation.model);
      if (!result?.object?.url) return null;
      return { url: result.object.url, reason: result.object.reason };
    }

    findSimilarPlan(url: string): PlanRecord | null {
      if (isPagePlanned(url)) {
        const record = getRegisteredPlan(url);
        if (record) return record;
      }

      for (const record of planRegistry.values()) {
        if (record.feature) continue;
        if (isTemplateMatch(url, record.url)) return record;
      }

      return null;
    }
  };
}

type PlanRecord = { plan: Plan; feature?: string; url: string };

type SubPageCandidate = { url: string; title?: string; h1?: string; visitCount: number };
