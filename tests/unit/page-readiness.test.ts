import { describe, expect, it } from 'bun:test';
import { waitForPageReadiness } from '../../src/utils/page-readiness.ts';

describe('page readiness', () => {
  it('waits for Playwright network idle after domcontentloaded', async () => {
    const page = new FakePage();

    await waitForPageReadiness(page, {
      timeout: 100,
    });

    expect(page.loadStates).toEqual(['domcontentloaded', 'networkidle']);
    expect(page.waitedForBodyContent).toBe(true);
  });

  it('can finish from configured hidden spinner selectors', async () => {
    const page = new FakePage(['.spinner']);

    await waitForPageReadiness(page, {
      timeout: 100,
      spinnerSelectors: ['.spinner'],
    });

    expect(page.loadStates).toEqual(['domcontentloaded', 'networkidle']);
    expect(page.waitedSelectors).toEqual(['.spinner']);
  });

  it('does not finish from spinner selectors that are not visible', async () => {
    const page = new FakePage([], 40);
    let ready = false;

    const wait = waitForPageReadiness(page, {
      timeout: 80,
      spinnerSelectors: ['.missing-spinner'],
    }).then(() => {
      ready = true;
    });

    await sleep(0);
    await sleep(20);

    expect(ready).toBe(false);

    await wait;

    expect(page.waitedSelectors).toEqual([]);
  });
});

class FakePage {
  loadStates: string[] = [];
  waitedSelectors: string[] = [];
  waitedForBodyContent = false;

  constructor(
    private visibleSelectors: string[] = [],
    private networkIdleDelay = 0
  ) {}

  async waitForLoadState(state: string): Promise<void> {
    this.loadStates.push(state);
    if (state === 'networkidle') await sleep(this.networkIdleDelay);
  }

  locator(selector: string): {
    first: () => { isVisible: (options: { timeout: number }) => Promise<boolean> };
    waitFor: (options: { state: string; timeout: number }) => Promise<void>;
  } {
    return {
      first: () => ({
        isVisible: async () => this.visibleSelectors.includes(selector),
      }),
      waitFor: async () => {
        this.waitedSelectors.push(selector);
      },
    };
  }

  async waitForFunction(): Promise<void> {
    this.waitedForBodyContent = true;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
