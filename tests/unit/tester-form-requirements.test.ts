import { describe, expect, it } from 'bun:test';
import { Tester } from '../../src/ai/tester.ts';

function buildTester(): Tester {
  const explorer: any = {
    getConfig: () => ({}),
    getStateManager: () => ({ getCurrentState: () => null }),
  };
  const provider: any = {
    getSystemPromptForAgent: () => '',
  };
  const researcher: any = {};
  const navigator: any = {};
  return new Tester(explorer, provider, researcher, navigator);
}

describe('Tester getSystemMessage — form requirements', () => {
  it('instructs reading form requirements before filling data-changing forms', () => {
    const message = buildTester().getSystemMessage();

    expect(message).toContain('<form_requirements>');
    expect(message).toContain('persists data');
    expect(message).toContain('Search/filter/sort');
  });
});
