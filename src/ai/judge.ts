import { clearActivity, setActivity } from '../activity.ts';
import type { AIConfig } from '../config.ts';
import { Observability } from '../observability.ts';
import { createDebug } from '../utils/logger.ts';
import { JudgeProvider } from './judge-provider.ts';

const debugLog = createDebug('explorbot:judge');

const APPROVAL_THRESHOLD = 0.7;

export const UNDECIDED = 'undecided';
export const JUDGE_PAGE_CAP = 12000;

export class Decision {
  constructor(
    readonly value: string | null,
    readonly confidence: number
  ) {}

  get approved(): boolean {
    return this.value !== null;
  }

  get rejected(): boolean {
    return this.value === null;
  }
}

export class Judge {
  constructor(
    private provider: JudgeProvider,
    private enabled: { tool: boolean; direct: boolean },
    private threshold = APPROVAL_THRESHOLD
  ) {}

  static fromConfig(config: AIConfig['decisionModel']): Judge | null {
    if (!config) return null;
    const threshold = config.threshold ?? APPROVAL_THRESHOLD;
    if (!(threshold > 0 && threshold < 1)) throw new Error(`decisionModel.threshold must be between 0 and 1, got ${config.threshold}`);
    return new Judge(new JudgeProvider(config.provider, config.model), { tool: config.tool !== false, direct: config.direct !== false }, threshold);
  }

  get toolEnabled(): boolean {
    return this.enabled.tool;
  }

  async decide(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision> {
    if (!this.enabled.direct) return new Decision(null, 0);
    return this.consult(question, options, state);
  }

  async pick(question: string, options: string[], state: unknown): Promise<number | null> {
    if (new Set(options).size < options.length) return null;
    const decision = await this.decide(question, [...options, UNDECIDED], state);
    if (!decision.value) return null;
    return options.indexOf(decision.value) + 1;
  }

  async consult(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision> {
    if (Array.isArray(options) && options.length < 2) return new Decision(null, 0);
    return Observability.run('judge.decide', { tags: ['judge'] }, async () => {
      setActivity('⚖️ Asking judge...', 'ai');
      const decision = await this.request(question, options, state).finally(() => clearActivity());
      const span = Observability.getSpan();
      span?.setAttribute('ai.telemetry.metadata.judgeQuestion', question);
      span?.setAttribute('ai.telemetry.metadata.judgeDecision', JSON.stringify({ question, value: decision.value, confidence: decision.confidence, threshold: this.threshold, model: this.provider.model }));
      return decision;
    });
  }

  private async request(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision> {
    let list: string[] | undefined;
    if (Array.isArray(options)) list = options;

    const answer = await this.provider.decide(state, question, list).catch((error: unknown) => this.recordFailure(error));
    if (!answer) return new Decision(null, 0);
    Observability.getSpan()?.setAttribute('langfuse.observation.output', JSON.stringify(answer));
    if (answer.probability <= this.threshold) return new Decision(null, answer.probability);
    if (answer.value === UNDECIDED) return new Decision(null, answer.probability);
    return new Decision(answer.value, answer.probability);
  }

  private recordFailure(error: unknown): null {
    debugLog('judge declined: %s', error);
    const span = Observability.getSpan();
    span?.setAttribute('ai.telemetry.metadata.judgeError', String(error));
    span?.setAttribute('langfuse.observation.level', 'ERROR');
    span?.setAttribute('langfuse.observation.status_message', String(error));
    return null;
  }
}
