import { beforeEach, describe, expect, it } from 'bun:test';
import { createAgentTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';

function stateFixture(id: number, url: string, heading: string) {
  return {
    id,
    url,
    fullUrl: url,
    title: heading,
    html: `<html><body><h1>${heading}</h1><a href="/other">link</a></body></html>`,
    ariaSnapshot: `- heading "${heading}" [level=1]`,
  };
}

describe('back tool', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('diffs the post-navigation state against the pre-navigation state', async () => {
    const before = stateFixture(1, '/page-b', 'Page B');
    const after = stateFixture(2, '/page-a', 'Page A');

    let navigated = false;
    const stateManager = {
      getCurrentState: () => (navigated ? after : before),
      getStateHistory: () => [{ toState: after }],
    };
    const explorer = {
      action: () => ({
        attempt: async () => {
          navigated = true;
          return true;
        },
        lastError: null,
      }),
    };

    const tools = createAgentTools({
      explorer: explorer as any,
      stateManager: stateManager as any,
      ai: {} as any,
      researcher: {} as any,
      navigator: {} as any,
    });

    const result: any = await tools.back.execute({ reason: 'went to the wrong page' });

    expect(result.success).toBe(true);
    expect(result.pageDiff).not.toBeNull();
    expect(result.pageDiff.urlChanged).toBe(true);
    expect(result.pageDiff.currentUrl).toContain('/page-a');
  });
});
