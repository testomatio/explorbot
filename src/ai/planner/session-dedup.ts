import { type Plan, type Test, TestResult } from '../../test-plan.ts';
import type { Constructor } from '../researcher/mixin.ts';

const previousPlans: Plan[] = [];

export function WithSessionDedup<T extends Constructor>(Base: T) {
  return class extends Base {
    declare currentPlan: Plan | null;

    registerPlanInSession(plan: Plan): void {
      if (!previousPlans.includes(plan)) {
        previousPlans.push(plan);
      }
    }

    getSessionTestsSummary(): string {
      const lines: string[] = [];
      for (const plan of previousPlans) {
        if (plan === this.currentPlan) continue;
        for (const test of plan.tests) {
          lines.push(formatSessionTest(plan, test));
        }
      }
      return lines.join('\n');
    }

    getPreviousSessionScenarios(): Set<string> {
      return new Set(previousPlans.flatMap((p) => p.tests.map((t) => t.scenario.toLowerCase())));
    }

    getPreviousSessionScenariosExcluding(plan: Plan): Set<string> {
      return new Set(previousPlans.filter((p) => p !== plan).flatMap((p) => p.tests.map((t) => t.scenario.toLowerCase())));
    }
  };
}

export function formatSessionTest(plan: Plan, test: Test): string {
  const lastNote = Object.values(test.notes)
    .filter((note) => note.message)
    .pop();
  let outcome: string | null = test.result;
  if (!outcome) outcome = 'pending';
  if (!test.result && lastNote) outcome = 'unfinished';

  const line = `${plan.url || '/'} | ${test.style || 'default'} | ${outcome} | ${test.scenario}`;
  if (!lastNote) return line;
  if (outcome !== TestResult.FAILED && outcome !== 'unfinished') return line;
  return `${line} — ${lastNote.message.slice(0, 140)}`;
}

export function clearSessionDedup(): void {
  previousPlans.length = 0;
}
