import { beforeEach, describe, expect, it } from 'bun:test';
import { createRefTools } from '../../src/ai/tools.ts';
import { ConfigParser } from '../../src/config.ts';
import { Task } from '../../src/test-plan.ts';

function pageFixture(refs: string[]) {
  let index = new Set<string>(refs);
  let snapshots = 0;
  return {
    wipe: () => {
      index = new Set();
    },
    get snapshots() {
      return snapshots;
    },
    locator: (selector: string) => ({
      count: async () => (index.has(selector.replace('aria-ref=', '')) ? 1 : 0),
      evaluate: async () => null,
      ariaSnapshot: async () => {
        snapshots++;
        index = new Set(refs);
        return refs.map((ref) => `- button [ref=${ref}]`).join('\n');
      },
    }),
  };
}

function explorerFixture(page: ReturnType<typeof pageFixture>, attempts: string[]) {
  return {
    withPage: (fn: any) => fn(page),
    action: () => ({
      attempt: async (code: string) => {
        attempts.push(code);
        return true;
      },
      lastError: null,
      saveScreenshot: async () => null,
    }),
  };
}

const stateManager = {
  getCurrentState: () => ({ id: 1, url: '/board', fullUrl: '/board', title: 'Board', html: '<html><body><h1>Board</h1></body></html>', ariaSnapshot: '- heading "Board" [level=1]' }),
};

describe('clickRef with a ref index that page capture replaced', () => {
  beforeEach(() => {
    ConfigParser.resetForTesting();
    ConfigParser.setupTestConfig();
  });

  it('restores the index and clicks a ref the page still holds', async () => {
    const page = pageFixture(['e5']);
    page.wipe();

    const attempts: string[] = [];
    const tools = createRefTools({ explorer: explorerFixture(page, attempts) as any, stateManager: stateManager as any, ai: {} as any }, new Task('click a button'));
    const result: any = await tools.clickRef.execute({ ref: 'e5', element: 'button "Account"' });

    expect(result.success).toBe(true);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toContain('aria-ref=e5');
    expect(page.snapshots).toBe(1);
  });

  it('fails at once for a ref no longer on the page, without attempting a click', async () => {
    const page = pageFixture([]);
    const attempts: string[] = [];
    const tools = createRefTools({ explorer: explorerFixture(page, attempts) as any, stateManager: stateManager as any, ai: {} as any }, new Task('click a button'));
    const result: any = await tools.clickRef.execute({ ref: 'e5', element: 'button "Account"' });

    expect(result.success).toBe(false);
    expect(result.message).toContain('e5');
    expect(result.suggestion).toContain('context()');
    expect(attempts).toHaveLength(0);
  });

  it('clicks when the page cannot be inspected for refs', async () => {
    const attempts: string[] = [];
    const explorer = {
      action: () => ({
        attempt: async (code: string) => {
          attempts.push(code);
          return true;
        },
        lastError: null,
        saveScreenshot: async () => null,
      }),
    };
    const tools = createRefTools({ explorer: explorer as any, stateManager: stateManager as any, ai: {} as any }, new Task('click a button'));
    const result: any = await tools.clickRef.execute({ ref: 'e5', element: 'button "Account"' });

    expect(result.success).toBe(true);
    expect(attempts).toHaveLength(1);
  });
});
