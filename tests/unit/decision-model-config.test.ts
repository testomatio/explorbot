import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { resolveDecisionModel } from '../../src/config.ts';

describe('resolveDecisionModel', () => {
  let savedOpenRouterKey: string | undefined;
  let savedTypeSafeKey: string | undefined;

  beforeEach(() => {
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY;
    savedTypeSafeKey = process.env.TYPESAFE_API_KEY;
  });

  afterEach(() => {
    if (savedOpenRouterKey === undefined) {
      Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
    } else {
      process.env.OPENROUTER_API_KEY = savedOpenRouterKey;
    }
    if (savedTypeSafeKey === undefined) {
      Reflect.deleteProperty(process.env, 'TYPESAFE_API_KEY');
    } else {
      process.env.TYPESAFE_API_KEY = savedTypeSafeKey;
    }
  });

  it('returns null when unset', () => {
    expect(resolveDecisionModel({ model: {} } as any)).toBeNull();
  });

  it('accepts a bare string and enables both paths', () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const settings = resolveDecisionModel({ model: {}, decisionModel: 'typesafe/jev-1.13' } as any);
    expect(settings).toEqual({
      model: 'typesafe/jev-1.13',
      baseUrl: 'https://openrouter.ai/api/alpha/decisions',
      apiKey: 'k',
      tool: true,
      direct: true,
    });
  });

  it('honours each toggle independently', () => {
    process.env.OPENROUTER_API_KEY = 'k';
    const settings = resolveDecisionModel({ model: {}, decisionModel: { model: 'm', tool: false } } as any);
    expect(settings?.tool).toBe(false);
    expect(settings?.direct).toBe(true);
  });

  it('takes the TypeSafe key when the base url is TypeSafe', () => {
    process.env.TYPESAFE_API_KEY = 't';
    const settings = resolveDecisionModel({ model: {}, decisionModel: { model: 'jev-latest', baseUrl: 'https://api.typesafe.ai/v1/systemone' } } as any);
    expect(settings?.apiKey).toBe('t');
  });

  it('returns null when no key is available', () => {
    process.env.OPENROUTER_API_KEY = '';
    expect(resolveDecisionModel({ model: {}, decisionModel: 'typesafe/jev-1.13' } as any)).toBeNull();
  });
});
