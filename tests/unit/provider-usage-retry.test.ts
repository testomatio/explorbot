import { beforeEach, describe, expect, it } from 'bun:test';
import { MockLanguageModelV3 } from 'ai/test';
import { Provider } from '../../src/ai/provider.js';
import { Stats } from '../../src/stats.js';

const USAGE = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 100, text: 100, reasoning: 0 },
};

function buildFlakyModel(): MockLanguageModelV3 {
  let call = 0;
  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'flaky-model',
    doGenerate: async () => {
      call++;
      if (call === 1) {
        return { content: [], finishReason: 'stop' as const, usage: USAGE, warnings: [] };
      }
      return { content: [{ type: 'text' as const, text: 'recovered' }], finishReason: 'stop' as const, usage: USAGE, warnings: [] };
    },
  });
}

describe('token accounting across retries', () => {
  beforeEach(() => {
    Stats.models = {};
  });

  it('counts tokens burned by an attempt that is later retried', async () => {
    const model = buildFlakyModel();
    const provider = new Provider({ model, apiKey: 'test-key', config: {}, vision: false } as any);

    const response = await provider.chat([{ role: 'user', content: 'hi' }], model, { maxRetries: 3, retryDelay: 0 });

    expect(response.text).toBe('recovered');
    expect(Stats.models['flaky-model']?.total).toBe(2200);
  });
});
