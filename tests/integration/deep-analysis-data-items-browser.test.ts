import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { type Browser, type Page, chromium } from 'playwright';
import { WithDeepAnalysis } from '../../src/ai/researcher/deep-analysis.ts';

const DeepAnalysis = WithDeepAnalysis(Object as any) as any;

const STATE = { url: '/list', hash: '', html: '<html><body></body></html>', ariaSnapshot: '' };

function dataSection(container: string): string {
  return `## Data: Items\n\n> Container: \`${container}\`\n\nItems, 2 items.\n`;
}

describe('deep analysis of Data sections', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  async function attemptedClicks(html: string, research: string): Promise<string[]> {
    await page.setContent(html);
    const attempted: string[] = [];
    const analysis = new DeepAnalysis();
    analysis.config = { ai: {} };
    analysis.provider = { getModelForAgent: () => null, chat: async () => ({ text: '' }), hasVision: () => false };
    analysis.stateManager = { getCurrentState: () => STATE };
    analysis.navigateTo = async () => {};
    analysis.cancelInUi = async () => {};
    analysis.explorer = {
      withPage: async (fn: any) => fn(page),
      capture: async () => {},
      action: () => ({
        attempt: async (code: string) => {
          if (code.startsWith('I.click')) attempted.push(code);
          return false;
        },
      }),
    };
    await analysis.performDeepAnalysis(STATE, { text: research });
    return attempted;
  }

  it('opens one item when the item declares a popup', async () => {
    const clicks = await attemptedClicks(
      `<div id="grid">
        <article role="button" aria-haspopup="dialog" aria-label="View first item" tabindex="0">First</article>
        <article role="button" aria-haspopup="dialog" aria-label="View second item" tabindex="0">Second</article>
      </div>`,
      dataSection('#grid')
    );

    expect(clicks.length).toBeGreaterThan(0);
    expect(clicks.some((code) => code.includes('View first item'))).toBe(true);
    expect(clicks.some((code) => code.includes('View second item'))).toBe(false);
  });

  it('follows the first link of a list', async () => {
    const clicks = await attemptedClicks(
      `<ul id="list">
        <li><a href="/items/1">First record</a></li>
        <li><a href="/items/2">Second record</a></li>
      </ul>`,
      dataSection('#list')
    );

    expect(clicks.some((code) => code.includes('First record'))).toBe(true);
    expect(clicks.some((code) => code.includes('Second record'))).toBe(false);
  });

  it('never presses an item control that does not declare where it leads', async () => {
    const clicks = await attemptedClicks(
      `<table id="rows"><tbody>
        <tr><td>First</td><td><button>Delete</button></td></tr>
        <tr><td>Second</td><td><button>Delete</button></td></tr>
      </tbody></table>`,
      dataSection('#rows')
    );

    expect(clicks).toEqual([]);
  });

  it('skips a safe control when it sits after an unsafe one', async () => {
    const clicks = await attemptedClicks(
      `<ul id="list">
        <li><button>Archive</button><a href="/items/1">First record</a></li>
      </ul>`,
      dataSection('#list')
    );

    expect(clicks.some((code) => code.includes('Archive'))).toBe(false);
    expect(clicks.some((code) => code.includes('First record'))).toBe(true);
  });

  it('ignores a Data section whose container is not on the page', async () => {
    const clicks = await attemptedClicks('<a href="/elsewhere">Elsewhere</a>', dataSection('#gone'));

    expect(clicks).toEqual([]);
  });
});
