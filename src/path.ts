import type { ActionResult } from './action-result';
import type { Transition } from './transition';
import type { TransitionType } from './types/transition-type';

interface Step {
  initialState: ActionResult | null;
  transition: Transition;
  nextState: ActionResult;
}

export class Path {
  private steps: Step[] = [];

  addStep(
    initialState: ActionResult | null,
    transition: Transition,
    nextState: ActionResult
  ): void {
    this.steps.push({ initialState, transition, nextState });
  }

  getSteps(): Step[] {
    return [...this.steps];
  }

  getCurrentState(): ActionResult | null {
    return this.steps.length > 0
      ? this.steps[this.steps.length - 1].nextState
      : null;
  }

  getPathLength(): number {
    return this.steps.length;
  }

  getPathSummary(): { steps: number; lastTransition?: TransitionType } {
    return {
      steps: this.steps.length,
      lastTransition:
        this.steps.length > 0
          ? this.steps[this.steps.length - 1].transition.type
          : undefined,
    };
  }

  getStep(index: number): Step | null {
    return index >= 0 && index < this.steps.length ? this.steps[index] : null;
  }

  getLastStep(): Step | null {
    return this.steps.length > 0 ? this.steps[this.steps.length - 1] : null;
  }
}
