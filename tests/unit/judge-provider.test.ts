import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { JudgeProvider } from '../../src/ai/judge-provider.ts';

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

describe('JudgeProvider.create', () => {
  it('routes an openrouter spec to OpenRouter, keeping the slash-bearing model id', async () => {
    const provider = JudgeProvider.create('openrouter/typesafe/jev-1.13')!;
    const calls = capturing(provider);
    await provider.decide({}, 'q');
    expect(provider.model).toBe('typesafe/jev-1.13');
    expect(calls[0].url).toBe('https://openrouter.ai/api/alpha/decisions');
    expect(calls[0].init.headers.Authorization).toBe('Bearer or-key');
  });

  it('routes a typesafe spec to the TypeSafe API', async () => {
    const provider = JudgeProvider.create('typesafe/jev-latest')!;
    const calls = capturing(provider);
    await provider.decide({}, 'q');
    expect(provider.model).toBe('jev-latest');
    expect(calls[0].url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(calls[0].init.headers.Authorization).toBe('Bearer ts-key');
  });

  it('builds nothing for an unknown provider, a missing key, or a spec without a provider', () => {
    expect(JudgeProvider.create('groq/some-model')).toBeNull();
    expect(JudgeProvider.create('jev-latest')).toBeNull();
    Reflect.deleteProperty(process.env, 'TYPESAFE_API_KEY');
    expect(JudgeProvider.create('typesafe/jev-latest')).toBeNull();
  });
});

describe('JudgeProvider.decide', () => {
  it('asks a yes/no as a noul and returns the probability of yes', async () => {
    const provider = JudgeProvider.create('openrouter/typesafe/jev-1.13')!;
    const calls = capturing(provider);
    const answer = await provider.decide({ page: 'x' }, 'The form is submitted.');
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: 'typesafe/jev-1.13', state: { page: 'x' }, questions: { q: { type: 'noul', instructions: 'The form is submitted.' } } });
    expect(answer).toEqual({ value: 'yes', probability: 0.9 });
  });

  it('asks a list as a choice and returns the chosen option with its probability', async () => {
    const provider = JudgeProvider.create('openrouter/typesafe/jev-1.13')!;
    const calls = capturing(provider, () => new Response(JSON.stringify({ answers: { q: { type: 'choice', choice: '1', probabilities: { 0: 0.1, 1: 0.9 } } } })));
    const answer = await provider.decide({}, 'Which tab?', ['Details', 'History']);
    expect(JSON.parse(calls[0].init.body).questions.q).toEqual({ type: 'choice', instructions: 'Which tab?', criteria: { 0: 'Details', 1: 'History' } });
    expect(answer).toEqual({ value: 'History', probability: 0.9 });
  });

  it('throws on a non-2xx response and on a malformed body', async () => {
    const failing = JudgeProvider.create('openrouter/m')!;
    capturing(failing, () => new Response('{}', { status: 404 }));
    await expect(failing.decide({}, 'q')).rejects.toThrow('http_404');

    const malformed = JudgeProvider.create('openrouter/m')!;
    capturing(malformed, () => new Response('{"answers":null}'));
    await expect(malformed.decide({}, 'q')).rejects.toThrow('malformed_body');
  });

  it('aborts a request that outlives the timeout', async () => {
    const provider = JudgeProvider.create('openrouter/m')!;
    (provider as any).requestTimeoutMs = 20;
    (provider as any).fetchImpl = (_url: string, init: any) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(provider.decide({}, 'q')).rejects.toThrow('aborted');
  });
});
