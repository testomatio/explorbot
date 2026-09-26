import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { JudgeProvider } from '../../src/ai/judge-provider.ts';
import { Observability } from '../../src/observability.ts';

const KEYS = ['OPENROUTER_API_KEY', 'TYPESAFE_API_KEY'];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  process.env.OPENROUTER_API_KEY = 'or-key';
  process.env.TYPESAFE_API_KEY = 'ts-key';
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) Reflect.deleteProperty(process.env, key);
    if (saved[key] !== undefined) process.env[key] = saved[key];
  }
});

function capturing(provider: JudgeProvider, respond: () => Response | Promise<Response> = () => new Response(JSON.stringify({ answers: { q: { type: 'noul', noul: 0.9 } } }))) {
  const calls: Array<{ url: string; init: any }> = [];
  (provider as any).fetchImpl = async (url: string, init: any) => {
    calls.push({ url, init });
    return respond();
  };
  return calls;
}

describe('JudgeProvider endpoints', () => {
  it('sends an openrouter model to OpenRouter with the OpenRouter key', async () => {
    const provider = new JudgeProvider('openrouter', 'typesafe/jev-1.13');
    const calls = capturing(provider);
    await provider.decide({}, 'q');
    expect(provider.model).toBe('typesafe/jev-1.13');
    expect(calls[0].url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(calls[0].init.headers.Authorization).toBe('Bearer or-key');
  });

  it('sends a typesafe model to the TypeSafe API with the TypeSafe key', async () => {
    const provider = new JudgeProvider('typesafe', 'jev-latest');
    const calls = capturing(provider);
    await provider.decide({}, 'q');
    expect(provider.model).toBe('jev-latest');
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(calls[0].init.headers.Authorization).toBe('Bearer ts-key');
  });

  it('refuses an unknown provider and a missing key, naming what to fix', () => {
    expect(() => new JudgeProvider('groq', 'some-model')).toThrow('Unknown decision model provider "groq"');
    Reflect.deleteProperty(process.env, 'TYPESAFE_API_KEY');
    expect(() => new JudgeProvider('typesafe', 'jev-latest')).toThrow('Set TYPESAFE_API_KEY');
  });
});

describe('JudgeProvider.decide', () => {
  it('asks a yes/no as a noul and returns the probability of yes', async () => {
    const provider = new JudgeProvider('openrouter', 'typesafe/jev-1.13');
    const calls = capturing(provider);
    const answer = await provider.decide({ page: 'x' }, 'The form is submitted.');
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: 'typesafe/jev-1.13', state: { page: 'x' }, questions: { q: { type: 'noul', instructions: 'The form is submitted.' } } });
    expect(answer).toEqual({ value: 'yes', probability: 0.9 });
  });

  it('records the exact request body and endpoint on the span so the call can be replayed', async () => {
    const attributes: Record<string, unknown> = {};
    const getSpan = spyOn(Observability, 'getSpan').mockReturnValue({ setAttribute: (key: string, value: unknown) => (attributes[key] = value) } as any);
    const provider = new JudgeProvider('openrouter', 'typesafe/jev-1.13');
    const calls = capturing(provider);
    await provider.decide({ page: 'x' }, 'q');
    getSpan.mockRestore();
    expect(attributes['langfuse.observation.input']).toBe(calls[0].init.body);
    expect(attributes['ai.telemetry.metadata.judgeEndpoint']).toBe('https://openrouter.ai/api/alpha/decisions');
  });

  it('asks a list as a choice and returns the chosen option with its probability', async () => {
    const provider = new JudgeProvider('openrouter', 'typesafe/jev-1.13');
    const calls = capturing(provider, () => new Response(JSON.stringify({ answers: { q: { type: 'choice', choice: '1', probabilities: { 0: 0.1, 1: 0.9 } } } })));
    const answer = await provider.decide({}, 'Which tab?', ['Details', 'History']);
    expect(JSON.parse(calls[0].init.body).questions.q).toEqual({ type: 'choice', instructions: 'Which tab?', criteria: { 0: 'Details', 1: 'History' } });
    expect(answer).toEqual({ value: 'History', probability: 0.9 });
  });

  it('throws on a non-2xx response and on a malformed body', async () => {
    const failing = new JudgeProvider('openrouter', 'm');
    capturing(failing, () => new Response('{}', { status: 404 }));
    await expect(failing.decide({}, 'q')).rejects.toThrow('http_404');

    const malformed = new JudgeProvider('openrouter', 'm');
    capturing(malformed, () => new Response('{"answers":null}'));
    await expect(malformed.decide({}, 'q')).rejects.toThrow('malformed_body');
  });

  it('aborts a request that outlives the timeout', async () => {
    const provider = new JudgeProvider('openrouter', 'm');
    (provider as any).requestTimeoutMs = 20;
    (provider as any).fetchImpl = (_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(provider.decide({}, 'q')).rejects.toThrow('aborted');
  });
});
