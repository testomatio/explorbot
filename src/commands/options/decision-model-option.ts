import { BaseOption } from './base-option.js';

export class DecisionModelOption extends BaseOption {
  flags = '--decision-model <model>';
  description = 'Turn on the decision model for this run, as provider/model-id (e.g. openrouter/typesafe/jev-1.13)';

  protected apply(options: Record<string, any>): void {
    if (!options.decisionModel) return;
    process.env.EXPLORBOT_DECISION_MODEL = options.decisionModel;
  }
}
