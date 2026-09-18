import { describe, expect, it } from 'bun:test';
import { Judge } from '../../src/ai/judge.ts';

const settings = { model: 'm', baseUrl: 'https://example.test/decisions', apiKey: 'k', tool: true, direct: true };

function judgeWith(responder: (body: any) => Response | Promise<Response>): Judge {
  const judge = new Judge(settings);
  (judge as any).fetchImpl = async (_url: string, init: any) => responder(JSON.parse(init.body));
  return judge;
}

describe('Judge.ask', () => {
  it('sends yes/no questions as a two-option choice', async () => {
    let sent: any = null;
    const judge = judgeWith((body) => {
      sent = body;
      return new Response(JSON.stringify({ answers: { q: { type: 'choice', choice: 'yes', probabilities: { yes: 0.9, no: 0.1 }, confidence: 0.8 } } }));
    });

    const answers = await judge.ask({ page: 'x' }, { q: { instructions: 'The form is submitted.' } });

    expect(sent.model).toBe('m');
    expect(sent.questions.q.type).toBe('choice');
    expect(Object.keys(sent.questions.q.criteria)).toEqual(['yes', 'no']);
    expect(answers?.q).toEqual({ answer: 'yes', confidence: 0.8, probabilities: { yes: 0.9, no: 0.1 } });
  });

  it('passes supplied options through as criteria', async () => {
    let sent: any = null;
    const judge = judgeWith((body) => {
      sent = body;
      return new Response(JSON.stringify({ answers: { pick: { type: 'choice', choice: 'a', probabilities: { a: 0.6, b: 0.4 }, confidence: 0.2 } } }));
    });

    const answers = await judge.ask('state', { pick: { instructions: 'Which one?', options: { a: 'The first', b: 'The second' } } });

    expect(sent.questions.pick.criteria).toEqual({ a: 'The first', b: 'The second' });
    expect(answers?.pick.confidence).toBe(0.2);
  });

  it('returns null on a non-2xx response', async () => {
    const judge = judgeWith(() => new Response('{"error":{"message":"no endpoints"}}', { status: 404 }));
    expect(await judge.ask('s', { q: { instructions: 'x' } })).toBeNull();
  });

  it('returns null when the transport throws', async () => {
    const judge = new Judge(settings);
    (judge as any).fetchImpl = async () => {
      throw new Error('ECONNREFUSED');
    };
    expect(await judge.ask('s', { q: { instructions: 'x' } })).toBeNull();
  });

  it('returns null on a malformed body', async () => {
    const judge = judgeWith(() => new Response('{"answers":null}'));
    expect(await judge.ask('s', { q: { instructions: 'x' } })).toBeNull();
  });

  it('reports both toggles', () => {
    expect(new Judge({ ...settings, tool: false }).toolEnabled).toBe(false);
    expect(new Judge({ ...settings, direct: false }).directEnabled).toBe(false);
  });

  it('returns null instead of throwing when the state cannot be serialized', async () => {
    const judge = judgeWith(() => new Response(JSON.stringify({ answers: {} })));
    const circular: any = {};
    circular.self = circular;

    await expect(judge.ask(circular, { q: { instructions: 'x' } })).resolves.toBeNull();
  });

  it('returns null when the request times out', async () => {
    const judge = new Judge(settings);
    (judge as any).requestTimeoutMs = 20;
    (judge as any).fetchImpl = () => new Promise(() => {});

    expect(await judge.ask('s', { q: { instructions: 'x' } })).toBeNull();
  });
});
