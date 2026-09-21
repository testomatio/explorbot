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
    private enabled: { tool: boolean; direct: boolean }
  ) {}

  static fromConfig(config: AIConfig['decisionModel']): Judge | null {
    if (!config) return null;
    if (typeof config === 'string') return Judge.fromConfig({ model: config });

    const provider = JudgeProvider.create(config.model);
    if (!provider) return null;
    return new Judge(provider, { tool: config.tool !== false, direct: config.direct !== false });
  }

  get toolEnabled(): boolean {
    return this.enabled.tool;
  }

  async decide(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision> {
    if (!this.enabled.direct) return new Decision(null, 0);
    return this.consult(question, options, state);
  }

  async consult(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision> {
    if (Array.isArray(options) && options.length < 2) return new Decision(null, 0);
    return Observability.run('judge.decide', { tags: ['judge'] }, async () => {
      setActivity('⚖️ Asking judge...', 'ai');
      const decision = await this.request(question, options, state).finally(() => clearActivity());
      Observability.getSpan()?.setAttribute('ai.telemetry.metadata.judgeDecision', JSON.stringify({ question, value: decision.value, confidence: decision.confidence }));
      return decision;
    });
  }

  private async request(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision> {
    let list: string[] | undefined;
    if (Array.isArray(options)) list = options;

    const answer = await this.provider.decide(state, question, list).catch((error: unknown) => this.recordFailure(error));
    if (!answer) return new Decision(null, 0);
    if (answer.probability <= APPROVAL_THRESHOLD) return new Decision(null, answer.probability);
    if (answer.value === UNDECIDED) return new Decision(null, answer.probability);
    return new Decision(answer.value, answer.probability);
  }

  private recordFailure(error: unknown): null {
    debugLog('judge declined: %s', error);
    Observability.getSpan()?.setAttribute('ai.telemetry.metadata.judgeError', String(error));
    return null;
  }
}
