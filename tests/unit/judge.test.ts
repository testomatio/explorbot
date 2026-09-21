import { describe, expect, it } from 'bun:test';
import { Judge, UNDECIDED } from '../../src/ai/judge.ts';

const settings = { model: 'm', baseUrl: 'https://example.test/decisions', apiKey: 'k', tool: true, direct: true };

function answering(choice: string, probabilities: Record<string, number>, overrides: Partial<typeof settings> = {}) {
  const sent: any[] = [];
  const judge = new Judge({ ...settings, ...overrides });
  (judge as any).fetchImpl = async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ answers: { q: { type: 'choice', choice, probabilities } } }));
  };
  return { judge, sent };
}

function failing(fetchImpl: (url: string, init: any) => Promise<Response>) {
  const judge = new Judge(settings);
  (judge as any).fetchImpl = fetchImpl;
  return judge;
}

describe('Judge.decide', () => {
  it('approves a yes/no question answered yes above 70%', async () => {
    const { judge, sent } = answering('yes', { yes: 0.9, no: 0.1 });
    const decision = await judge.decide('The form is submitted.', null, { page: 'x' });
    expect(decision.approved).toBe(true);
    expect(decision.value).toBe('yes');
    expect(sent[0].questions.q.criteria).toEqual({ yes: 'The statement is true.', no: 'The statement is false.' });
  });

  it('treats a boolean the same as null', async () => {
    const { judge } = answering('yes', { yes: 0.9, no: 0.1 });
    expect((await judge.decide('The form is submitted.', true, {})).approved).toBe(true);
  });

  it('rejects a confident no — rejected means not approved, never a confident negative to act on', async () => {
    const { judge } = answering('no', { yes: 0.05, no: 0.95 });
    const decision = await judge.decide('The form is submitted.', null, {});
    expect(decision.rejected).toBe(true);
    expect(decision.value).toBeNull();
  });

  it('rejects when the winning answer is not above 70%', async () => {
    const { judge } = answering('yes', { yes: 0.7, no: 0.3 });
    expect((await judge.decide('The form is submitted.', null, {})).rejected).toBe(true);
  });

  it('returns the chosen option from a list', async () => {
    const { judge, sent } = answering('1', { 0: 0.1, 1: 0.85, 2: 0.05 });
    const decision = await judge.decide('Which tab is active?', ['Details', 'History', UNDECIDED], {});
    expect(decision.value).toBe('History');
    expect(sent[0].questions.q.criteria).toEqual({ 0: 'Details', 1: 'History', 2: UNDECIDED });
  });

  it('rejects when the undecided option wins', async () => {
    const { judge } = answering('2', { 0: 0.05, 1: 0.05, 2: 0.9 });
    expect((await judge.decide('Which tab is active?', ['Details', 'History', UNDECIDED], {})).rejected).toBe(true);
  });

  it('rejects a list of fewer than two options without calling out', async () => {
    const { judge, sent } = answering('0', { 0: 1 });
    expect((await judge.decide('Which tab is active?', [UNDECIDED], {})).rejected).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('rejects on the direct path when direct is disabled, while consult still answers', async () => {
    const { judge, sent } = answering('yes', { yes: 0.9, no: 0.1 }, { direct: false });
    expect((await judge.decide('The form is submitted.', null, {})).rejected).toBe(true);
    expect(sent).toHaveLength(0);
    expect((await judge.consult('The form is submitted.', null, {})).approved).toBe(true);
  });

  it('rejects instead of throwing on a non-2xx, a transport error, or a malformed body', async () => {
    const statuses = [
      failing(async () => new Response('{}', { status: 404 })),
      failing(async () => {
        throw new Error('ECONNREFUSED');
      }),
      failing(async () => new Response('{"answers":null}')),
    ];
    for (const judge of statuses) expect((await judge.decide('x', null, {})).rejected).toBe(true);
  });

  it('rejects instead of throwing when the state cannot be serialized', async () => {
    const { judge, sent } = answering('yes', { yes: 0.9, no: 0.1 });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect((await judge.decide('x', null, circular)).rejected).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it('rejects when the request times out', async () => {
    const judge = failing(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    (judge as any).requestTimeoutMs = 20;
    expect((await judge.decide('x', null, {})).rejected).toBe(true);
  });
});
