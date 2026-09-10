import { type Plan, TestResult } from '../../test-plan.ts';
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
          const lastNote = Object.values(test.notes)
            .filter((note) => note.message)
            .pop();
          const outcome = test.result || (lastNote ? 'unfinished' : 'pending');
          let line = `${plan.url || '/'} | ${test.style || 'default'} | ${outcome} | ${test.scenario}`;
          if ((outcome === TestResult.FAILED || outcome === 'unfinished') && lastNote) {
            line += ` — ${lastNote.message.slice(0, 140)}`;
          }
          lines.push(line);
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

export function clearSessionDedup(): void {
  previousPlans.length = 0;
}
