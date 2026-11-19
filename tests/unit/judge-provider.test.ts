import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Experimental_DecisionMockModelV4 } from 'ai/test';
import { JudgeProvider } from '../../src/ai/judge-provider.ts';
import { Observability } from '../../src/observability.ts';

const KEYS = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) process.env[key] = `${key}-value`;
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
    if (saved[key] !== undefined) process.env[key] = saved[key];
  }
});

function capturing(provider: JudgeProvider, answer: any = { type: 'boolean', probability: 0.9 }) {
  const calls: any[] = [];
  (provider as any).decisionModel = Promise.resolve(
    new Experimental_DecisionMockModelV4({
      doDecide: async (options) => {
        calls.push(options);
        return { answers: { q: answer }, warnings: [] };
      },
    })
  );
  return calls;
}

describe('JudgeProvider models', () => {
  it('builds a decision model from each supported provider', async () => {
    const models = { openrouter: 'typesafe/jev-1.13', typesafe: 'jev-latest', openai: 'gpt-6-luna', google: 'gemini-decision-1' };
    for (const [name, id] of Object.entries(models)) {
      const provider = new JudgeProvider(name, id);
      const model = await (provider as any).load(id);
      expect(provider.model).toBe(id);
      expect(model.modelId).toBe(id);
      expect(typeof (model.doDecide || model.doEvaluate)).toBe('function');
    }
  });

  it('refuses an unknown provider and a missing key, naming what to fix', () => {
    expect(() => new JudgeProvider('groq', 'some-model')).toThrow('Unknown decision model provider "groq"');
    Reflect.deleteProperty(process.env, 'TYPESAFE_API_KEY');
    expect(() => new JudgeProvider('typesafe', 'jev-latest')).toThrow('Set TYPESAFE_API_KEY');
    Reflect.deleteProperty(process.env, 'GOOGLE_GENERATIVE_AI_API_KEY');
    expect(() => new JudgeProvider('google', 'gemini-decision-1')).toThrow('Set GOOGLE_GENERATIVE_AI_API_KEY');
  });
});

describe('JudgeProvider.decide', () => {
  it('asks a yes/no as a boolean and returns the probability of yes', async () => {
    const provider = new JudgeProvider('openrouter', 'typesafe/jev-1.13');
    const calls = capturing(provider);
    const answer = await provider.decide({ page: 'x' }, 'The form is submitted.');
    expect(calls[0].state).toEqual([{ type: 'json', value: { page: 'x' } }]);
    expect(calls[0].questions).toEqual({ q: { type: 'boolean', instructions: 'The form is submitted.' } });
    expect(answer).toEqual({ value: 'yes', probability: 0.9 });
  });

  it('records the request and the provider on the span so the call can be replayed', async () => {
    const attributes: Record<string, unknown> = {};
    const getSpan = spyOn(Observability, 'getSpan').mockReturnValue({ setAttribute: (key: string, value: unknown) => (attributes[key] = value) } as any);
    const provider = new JudgeProvider('openrouter', 'typesafe/jev-1.13');
    capturing(provider);
    await provider.decide({ page: 'x' }, 'q');
    getSpan.mockRestore();
    expect(JSON.parse(attributes['langfuse.observation.input'] as string)).toEqual({ model: 'typesafe/jev-1.13', state: { page: 'x' }, questions: { q: { type: 'boolean', instructions: 'q' } } });
    expect(attributes['ai.telemetry.metadata.judgeProvider']).toBe('openrouter');
  });

  it('asks a list as a choice and returns the chosen option with its probability', async () => {
    const provider = new JudgeProvider('openrouter', 'typesafe/jev-1.13');
    const calls = capturing(provider, { type: 'choice', choice: '1', probabilities: { 0: 0.1, 1: 0.9 } });
    const answer = await provider.decide({}, 'Which tab?', ['Details', 'History']);
    expect(calls[0].questions.q).toEqual({ type: 'choice', instructions: 'Which tab?', criteria: { 0: 'Details', 1: 'History' } });
    expect(answer).toEqual({ value: 'History', probability: 0.9 });
  });

  it('throws when the model fails and when a choice comes back without probabilities', async () => {
    const failing = new JudgeProvider('openrouter', 'm');
    (failing as any).decisionModel = Promise.resolve(
      new Experimental_DecisionMockModelV4({
        doDecide: async () => {
          throw new Error('http_404');
        },
      })
    );
    await expect(failing.decide({}, 'q')).rejects.toThrow('http_404');

    const bare = new JudgeProvider('openrouter', 'm');
    capturing(bare, { type: 'choice', choice: '0' });
    await expect(bare.decide({}, 'Which tab?', ['Details', 'History'])).rejects.toThrow('malformed_body');
  });

  it('makes one attempt and aborts a request that outlives the timeout', async () => {
    const provider = new JudgeProvider('openrouter', 'm');
    (provider as any).requestTimeoutMs = 20;
    let attempts = 0;
    (provider as any).decisionModel = Promise.resolve(
      new Experimental_DecisionMockModelV4({
        doDecide: ({ abortSignal }) => {
          attempts++;
          return new Promise((_resolve, reject) => {
            abortSignal?.addEventListener('abort', () => reject(abortSignal.reason));
          });
        },
      })
    );
    await expect(provider.decide({}, 'q')).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
