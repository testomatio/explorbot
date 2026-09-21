import { clearActivity, setActivity } from '../activity.ts';
import type { DecisionModelSettings } from '../config.ts';
import { Observability } from '../observability.ts';
import { createDebug } from '../utils/logger.ts';

const debugLog = createDebug('explorbot:judge');

const APPROVAL_THRESHOLD = 0.7;
const REQUEST_TIMEOUT_MS = 15000;
const YES_NO_CRITERIA = { yes: 'The statement is true.', no: 'The statement is false.' };

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
  private fetchImpl: typeof fetch = fetch;
  private requestTimeoutMs = REQUEST_TIMEOUT_MS;

  constructor(private settings: DecisionModelSettings) {}

  get toolEnabled(): boolean {
    return this.settings.tool;
  }

  async decide(question: string, options: string[] | boolean | null, state: unknown): Promise<Decision> {
    if (!this.settings.direct) return new Decision(null, 0);
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
    const isList = Array.isArray(options);
    let criteria: Record<string, string> = YES_NO_CRITERIA;
    if (isList) criteria = Object.fromEntries(options.map((option, index) => [String(index), option]));

    let body: string;
    try {
      body = JSON.stringify({ model: this.settings.model, state, questions: { q: { type: 'choice', instructions: question, criteria } } });
    } catch {
      return this.fail('unserializable_state');
    }

    let failure = 'transport';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const payload = await this.fetchImpl(this.settings.baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.settings.apiKey}`, 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    })
      .then((response) => {
        failure = `http_${response.status}`;
        if (!response.ok) return null;
        failure = 'malformed_body';
        return response.json();
      })
      .catch(() => null)
      .finally(() => clearTimeout(timer));

    if (controller.signal.aborted) return this.fail('timeout');

    const choice = payload?.answers?.q?.choice;
    const probability = payload?.answers?.q?.probabilities?.[choice];
    if (typeof choice !== 'string' || typeof probability !== 'number') return this.fail(failure);
    if (probability <= APPROVAL_THRESHOLD) return new Decision(null, probability);
    if (!isList && choice !== 'yes') return new Decision(null, probability);
    if (!isList) return new Decision(choice, probability);

    const value = options[Number(choice)];
    if (value === undefined || value === UNDECIDED) return new Decision(null, probability);
    return new Decision(value, probability);
  }

  private fail(reason: string): Decision {
    debugLog('judge declined: %s', reason);
    Observability.getSpan()?.setAttribute('ai.telemetry.metadata.judgeError', reason);
    return new Decision(null, 0);
  }
}
