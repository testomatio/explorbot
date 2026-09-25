import { Observability } from '../observability.ts';
import { redactSecrets } from '../utils/secrets.ts';

const REQUEST_TIMEOUT_MS = 15000;

export class JudgeProvider {
  private fetchImpl: typeof fetch = fetch;
  private requestTimeoutMs = REQUEST_TIMEOUT_MS;
  private url: string;
  private apiKey: string;

  constructor(
    provider: string,
    readonly model: string
  ) {
    const { url, keyName } = JudgeProvider.endpointFor(provider);
    const apiKey = process.env[keyName];
    if (!apiKey) throw new Error(`Set ${keyName} to use the decision model`);
    this.url = url;
    this.apiKey = apiKey;
  }

  async decide(state: unknown, question: string, options?: string[]): Promise<ProviderDecision> {
    let q: Record<string, unknown> = { type: 'noul', instructions: question };
    if (options) q = { type: 'choice', instructions: question, criteria: Object.fromEntries(options.map((option, index) => [String(index), option])) };
    const body = JSON.stringify({ model: this.model, state, questions: { q } });
    const span = Observability.getSpan();
    span?.setAttribute('langfuse.observation.input', redactSecrets(body));
    span?.setAttribute('ai.telemetry.metadata.judgeEndpoint', this.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`http_${response.status}`);

      const answer = (await response.json())?.answers?.q;
      if (!options && typeof answer?.noul === 'number') return { value: 'yes', probability: answer.noul };

      const value = options?.[Number(answer?.choice)];
      const probability = answer?.probabilities?.[answer?.choice];
      if (value === undefined || typeof probability !== 'number') throw new Error('malformed_body');
      return { value, probability };
    } finally {
      clearTimeout(timer);
    }
  }

  private static endpointFor(provider: string): { url: string; keyName: string } {
    switch (provider) {
      case 'openrouter':
        return { url: 'https://openrouter.ai/api/alpha/decisions', keyName: 'OPENROUTER_API_KEY' };
      case 'typesafe':
        return { url: 'https://api.typesafe.ai/v1/systemone', keyName: 'TYPESAFE_API_KEY' };
      default:
        throw new Error(`Unknown decision model provider "${provider}" — use "openrouter" or "typesafe"`);
    }
  }
}

export interface ProviderDecision {
  value: string;
  probability: number;
}
