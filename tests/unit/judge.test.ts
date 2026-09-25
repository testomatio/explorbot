import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Judge, UNDECIDED } from '../../src/ai/judge.ts';

function answering(value: string, probability: number, enabled = { tool: true, direct: true }) {
  const asked: Array<{ question: string; options?: string[] }> = [];
  const provider: any = {
    decide: async (_state: unknown, question: string, options?: string[]) => {
      asked.push({ question, options });
      return { value, probability };
    },
  };
  return { judge: new Judge(provider, enabled), asked };
}

describe('Judge.decide', () => {
  it('approves a yes/no question answered yes above 70%', async () => {
    const { judge, asked } = answering('yes', 0.9);
    const decision = await judge.decide('The form is submitted.', null, {});
    expect(decision.approved).toBe(true);
    expect(decision.value).toBe('yes');
    expect(asked[0].options).toBeUndefined();
  });

  it('treats a boolean the same as null', async () => {
    expect((await answering('yes', 0.9).judge.decide('x', true, {})).approved).toBe(true);
  });

  it('rejects a confident no — rejected means not approved, never a confident negative to act on', async () => {
    const decision = await answering('yes', 0.05).judge.decide('x', null, {});
    expect(decision.rejected).toBe(true);
    expect(decision.value).toBeNull();
  });

  it('rejects when the winning answer is not above 70%', async () => {
    expect((await answering('yes', 0.7).judge.decide('x', null, {})).rejected).toBe(true);
  });

  it('returns the chosen option from a list', async () => {
    const { judge, asked } = answering('History', 0.85);
    expect((await judge.decide('Which tab is active?', ['Details', 'History', UNDECIDED], {})).value).toBe('History');
    expect(asked[0].options).toEqual(['Details', 'History', UNDECIDED]);
  });

  it('tells the model to choose undecided when unsure, only when that option is offered', async () => {
    const { judge, asked } = answering('History', 0.85);
    await judge.decide('Which tab is active?', ['Details', 'History', UNDECIDED], {});
    await judge.decide('Which tab is active?', ['Details', 'History'], {});
    expect(asked[0].question).toBe(`Which tab is active? Choose "${UNDECIDED}" if you are not sure or no option fits.`);
    expect(asked[1].question).toBe('Which tab is active?');
  });

  it('rejects when the undecided option wins', async () => {
    expect((await answering(UNDECIDED, 0.9).judge.decide('x', ['Details', 'History', UNDECIDED], {})).rejected).toBe(true);
  });

  it('rejects a list of fewer than two options without asking', async () => {
    const { judge, asked } = answering(UNDECIDED, 1);
    expect((await judge.decide('x', [UNDECIDED], {})).rejected).toBe(true);
    expect(asked).toHaveLength(0);
  });

  it('rejects on the direct path when direct is disabled, while consult still answers', async () => {
    const { judge, asked } = answering('yes', 0.9, { tool: true, direct: false });
    expect((await judge.decide('x', null, {})).rejected).toBe(true);
    expect(asked).toHaveLength(0);
    expect((await judge.consult('x', null, {})).approved).toBe(true);
  });

  it('applies a configured threshold instead of 70%', async () => {
    const provider: any = { decide: async () => ({ value: 'yes', probability: 0.6 }) };
    expect((await new Judge(provider, { tool: true, direct: true }, 0.5).decide('x', null, {})).approved).toBe(true);
    expect((await new Judge(provider, { tool: true, direct: true }, 0.65).decide('x', null, {})).rejected).toBe(true);
  });

  it('rejects instead of throwing when the provider fails', async () => {
    const provider: any = {
      decide: async () => {
        throw new Error('http_500');
      },
    };
    expect((await new Judge(provider, { tool: true, direct: true }).decide('x', null, {})).rejected).toBe(true);
  });

  it('rejects instead of throwing when the state cannot be serialized', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const provider: any = { decide: async (state: unknown) => JSON.stringify(state) };
    expect((await new Judge(provider, { tool: true, direct: true }).decide('x', null, circular)).rejected).toBe(true);
  });
});

describe('Judge.pick', () => {
  it('returns the 1-based position of the chosen option', async () => {
    const { judge, asked } = answering('Second', 0.9);
    expect(await judge.pick('Which one?', ['First', 'Second'], {})).toBe(2);
    expect(asked[0].options).toEqual(['First', 'Second', UNDECIDED]);
  });

  it('returns null when undecided wins', async () => {
    expect(await answering(UNDECIDED, 0.9).judge.pick('Which one?', ['First', 'Second'], {})).toBeNull();
  });

  it('does not ask when options are identical, since a pick could not tell them apart', async () => {
    const { judge, asked } = answering('Same', 0.9);
    expect(await judge.pick('Which one?', ['Same', 'Same'], {})).toBeNull();
    expect(asked).toHaveLength(0);
  });
});

describe('Judge.fromConfig', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'k';
  });
  afterEach(() => {
    if (saved === undefined) Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
    if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  });

  it('builds nothing when unset', () => {
    expect(Judge.fromConfig(undefined)).toBeNull();
  });

  it('refuses a threshold outside 0..1', () => {
    expect(() => Judge.fromConfig({ provider: 'openrouter', model: 'typesafe/jev-1.13', threshold: 70 })).toThrow('between 0 and 1');
    expect(Judge.fromConfig({ provider: 'openrouter', model: 'typesafe/jev-1.13', threshold: 0.8 })).not.toBeNull();
  });

  it('enables both paths by default, and honours each toggle', () => {
    expect(Judge.fromConfig({ provider: 'openrouter', model: 'typesafe/jev-1.13' })?.toolEnabled).toBe(true);
    expect(Judge.fromConfig({ provider: 'openrouter', model: 'typesafe/jev-1.13', tool: false })?.toolEnabled).toBe(false);
  });
});
