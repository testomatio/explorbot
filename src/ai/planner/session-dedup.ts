import type { Plan } from '../../test-plan.ts';
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
          lines.push(`${plan.url || '/'} | ${test.style || 'default'} | ${test.scenario}`);
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
