const REQUEST_TIMEOUT_MS = 15000;

export class JudgeProvider {
  private fetchImpl: typeof fetch = fetch;
  private requestTimeoutMs = REQUEST_TIMEOUT_MS;

  constructor(
    readonly model: string,
    private endpoint: string,
    private apiKey: string
  ) {}

  static create(spec: string): JudgeProvider | null {
    const separator = spec.indexOf('/');
    if (separator < 1) return null;

    const target = JudgeProvider.endpointFor(spec.slice(0, separator));
    if (!target) return null;

    const apiKey = process.env[target.envKey];
    if (!apiKey) return null;
    return new JudgeProvider(spec.slice(separator + 1), target.url, apiKey);
  }

  async decide(state: unknown, question: string, options?: string[]): Promise<ProviderDecision> {
    let q: Record<string, unknown> = { type: 'noul', instructions: question };
    if (options) q = { type: 'choice', instructions: question, criteria: Object.fromEntries(options.map((option, index) => [String(index), option])) };
    const body = JSON.stringify({ model: this.model, state, questions: { q } });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
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

  private static endpointFor(provider: string): ProviderEndpoint | null {
    switch (provider) {
      case 'openrouter':
        return { url: 'https://openrouter.ai/api/alpha/decisions', envKey: 'OPENROUTER_API_KEY' };
      case 'typesafe':
        return { url: 'https://api.typesafe.ai/v1/systemone', envKey: 'TYPESAFE_API_KEY' };
      default:
        return null;
    }
  }
}

export interface ProviderDecision {
  value: string;
  probability: number;
}

interface ProviderEndpoint {
  url: string;
  envKey: string;
}
