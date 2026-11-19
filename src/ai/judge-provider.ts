import { type Experimental_DecisionQuestion, experimental_decide } from 'ai';
import { PROVIDERS } from '../config.js';
import { Observability } from '../observability.ts';
import { redactSecrets } from '../utils/secrets.ts';

const REQUEST_TIMEOUT_MS = 15000;

export class JudgeProvider {
  private requestTimeoutMs = REQUEST_TIMEOUT_MS;
  private load: (model: string) => Promise<any>;
  private decisionModel?: Promise<any>;

  constructor(
    readonly provider: string,
    readonly model: string
  ) {
    const { keyName, load } = JudgeProvider.sourceFor(provider);
    if (!process.env[keyName]) throw new Error(`Set ${keyName} to use the decision model`);
    this.load = load;
  }

  async decide(state: unknown, question: string, options?: string[]): Promise<ProviderDecision> {
    let q: Experimental_DecisionQuestion = { type: 'boolean', instructions: question };
    if (options) q = { type: 'choice', instructions: question, criteria: Object.fromEntries(options.map((option, index) => [String(index), option])) };
    const span = Observability.getSpan();
    span?.setAttribute('langfuse.observation.input', redactSecrets(JSON.stringify({ model: this.model, state, questions: { q } })));
    span?.setAttribute('ai.telemetry.metadata.judgeProvider', this.provider);
    this.decisionModel ||= this.load(this.model);
    const { answers } = await experimental_decide({
      model: await this.decisionModel,
      state: state as Record<string, any>,
      questions: { q },
      maxRetries: 0,
      telemetry: { isEnabled: false },
      abortSignal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    const answer = answers.q as { probability?: number; choice?: string; probabilities?: Record<string, number> };
    if (!options && typeof answer?.probability === 'number') return { value: 'yes', probability: answer.probability };

    const value = options?.[Number(answer?.choice)];
    const probability = answer?.probabilities?.[answer?.choice as string];
    if (value === undefined || typeof probability !== 'number') throw new Error('malformed_body');
    return { value, probability };
  }

  private static sourceFor(provider: string): { keyName: string; load: (model: string) => Promise<any> } {
    switch (provider) {
      case 'openrouter':
        return { keyName: PROVIDERS.openrouter.envKey, load: async (model) => ((await PROVIDERS.openrouter.load()) as any).evaluationModel(model) };
      case 'typesafe':
        return { keyName: 'TYPESAFE_API_KEY', load: async (model) => (await import('@ai-sdk/typesafe-ai')).createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY }).decisionModel(model) };
      case 'openai':
      case 'google':
        return { keyName: PROVIDERS[provider].envKey, load: async (model) => ((await PROVIDERS[provider].load()) as any).decisionModel(model) };
      default:
        throw new Error(`Unknown decision model provider "${provider}" — use "openrouter", "typesafe", "openai" or "google"`);
    }
  }
}

export interface ProviderDecision {
  value: string;
  probability: number;
}
