import { clearActivity, setActivity } from '../activity.ts';
import type { DecisionModelSettings } from '../config.ts';
import { Observability } from '../observability.ts';
import { createDebug } from '../utils/logger.ts';

const debugLog = createDebug('explorbot:judge');

const YES_NO: Record<string, string> = {
  yes: 'The statement is true.',
  no: 'The statement is false.',
};

const REQUEST_TIMEOUT_MS = 15000;

export const JUDGE_PAGE_CAP = 12000;

export class Judge {
  private fetchImpl: typeof fetch = fetch;
  private requestTimeoutMs = REQUEST_TIMEOUT_MS;

  constructor(private settings: DecisionModelSettings) {}

  get toolEnabled(): boolean {
    return this.settings.tool;
  }

  get directEnabled(): boolean {
    return this.settings.direct;
  }

  async ask(state: unknown, questions: Record<string, JudgeQuestion>): Promise<Record<string, JudgeAnswer> | null> {
    if (!Object.keys(questions).length) return null;

    return Observability.run('judge.ask', { tags: ['judge'] }, async () => {
      setActivity('⚖️ Asking judge...', 'ai');
      try {
        const { answers, errorClass } = await this.post(state, questions);
        const span = Observability.getSpan();
        if (answers) {
          const withConfidence = Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, { answer: answer.answer, confidence: answer.confidence }]));
          span?.setAttribute('ai.telemetry.metadata.judgeAsk', JSON.stringify({ questions: Object.keys(questions), answers: withConfidence }));
          return answers;
        }
        debugLog('judge declined, caller falls through');
        span?.setAttribute('ai.telemetry.metadata.judgeAsk', JSON.stringify({ questions: Object.keys(questions), answers: null, errorClass }));
        return null;
      } finally {
        clearActivity();
      }
    });
  }

  private async post(state: unknown, questions: Record<string, JudgeQuestion>): Promise<JudgePostResult> {
    const body = {
      model: this.settings.model,
      state,
      questions: Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, { type: 'choice', instructions: question.instructions, criteria: question.options || YES_NO }])),
    };

    let requestBody: string;
    try {
      requestBody = JSON.stringify(body);
    } catch (error) {
      debugLog('failed to serialize request body: %s', error);
      return { answers: null, errorClass: 'unserializable_state' };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const timedOut = new Promise<null>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve(null), { once: true });
    });

    const response = await Promise.race([
      this.fetchImpl(this.settings.baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.settings.apiKey}`, 'Content-Type': 'application/json' },
        body: requestBody,
        signal: controller.signal,
      }).catch((error: unknown) => {
        debugLog('transport failed: %s', error);
        return null;
      }),
      timedOut,
    ]).finally(() => clearTimeout(timeoutId));

    if (!response) {
      if (controller.signal.aborted) return { answers: null, errorClass: 'timeout' };
      return { answers: null, errorClass: 'transport' };
    }
    if (!response.ok) {
      debugLog('endpoint returned %d', response.status);
      return { answers: null, errorClass: `http_${response.status}` };
    }

    const payload = await response.json().catch(() => null);
    const answers = normalizeAnswers(payload);
    if (!answers) return { answers: null, errorClass: 'malformed_body' };
    return { answers };
  }
}

function normalizeAnswers(payload: any): Record<string, JudgeAnswer> | null {
  const answers = payload?.answers;
  if (!answers || typeof answers !== 'object') return null;

  const normalized: Record<string, JudgeAnswer> = {};
  for (const [id, answer] of Object.entries<any>(answers)) {
    if (typeof answer?.choice !== 'string') continue;
    if (typeof answer?.confidence !== 'number') continue;
    normalized[id] = { answer: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities || {} };
  }

  if (!Object.keys(normalized).length) return null;
  return normalized;
}

export interface JudgeQuestion {
  instructions: string;
  options?: Record<string, string>;
}

export interface JudgeAnswer {
  answer: string;
  confidence: number;
  probabilities: Record<string, number>;
}

interface JudgePostResult {
  answers: Record<string, JudgeAnswer> | null;
  errorClass?: string;
}
